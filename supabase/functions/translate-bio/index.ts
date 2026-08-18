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
