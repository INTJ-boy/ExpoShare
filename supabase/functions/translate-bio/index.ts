// supabase/functions/translate-bio/index.ts
//
// Auto-translates a profile bio into the site's other two languages
// whenever the owner saves their profile. Uses MyMemory's free
// translation API, which needs no account or API key -- unlike the
// send-email function, this one works immediately with zero setup.
//
// Requires the caller to be logged in (verify_jwt: true), since it's
// only ever invoked from the profile edit form for the current user's
// own bio.
//
// NOTES on MyMemory's free tier:
// - Hard limit of 500 BYTES per request (not characters -- Arabic and
//   other multi-byte UTF-8 text hits that ceiling much sooner than
//   500 characters would suggest), so text is truncated to a safe byte
//   budget before being sent.
// - Daily quota is tracked per caller. Anonymous calls share a pool
//   tied to the caller's IP, which for a serverless function is a
//   shared Supabase egress IP used by many unrelated projects. Adding
//   a `de` (contact email) parameter raises the quota 10x (5,000 ->
//   50,000 chars/day) and ties usage to this project specifically
//   instead of that shared anonymous pool. No signup or verification
//   needed for that parameter -- it's just declarative.
// - If the quota or byte limit is ever hit, this returns a 502 and
//   profile.js simply skips updating bio_i18n for that save -- the
//   profile save itself never fails because of it.
//
// Deploy with: supabase functions deploy translate-bio
// (Already deployed directly to the live project during development.)

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const LANGS = ["en", "fr", "ar"];
const CONTACT_EMAIL = "rabahallaa666@gmail.com";
const MAX_BYTES = 480; // stay safely under MyMemory's 500-byte cap

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};

/** Truncates a string so its UTF-8 encoded byte length stays under maxBytes. */
function truncateToBytes(text: string, maxBytes: number): string {
  const encoder = new TextEncoder();
  if (encoder.encode(text).length <= maxBytes) return text;
  let end = text.length;
  while (end > 0 && encoder.encode(text.slice(0, end)).length > maxBytes) {
    end -= 1;
  }
  return text.slice(0, end);
}

async function translateOne(text: string, source: string, target: string): Promise<string> {
  const params = new URLSearchParams({
    q: text,
    langpair: `${source}|${target}`,
    de: CONTACT_EMAIL
  });
  const res = await fetch(`https://api.mymemory.translated.net/get?${params}`);
  if (!res.ok) throw new Error(`Translation request failed (${res.status})`);
  const data = await res.json();
  const translated = data && data.responseData && data.responseData.translatedText;
  if (!translated) throw new Error("No translation returned");
  return translated;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  try {
    const { text, source_lang } = await req.json();

    if (!text || !String(text).trim()) {
      return json({ en: "", fr: "", ar: "" });
    }
    if (!LANGS.includes(source_lang)) {
      return json({ error: "source_lang must be one of en, fr, ar" }, 400);
    }

    const safeText = truncateToBytes(String(text), MAX_BYTES);
    const targets = LANGS.filter((l) => l !== source_lang);
    const results: Record<string, string> = { [source_lang]: text };
    for (const target of targets) {
      results[target] = await translateOne(safeText, source_lang, target);
    }
    return json(results);
  } catch (err) {
    return json({ error: String(err) }, 502);
  }
});

function json(obj: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
  });
}
