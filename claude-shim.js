document.addEventListener("DOMContentLoaded", () => { const s = document.createElement("script"); s.src = "/face-ai.js"; document.body.append(s); });
// Lanternhall web adapter: gives the game the same AI, multiplayer and voice
// functions it had inside Claude, backed by this site's own server, Supabase and the browser.
(() => {
  const ls = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch {} } };
  let cfg = {};
  const cfgReady = fetch("/api/config").then(r => r.ok ? r.json() : {}).then(c => { cfg = c || {}; banner(); }).catch(() => { cfg = {}; });

  function banner() {
    if (cfg.aiReady !== false) return;
    const b = document.createElement("div");
    b.textContent = "Setup needed: no AI key is set on the server yet. See the README.";
    b.style.cssText = "position:fixed;left:0;right:0;bottom:0;z-index:100;background:#3a1512;color:#ffd6d1;font:14px system-ui;padding:10px 16px;text-align:center";
    document.addEventListener("DOMContentLoaded", () => document.body.append(b)); if (document.body) document.body.append(b);
  }

  // ---------- access code prompt ----------
  function askCode() {
    return new Promise(res => {
      const wrap = document.createElement("div");
      wrap.style.cssText = "position:fixed;inset:0;z-index:200;background:#000c;display:grid;place-items:center;padding:16px;font:16px system-ui;color:#ece8de";
      wrap.innerHTML = '<form style="background:#0c1018;border:1px solid #232a37;border-radius:14px;padding:22px;width:min(380px,100%);display:flex;flex-direction:column;gap:12px"><b style="font-size:20px">Enter the table password</b><span style="color:#8c94a4;font-size:14px">The owner of this site set a password so only friends use the AI.</span><input id="lhCode" type="password" autocomplete="current-password" style="padding:11px;border-radius:10px;border:1px solid #232a37;background:#121825;color:#ece8de"><button style="padding:11px;border-radius:10px;border:0;background:#f2c14e;font-weight:700">Continue</button></form>';
      document.body.append(wrap);
      const f = wrap.querySelector("form"); wrap.querySelector("input").focus();
      f.addEventListener("submit", e => { e.preventDefault(); ls.set("lh.access", wrap.querySelector("input").value); wrap.remove(); res(); });
    });
  }

  // ---------- sample (AI) ----------
  async function callAI(input, opts = {}, attempt = 0) {
    await cfgReady;
    const messages = typeof input === "string" ? [{ role: "user", content: input }] : input;
    let r;
    try {
      r = await fetch("/api/ai", { method: "POST", signal: opts.signal, headers: { "content-type": "application/json", "x-access-code": ls.get("lh.access") || "" },
        body: JSON.stringify({ messages, tier: opts.modelTier || "default", seat: opts.seat || "gm" }) });
    } catch (e) { throw { code: e && e.name === "AbortError" ? "cancelled" : "upstream_error", message: String(e) }; }
    if (r.status === 401 && attempt < 2) { await askCode(); return callAI(input, opts, attempt + 1); }
    if (r.status === 429) throw { code: "rate_limited", message: await r.text().catch(() => "") };
    if ([500, 502, 503, 504].includes(r.status) && attempt < 2 && !(opts.signal && opts.signal.aborted)) {
      await new Promise(z => setTimeout(z, 2500 * (attempt + 1)));
      return callAI(input, opts, attempt + 1);
    }
    if (!r.ok) { const m = await r.text().catch(() => ""); console.warn("AI error:", m); throw { code: "upstream_error", message: m }; }
    const reader = r.body.getReader(), dec = new TextDecoder(); let text = "";
    try {
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        let delta = dec.decode(value, { stream: true }); if (!delta) continue;
        const e = delta.indexOf("\u0007ERR:");
        if (e >= 0) { text += delta.slice(0, e); throw { code: "upstream_error", text, message: delta.slice(e + 5) }; }
        text += delta; if (opts.onText) { try { opts.onText({ text, delta }); } catch (x) { console.error(x); } }
      }
    } catch (e) { if (e && e.code) throw e; throw { code: e && e.name === "AbortError" ? "cancelled" : "upstream_error", text }; }
    if (!text.trim()) throw { code: "empty_completion" };
    return { text, truncated: false, modelTierApplied: opts.modelTier || "default" };
  }
  function parseJSON(t) {
    const s = String(t).trim();
    try { return JSON.parse(s); } catch {}
    const f = s.match(/```(?:json)?\s*([\s\S]*?)```/); if (f) { try { return JSON.parse(f[1]); } catch {} }
    const a = s.search(/[\[{]/), b = Math.max(s.lastIndexOf("}"), s.lastIndexOf("]"));
    if (a >= 0 && b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch {} }
    return undefined;
  }
  const sample = (input, opts) => callAI(input, opts || {});
  sample.json = async (input, opts) => { const { text } = await callAI(input, opts || {}); const v = parseJSON(text); if (v === undefined) throw { code: "invalid_json", text }; return v; };
  sample.limits = async () => ({ maxPromptBytes: 262144 });

  // ---------- tts (browser voices) ----------
  const VOICE_IDX = { buttery: 0, airy: 1, glassy: 2, rounded: 3 }, PITCH = { buttery: 1, airy: 1.2, glassy: 1.08, rounded: 0.82 };
  const pickVoice = name => { const vs = speechSynthesis.getVoices().filter(v => /^en/i.test(v.lang)); return vs.length ? vs[(VOICE_IDX[name] || 0) % vs.length] : null; };
  const tts = ("speechSynthesis" in window) ? {
    speak(textOrLines, opts = {}) {
      const lines = Array.isArray(textOrLines) ? textOrLines : [{ text: textOrLines, voice: opts.voice }];
      speechSynthesis.cancel();
      return new Promise((res, rej) => {
        let i = 0;
        const next = () => {
          if (i >= lines.length) return res();
          const l = lines[i++], u = new SpeechSynthesisUtterance(String(l.text || "").slice(0, 2000)), vn = l.voice || opts.voice;
          const v = pickVoice(vn); if (v) u.voice = v; u.pitch = PITCH[vn] || 1; u.rate = opts.rate || 1;
          u.onend = next; u.onerror = ev => (ev.error === "interrupted" || ev.error === "canceled") ? rej({ code: "cancelled" }) : next();
          speechSynthesis.speak(u);
        };
        next();
      });
    },
    stop() { speechSynthesis.cancel(); },
    onState() { return () => {}; },
  } : null;

  // ---------- room (Supabase Realtime) ----------
  const myPeer = Math.random().toString(36).slice(2, 12);
  let sb = null;
  function client() {
    if (sb) return sb;
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey || !window.supabase) return null;
    sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { persistSession: false }, realtime: { params: { eventsPerSecond: 10 } } });
    return sb;
  }
  const TOPICS = ["act", "roll", "log", "sync"];
  async function join(name) {
    const c = client(); if (!c) throw { code: "not_permitted" };
    const ch = c.channel("lh-" + name, { config: { broadcast: { self: true }, presence: { key: myPeer } } });
    const listeners = {}, peerFns = []; let snap = [], prev = new Set(), mine = {};
    const sender = peer => ({ peer, by: null, isMe: peer === myPeer, sameTab: peer === myPeer, kind: "viewer", guest: false });
    for (const t of TOPICS) ch.on("broadcast", { event: t }, ({ payload }) => {
      const p = payload || {}; const msg = { topic: t, data: p.data, ...sender(p.peer) };
      (listeners[t] || []).forEach(fn => { try { fn(msg); } catch (e) { console.error(e); } });
    });
    ch.on("presence", { event: "sync" }, () => {
      const st = ch.presenceState();
      const peers = Object.entries(st).map(([k, arr]) => { const m = { ...(arr[arr.length - 1] || {}) }; delete m.presence_ref; return { ...sender(k), presence: m, updatedAt: Date.now() }; });
      const keys = new Set(peers.map(p => p.peer));
      const change = { peers, joined: peers.filter(p => !prev.has(p.peer)), left: snap.filter(p => !keys.has(p.peer)), updated: [] };
      prev = keys; snap = peers; peerFns.forEach(fn => { try { fn(change); } catch (e) { console.error(e); } });
    });
    await new Promise((res, rej) => {
      const to = setTimeout(() => rej({ code: "upstream_error" }), 10000);
      ch.subscribe(status => { if (status === "SUBSCRIBED") { clearTimeout(to); res(); } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") { clearTimeout(to); rej({ code: "upstream_error" }); } });
    });
    return {
      name,
      emit: (topic, data) => ch.send({ type: "broadcast", event: topic, payload: { data, peer: myPeer } }).then(() => {}),
      on(topic, fn) { (listeners[topic] = listeners[topic] || []).push(fn); return () => { listeners[topic] = listeners[topic].filter(x => x !== fn); }; },
      presence(patch) { for (const [k, v] of Object.entries(patch || {})) { if (v === null) delete mine[k]; else mine[k] = v; } return ch.track(mine).then(() => {}); },
      peers: () => snap,
      onPeers(fn) { peerFns.push(fn); return () => { const i = peerFns.indexOf(fn); if (i >= 0) peerFns.splice(i, 1); }; },
      connected: () => true,
      onConnection(fn) { setTimeout(() => fn(true), 0); return () => {}; },
      leave: () => c.removeChannel(ch).then(() => {}),
    };
  }
  const room = { join };

  window.lhCouncil = null; cfgReady.then(() => { window.lhCouncil = cfg.council || null; });
  window.claude = {
    async use(name) {
      await cfgReady;
      if (name === "sample") return sample;
      if (name === "tts") return tts;
      if (name === "room") return (cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase) ? room : null;
      return null; // db and user: the game saves in this browser instead
    },
  };
})();
