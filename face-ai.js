// Lanternhall: "describe their look" for the face & body creator.
// Adds a text box above the creator; the AI turns the description into creator settings,
// then this script presses the matching options so everything stays editable by hand.
(() => {
  const OPTS = {
    skin: { label: "Skin", tab: "Face", color: true, words: ["very fair","fair","light tan","warm tan","bronze","brown","deep brown","dark"] },
    face: { label: "Face shape", tab: "Face", words: ["oval","round","square","sharp"] },
    eyes: { label: "Eyes", tab: "Face", words: ["round","almond","sharp","sleepy"] },
    eyeC: { label: "Eye color", tab: "Face", color: true, words: ["dark brown","brown","green","blue","grey","amber","red","violet","glowing cyan"] },
    brows: { label: "Brows", tab: "Face", words: ["soft","straight","fierce","arched"] },
    marks: { label: "Marks", tab: "Face", words: ["none","eye scar","cheek scar","freckles","face paint","whiskers"] },
    hair: { label: "Hairstyle", tab: "Hair", words: ["bald","buzz","short","spiky","swept","bob","long","ponytail","braids","afro","bun","mohawk"] },
    hairC: { label: "Hair color", tab: "Hair", color: true, words: ["black","dark brown","brown","auburn","blond","platinum","red","pink","blue","teal","silver","violet"] },
    facial: { label: "Facial hair", tab: "Hair", words: ["none","stubble","moustache","beard","goatee"] },
    build: { label: "Build", tab: "Body", words: ["slim","average","athletic","broad"] },
    outfit: { label: "Outfit", tab: "Body", words: ["tunic","armor","robe","jacket","hoodie","suit"] },
    outC: { label: "Outfit color", tab: "Body", color: true, words: ["crimson","navy","forest green","plum","leather-brown","black","steel-grey","gold","off-white"] },
    bg: { label: "Backdrop", tab: "Body", color: true, words: ["red","orange","gold","green","teal","blue","purple","pink"], aria: ["hue 0","hue 25","hue 45","hue 150","hue 200","hue 230","hue 270","hue 320"] },
    extra: { label: "Accessory", tab: "Extras", words: ["none","eyepatch","glasses","headband","horns","earrings","mask"] },
  };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  let SAMPLE;
  const getSample = async () => { if (SAMPLE !== undefined) return SAMPLE; try { SAMPLE = window.claude && claude.use ? await claude.use("sample") : null; } catch { SAMPLE = null; } return SAMPLE; };

  function prompt(desc) {
    const lines = Object.entries(OPTS).map(([k, o]) => `"${k}": one of ${JSON.stringify(o.words)}`).join(",\n");
    return `Turn this character description into settings for a simple drawn portrait. Pick the closest allowed value for every field. Use "none" when the description doesn't mention marks, facial hair or accessories. "bg" is the background color: pick one that suits the character's mood.
Description: """${desc.slice(0, 600)}"""
Reply with only JSON:
{${lines}}`;
  }

  async function press(creator, key, word) {
    const o = OPTS[key]; const idx = o.words.indexOf(word); if (idx < 0) return false;
    const tab = [...creator.querySelectorAll(".cctl > .row > .chip")].find(b => b.textContent.trim() === o.tab);
    if (tab && tab.getAttribute("aria-pressed") !== "true") { tab.click(); await sleep(30); }
    const sec = [...creator.querySelectorAll(".csec")].find(s => s.querySelector(".label")?.textContent.trim() === o.label);
    if (!sec) return false;
    let btn;
    if (o.color) { const want = `${o.label}: ${o.aria ? o.aria[idx] : word}`; btn = [...sec.querySelectorAll("button")].find(b => b.getAttribute("aria-label") === want); }
    else btn = [...sec.querySelectorAll("button")].find(b => b.textContent.trim() === word);
    if (!btn) return false;
    btn.click(); await sleep(20); return true;
  }

  async function build(creator, desc) {
    const s = await getSample(); if (!s) throw { code: "unavailable" };
    const r = await s.json(prompt(desc), { modelTier: "quick", cache: false, seat: "forge" });
    let n = 0;
    for (const key of Object.keys(OPTS)) if (r && typeof r[key] === "string" && await press(creator, key, r[key].toLowerCase().trim())) n++;
    return n;
  }
  window.lhFace = { build };

  function inject(creator) {
    if (creator.closest("[data-nofacegen]")) return;
    if (creator.previousElementSibling?.classList.contains("facegen")) return;
    const box = document.createElement("div"); box.className = "facegen";
    box.style.cssText = "display:flex;flex-direction:column;gap:8px;margin-bottom:14px";
    const lab = document.createElement("label"); lab.className = "field";
    const span = document.createElement("span"); span.textContent = "Describe their look and the AI builds it";
    const ta = document.createElement("textarea"); ta.id = "faceDesc" + Math.random().toString(36).slice(2, 6); ta.maxLength = 600; ta.style.minHeight = "70px";
    ta.placeholder = "Dark skin, long silver braids, glowing red eyes, a scar over one eye, broad shoulders in black armor";
    lab.append(span, ta);
    const row = document.createElement("div"); row.style.cssText = "display:flex;gap:10px;align-items:center;flex-wrap:wrap";
    const btn = document.createElement("button"); btn.type = "button"; btn.className = "btn small primary"; btn.textContent = "Build face from description";
    const st = document.createElement("span"); st.className = "status";
    row.append(btn, st); box.append(lab, row);
    creator.before(box);
    btn.addEventListener("click", async () => {
      const desc = ta.value.trim();
      if (!desc) { st.textContent = "Type a description first."; return; }
      const s = await getSample();
      if (!s) { st.textContent = "The AI isn't available right now."; return; }
      btn.disabled = true; st.classList.remove("err"); st.textContent = "Shaping the face...";
      try {
        const r = await s.json(prompt(desc), { modelTier: "quick", cache: false, seat: "forge" });
        let n = 0;
        for (const key of Object.keys(OPTS)) if (r && typeof r[key] === "string" && await press(creator, key, r[key].toLowerCase().trim())) n++;
        const look = document.querySelector("#wzLook, [id^=edLook]");
        if (look && !look.value.trim()) { look.value = desc; look.dispatchEvent(new Event("input", { bubbles: true })); }
        st.textContent = n ? "Done. Tweak anything below." : "Couldn't match that description. Try different words.";
      } catch (e) { st.textContent = e && e.code === "rate_limited" ? "The AI needs a short rest. Try again in a minute." : "Something went wrong. Try again."; st.classList.add("err"); }
      btn.disabled = false;
    });
  }

  const scan = () => document.querySelectorAll(".creator").forEach(inject);
  new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });
  if (document.readyState !== "loading") scan(); else document.addEventListener("DOMContentLoaded", scan);
})();
