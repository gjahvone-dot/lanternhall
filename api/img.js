// Lanternhall painter: turns a prompt into an image once, then Vercel's CDN serves the same picture to everyone.
// Order: Gemini image model (uses GEMINI_API_KEY) -> Pollinations with POLLINATIONS_TOKEN (if set) -> free Pollinations.
export const config = { runtime: "edge" };
const env = (k, d = "") => (typeof process !== "undefined" && process.env && process.env[k]) || d;

const hits = new Map();
function limited(ip) {
  const now = Date.now(), win = 10 * 60 * 1000, max = +env("IMG_RATE_LIMIT", "90");
  const arr = (hits.get(ip) || []).filter(t => now - t < win); arr.push(now); hits.set(ip, arr);
  if (hits.size > 5000) hits.clear();
  return arr.length > max;
}
const RATIOS = [["1:1", 1], ["3:4", .75], ["4:3", 4 / 3], ["2:3", 2 / 3], ["3:2", 1.5], ["4:5", .8], ["5:4", 1.25], ["9:16", 9 / 16], ["16:9", 16 / 9]];
const ratioFor = (w, h) => RATIOS.reduce((a, b) => Math.abs(Math.log(b[1] / (w / h))) < Math.abs(Math.log(a[1] / (w / h))) ? b : a)[0];
const b64ToBytes = b => { const s = atob(b); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; };
const withTimeout = (ms) => { const ac = new AbortController(); setTimeout(() => ac.abort(), ms); return ac.signal; };

function findImage(o, depth = 0) {
  if (!o || typeof o !== "object" || depth > 8) return null;
  const data = typeof o.data === "string" && o.data.length > 500 ? o.data : null;
  const mime = o.mime_type || o.mimeType || (o.type === "image" ? "image/png" : null);
  if (data && (mime || o.inline_data || depth > 0)) return { data, mime: mime && mime.startsWith("image/") ? mime : "image/png" };
  if (o.inlineData?.data) return { data: o.inlineData.data, mime: o.inlineData.mimeType || "image/png" };
  if (o.inline_data?.data) return { data: o.inline_data.data, mime: o.inline_data.mime_type || "image/png" };
  for (const v of Array.isArray(o) ? o : Object.values(o)) { const r = findImage(v, depth + 1); if (r) return r; }
  return null;
}
async function gemini(prompt, w, h) {
  const key = env("GEMINI_API_KEY"); if (!key || env("GEMINI_IMAGES", "on") === "off") return null;
  const text = `${prompt}\n\nMake one finished, high-quality image. No text, captions, letters, logos or watermarks anywhere in the image.`;
  const ar = ratioFor(w, h); const H = { "x-goog-api-key": key, "content-type": "application/json" };
  const tries = [
    // current Interactions API (Nano Banana 2.x)
    () => fetch("https://generativelanguage.googleapis.com/v1beta/interactions", { method: "POST", signal: withTimeout(22000), headers: H, body: JSON.stringify({ model: env("GEMINI_IMAGE_MODEL", "gemini-nano-banana-2.1"), input: text, response_format: { type: "image", mime_type: "image/jpeg", aspect_ratio: ar } }) }),
    // legacy generateContent image models
    () => fetch(`https://generativelanguage.googleapis.com/v1beta/models/${env("GEMINI_IMAGE_MODEL_LEGACY", "gemini-2.5-flash-image")}:generateContent`, { method: "POST", signal: withTimeout(22000), headers: H, body: JSON.stringify({ contents: [{ role: "user", parts: [{ text }] }], generationConfig: { responseModalities: ["TEXT", "IMAGE"], imageConfig: { aspectRatio: ar } } }) }),
  ];
  for (const go of tries) {
    const r = await go().catch(() => null);
    if (!r || !r.ok) { if (r && r.status === 429) return null; continue; }
    const j = await r.json().catch(() => null);
    const img = findImage(j);
    if (img) return { bytes: b64ToBytes(img.data), type: img.mime, via: "gemini" };
  }
  return null;
}
async function pollinations(prompt, w, h, seed) {
  const tok = env("POLLINATIONS_TOKEN");
  const u = "https://image.pollinations.ai/prompt/" + encodeURIComponent(prompt) + `?width=${w}&height=${h}&seed=${seed}&nologo=true&model=${env("POLLINATIONS_MODEL", "flux")}&enhance=false`;
  const r = await fetch(u, { signal: withTimeout(22000), headers: tok ? { Authorization: "Bearer " + tok } : {} }).catch(() => null);
  if (!r || !r.ok || !(r.headers.get("content-type") || "").startsWith("image/")) return null;
  return { bytes: new Uint8Array(await r.arrayBuffer()), type: r.headers.get("content-type"), via: tok ? "pollinations-token" : "pollinations" };
}

export default async function handler(req) {
  const url = new URL(req.url);
  const p = (url.searchParams.get("p") || "").slice(0, 1200).trim();
  const w = Math.max(256, Math.min(1536, +url.searchParams.get("w") || 512));
  const h = Math.max(256, Math.min(1536, +url.searchParams.get("h") || 512));
  const seed = Math.max(0, Math.min(999999, +url.searchParams.get("s") || 1));
  const cors = { "access-control-allow-origin": "*" };
  if (p.length < 10) return new Response("Bad request", { status: 400, headers: cors });
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "anon";
  if (limited(ip)) return new Response("Slow down", { status: 429, headers: { ...cors, "retry-after": "60", "cache-control": "no-store" } });
  let out = null;
  const pref = env("IMAGE_PROVIDER", "gemini");
  if (pref !== "pollinations") out = await gemini(p, w, h);
  if (!out) out = await pollinations(p, w, h, seed);
  if (!out && pref === "pollinations") out = await gemini(p, w, h);
  if (!out) return new Response("Painter busy", { status: 503, headers: { ...cors, "retry-after": "30", "cache-control": "no-store" } });
  return new Response(out.bytes, { headers: { ...cors, "content-type": out.type, "x-painter": out.via, "cache-control": "public, max-age=31536000, s-maxage=31536000, immutable" } });
}
