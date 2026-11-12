// Lanternhall AI proxy: streams text from Claude, GPT or Gemini.
// Each "seat" on the AI council (gm, chronicler, voices, forge) can use a different provider.
export const config = { runtime: "edge" };

const SYSTEM = `You power Lanternhall, a text tabletop roleplaying site. Follow the instructions and output format in the user's message exactly. Keep content PG-13: tension and danger are fine, gore and sexual content are not. Never reproduce characters, places or text from existing franchises; everything is original.`;

const env = (k, d = "") => (typeof process !== "undefined" && process.env && process.env[k]) || d;
const SEATS = ["gm", "chronicler", "voices", "forge"];

function pickProvider(seat) {
  const wanted = env(`${seat.toUpperCase()}_AI`, "anthropic").toLowerCase();
  const has = { anthropic: !!env("ANTHROPIC_API_KEY"), openai: !!env("OPENAI_API_KEY"), gemini: !!env("GEMINI_API_KEY") };
  if (has[wanted]) return wanted;
  return ["anthropic", "openai", "gemini"].find(p => has[p]) || null;
}
function modelFor(provider, fast) {
  if (provider === "anthropic") return fast ? env("ANTHROPIC_FAST_MODEL", "claude-haiku-5-5") : env("ANTHROPIC_MODEL", "claude-sonnet-5-5");
  if (provider === "openai") return (fast && env("OPENAI_FAST_MODEL")) || env("OPENAI_MODEL");
  if (provider === "gemini") return (fast && env("GEMINI_FAST_MODEL")) || env("GEMINI_MODEL");
}

// --- simple per-IP rate limit (per server instance) ---
const hits = new Map();
function limited(ip) {
  const now = Date.now(), win = 10 * 60 * 1000, max = +env("RATE_LIMIT", "80");
  const arr = (hits.get(ip) || []).filter(t => now - t < win);
  arr.push(now); hits.set(ip, arr);
  if (hits.size > 5000) hits.clear();
  return arr.length > max;
}

function upstreamRequest(provider, model, messages, maxTokens) {
  if (provider === "anthropic") {
    return fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": env("ANTHROPIC_API_KEY"), "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model, max_tokens: maxTokens, stream: true, system: SYSTEM, messages }),
    });
  }
  if (provider === "openai") {
    return fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${env("OPENAI_API_KEY")}`, "content-type": "application/json" },
      body: JSON.stringify({ model, stream: true, messages: [{ role: "system", content: SYSTEM }, ...messages] }),
    });
  }
  // gemini
  const contents = messages.map(m => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
  return fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, {
    method: "POST",
    headers: { "x-goog-api-key": env("GEMINI_API_KEY"), "content-type": "application/json" },
    body: JSON.stringify({ contents, systemInstruction: { parts: [{ text: SYSTEM }] }, generationConfig: { maxOutputTokens: maxTokens } }),
  });
}

// Pull the text out of one SSE "data:" payload, per provider. Returns {text} or {error}.
function readEvent(provider, data) {
  if (data === "[DONE]") return {};
  let j; try { j = JSON.parse(data); } catch { return {}; }
  if (provider === "anthropic") {
    if (j.type === "content_block_delta" && j.delta?.type === "text_delta") return { text: j.delta.text };
    if (j.type === "error") return { error: j.error?.type || "error" };
    return {};
  }
  if (provider === "openai") {
    if (j.error) return { error: j.error.type || "error" };
    return { text: j.choices?.[0]?.delta?.content || "" };
  }
  if (j.error) return { error: j.error.status || "error" };
  return { text: (j.candidates?.[0]?.content?.parts || []).map(p => p.text || "").join("") };
}

export default async function handler(req) {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const code = env("ACCESS_CODE");
  if (code && req.headers.get("x-access-code") !== code) return new Response("Access code required", { status: 401 });
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "anon";
  if (limited(ip)) return new Response("Too many requests. Wait a few minutes.", { status: 429 });

  let body; try { body = await req.json(); } catch { return new Response("Bad JSON", { status: 400 }); }
  const messages = (Array.isArray(body.messages) ? body.messages : [])
    .filter(m => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .slice(-20);
  const size = messages.reduce((a, m) => a + m.content.length, 0);
  if (!messages.length || messages[0].role !== "user" || size > 120000) return new Response("Bad request", { status: 400 });

  const seat = SEATS.includes(body.seat) ? body.seat : "gm";
  const fast = body.tier === "quick";
  const provider = pickProvider(seat);
  if (!provider) return new Response("No AI key is set on the server. Add ANTHROPIC_API_KEY, OPENAI_API_KEY or GEMINI_API_KEY in your Vercel settings.", { status: 503 });
  const model = modelFor(provider, fast);
  if (!model) return new Response(`Set ${provider.toUpperCase()}_MODEL in your Vercel settings to use ${provider}.`, { status: 503 });

  let upstream;
  try { upstream = await upstreamRequest(provider, model, messages, fast ? 1200 : 1800); }
  catch { return new Response("Couldn't reach the AI provider.", { status: 502 }); }
  if (!upstream.ok) {
    const t = await upstream.text().catch(() => "");
    const status = upstream.status === 429 ? 429 : 502;
    return new Response(status === 429 ? "The AI provider is rate limiting. Try again shortly." : `AI provider error (${provider} ${upstream.status}): ${t.slice(0, 300)}`, { status });
  }

  const enc = new TextEncoder(), dec = new TextDecoder();
  const stream = new ReadableStream({
    async start(ctrl) {
      const reader = upstream.body.getReader(); let buf = "";
      try {
        for (;;) {
          const { done, value } = await reader.read(); if (done) break;
          buf += dec.decode(value, { stream: true }).replace(/\r\n/g, "\n");
          let i;
          while ((i = buf.indexOf("\n\n")) >= 0) {
            const evt = buf.slice(0, i); buf = buf.slice(i + 2);
            const data = evt.split("\n").filter(l => l.startsWith("data:")).map(l => l.slice(5).trim()).join("");
            if (!data) continue;
            const r = readEvent(provider, data);
            if (r.text) ctrl.enqueue(enc.encode(r.text));
            if (r.error) ctrl.enqueue(enc.encode("\u0007ERR:" + r.error));
          }
        }
      } catch { ctrl.enqueue(enc.encode("\u0007ERR:stream")); }
      ctrl.close();
    },
  });
  return new Response(stream, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-ai-provider": provider } });
}
