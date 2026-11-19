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
    if (r.status === 429) { const m = await r.text().catch(() => ""); throw { code: m === "daily_limit" ? "daily_limit" : "rate_limited", message: m }; }
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
  // natural-sounding voices first; each character gets its own consistent voice
  const FEM = /female|zira|aria|jenny|samantha|karen|moira|tessa|fiona|libby|sonia|natasha|emma|ava|michelle|susan|hazel|catherine|serena|allison|joanna|salli|kendra|kimberly|ivy|amy|olivia|ana|clara|elsa|nova|shimmer|victoria|kate/i;
  const MAL = /\bmale\b|david|guy|ryan|daniel|alex|fred|thomas|mark|christopher|eric|brian|andrew|george|james|arthur|oliver|rishi|aaron|tom|liam|william|davis|tony|roger|steffan|connor|mitchell|matthew|joey|justin/i;
  const score = v => (/natural|neural/i.test(v.name) ? 60 : 0) + (/online/i.test(v.name) ? 25 : 0) + (/google/i.test(v.name) ? 20 : 0) + (/premium|enhanced|siri/i.test(v.name) ? 30 : 0) + (/^en[-_](us|gb)/i.test(v.lang) ? 6 : 0) - (/espeak|compact|novelty|whisper|bells|bahh|zarvox|trinoids|bad news|good news|jester|organ|bubbles|cellos|wobble|boing|deranged|hysterical|albert|fred|junior|ralph|kathy|princess|superstar|grandma|grandpa|eddy|flo|reed|rocko|sandy|shelley/i.test(v.name) ? 80 : 0) - (v.localService === false && !/google|online|natural/i.test(v.name) ? 5 : 0);
  let ranked = [];
  const refresh = () => { ranked = speechSynthesis.getVoices().filter(v => /^en/i.test(v.lang)).sort((a, b) => score(b) - score(a)); };
  if ("speechSynthesis" in window) { refresh(); speechSynthesis.addEventListener?.("voiceschanged", refresh); }
  const h = s => { let x = 7; for (const c of String(s)) x = (x * 31 + c.charCodeAt(0)) >>> 0; return x; };
  const good = () => { const top = ranked.filter(v => score(v) >= 20); return top.length >= 2 ? top : ranked.slice(0, 8); };
  const narrator = () => { const want = ls.get("lh.voice"); const v = want && ranked.find(x => x.voiceURI === want); if (v) return v; const g = good(); return g.find(x => MAL.test(x.name)) || g[0] || null; };
  const castFor = (name, gender) => {
    const g = good(), n = narrator(); let pool = g.filter(v => v !== n);
    if (gender === "f") pool = pool.filter(v => FEM.test(v.name)).concat(pool.filter(v => !MAL.test(v.name) && !FEM.test(v.name)));
    if (gender === "m") pool = pool.filter(v => MAL.test(v.name)).concat(pool.filter(v => !MAL.test(v.name) && !FEM.test(v.name)));
    if (!pool.length) pool = g.length ? g : ranked;
    const k = h(name); const v = pool[k % Math.min(pool.length, 6)] || n;
    const pitchBase = gender === "f" ? 1.08 : gender === "m" ? 0.9 : 1;
    return { v, pitch: Math.max(0.6, Math.min(1.4, pitchBase + ((k >> 3) % 9 - 4) * 0.04 + (v === n ? (gender === "f" ? 0.2 : -0.18) : 0))), rate: 0.94 + ((k >> 7) % 5) * 0.03 };
  };
  const LEGACY = { buttery: { p: 1 }, airy: { p: 1.15 }, glassy: { p: 1.05 }, rounded: { p: 0.85 } };
  const voiceOf = vn => {
    if (!vn || vn === "narrator") return { v: narrator(), pitch: 0.96, rate: 0.95 };
    if (String(vn).startsWith("npc:")) { const [nm, gd] = String(vn).slice(4).split("|"); return castFor(nm, gd); }
    const L = LEGACY[vn]; return { v: ranked[(Object.keys(LEGACY).indexOf(vn) + 1) % Math.max(1, ranked.length)] || narrator(), pitch: L ? L.p : 1, rate: 0.97 };
  };
  // split into sentences so the voice breathes and long text never gets cut off
  const chunks = s => String(s || "").replace(/\s+/g, " ").match(/[^.!?…]+[.!?…]+["'”’)]*\s*|[^.!?…]+$/g)?.map(x => x.trim()).filter(Boolean) || [];
  const tts = ("speechSynthesis" in window) ? {
    speak(textOrLines, opts = {}) {
      const lines = Array.isArray(textOrLines) ? textOrLines : [{ text: textOrLines, voice: opts.voice }];
      speechSynthesis.cancel(); if (!ranked.length) refresh();
      const q = []; for (const l of lines) { const vv = voiceOf(l.voice || opts.voice); for (const c of chunks(l.text).slice(0, 60)) q.push({ c, vv, gap: false }); if (q.length) q[q.length - 1].gap = true; }
      return new Promise((res, rej) => {
        let i = 0;
        const next = () => {
          if (i >= q.length) return res();
          const { c, vv, gap } = q[i++]; const u = new SpeechSynthesisUtterance(c.slice(0, 400));
          if (vv.v) { u.voice = vv.v; u.lang = vv.v.lang; } u.pitch = vv.pitch; u.rate = (opts.rate || 1) * vv.rate; u.volume = opts.vol == null ? 1 : Math.max(0, Math.min(1, +opts.vol));
          u.onend = () => gap ? setTimeout(next, 280) : next(); u.onerror = ev => (ev.error === "interrupted" || ev.error === "canceled") ? rej({ code: "cancelled" }) : next();
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
    sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { persistSession: false }, realtime: { params: { eventsPerSecond: 40 } } });
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
    const connFns = []; let up = false, first = true, left = false;
    const setUp = v => { if (up === v) return; up = v; connFns.forEach(fn => { try { fn(v); } catch (e) { console.error(e); } }); };
    await new Promise((res, rej) => {
      const to = setTimeout(() => rej({ code: "upstream_error" }), 12000);
      ch.subscribe(status => {
        if (left) return;
        if (status === "SUBSCRIBED") {
          if (first) { first = false; clearTimeout(to); up = true; res(); return; }
          if (Object.keys(mine).length) ch.track(mine).catch(() => {});
          setUp(true);
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          if (first) { clearTimeout(to); rej({ code: "upstream_error" }); return; }
          setUp(false);
        }
      });
    });
    const onVis = () => { if (document.visibilityState === "visible" && !left) { if (Object.keys(mine).length) ch.track(mine).catch(() => {}); connFns.forEach(fn => { try { fn(true, "wake"); } catch {} }); } };
    document.addEventListener("visibilitychange", onVis);
    const send = async (topic, data) => { for (let i = 0; i < 5; i++) { const r = await ch.send({ type: "broadcast", event: topic, payload: { data, peer: myPeer } }).catch(() => "error"); if (r === "ok") return; await new Promise(z => setTimeout(z, 250 * (i + 1))); } };
    return {
      name,
      emit: (topic, data) => send(topic, data),
      on(topic, fn) { (listeners[topic] = listeners[topic] || []).push(fn); return () => { listeners[topic] = listeners[topic].filter(x => x !== fn); }; },
      presence(patch) { for (const [k, v] of Object.entries(patch || {})) { if (v === null) delete mine[k]; else mine[k] = v; } return ch.track(mine).then(() => {}); },
      peers: () => snap,
      onPeers(fn) { peerFns.push(fn); return () => { const i = peerFns.indexOf(fn); if (i >= 0) peerFns.splice(i, 1); }; },
      connected: () => up,
      onConnection(fn) { connFns.push(fn); return () => { const i = connFns.indexOf(fn); if (i >= 0) connFns.splice(i, 1); }; },
      leave: () => { left = true; document.removeEventListener("visibilitychange", onVis); return c.removeChannel(ch).then(() => {}); },
    };
  }
  const room = { join };

  // ---------- cloud saves (Supabase table lh_saves; each row is readable only with its owner's player code) ----------
  const genCode = () => { const A = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; const r = crypto.getRandomValues(new Uint8Array(20)); return [...r].map(x => A[x % A.length]).join("").replace(/(.{5})(?!$)/g, "$1-"); };
  let owner = ls.get("lh.player"); if (!owner) { owner = genCode(); ls.set("lh.player", owner); }
  let cdb = null, cdbOwner = null, cloudState = null;
  const cloud = () => {
    if (!cdb || cdbOwner !== owner) { cdb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { global: { headers: { "x-lh-owner": owner } }, auth: { persistSession: false, autoRefreshToken: false, storageKey: "lh-cloud" } }); cdbOwner = owner; }
    return cdb.from("lh_saves");
  };
  window.lhCloud = {
    code: () => owner,
    setCode(c) { c = String(c || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, ""); if (c.length < 16) return false; c = c.replace(/(.{5})(?!$)/g, "$1-"); owner = c; ls.set("lh.player", c); cloudState = null; return true; },
    async available() {
      if (cloudState !== null) return cloudState;
      await cfgReady;
      if (!cfg.supabaseUrl || !cfg.supabaseAnonKey || !window.supabase) return (cloudState = false);
      try { const { error } = await cloud().select("key").limit(1); cloudState = !error; } catch { cloudState = false; }
      return cloudState;
    },
    async pull() { const { data, error } = await cloud().select("key,data,updated_at"); if (error) throw error; return data || []; },
    async put(key, data) { const { error } = await cloud().upsert({ owner, key, data, updated_at: new Date().toISOString() }); if (error) throw error; },
    async del(key) { const { error } = await cloud().delete().eq("owner", owner).eq("key", key); if (error) throw error; },
  };

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
