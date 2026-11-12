// Tells the browser which features this deployment has switched on. Never returns secret keys.
export const config = { runtime: "edge" };
const env = (k, d = "") => (typeof process !== "undefined" && process.env && process.env[k]) || d;

export default function handler() {
  const keys = { anthropic: !!env("ANTHROPIC_API_KEY"), openai: !!env("OPENAI_API_KEY"), gemini: !!env("GEMINI_API_KEY") };
  const seat = s => { const w = env(`${s}_AI`, "anthropic").toLowerCase(); return keys[w] ? w : (["anthropic", "openai", "gemini"].find(p => keys[p]) || "none"); };
  return new Response(JSON.stringify({
    supabaseUrl: env("SUPABASE_URL"),
    supabaseAnonKey: env("SUPABASE_ANON_KEY"),
    accessRequired: !!env("ACCESS_CODE"),
    aiReady: keys.anthropic || keys.openai || keys.gemini,
    council: { gm: seat("GM"), chronicler: seat("CHRONICLER"), voices: seat("VOICES"), forge: seat("FORGE") },
  }), { headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
