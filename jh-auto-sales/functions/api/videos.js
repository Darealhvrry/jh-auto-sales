// Cloudflare Pages Function: GET /api/videos?limit=12
// Returns the newest uploads from the J&H Auto Sales YouTube channel as JSON.
// Optional: set a CHANNEL_ID environment variable (Pages > Settings > Variables)
// to skip the handle lookup. Find it in YouTube Studio > Settings > Channel > Advanced settings.

const HANDLE = "JHautosales";
const CACHE_SECONDS = 1800; // refresh at most every 30 minutes

export async function onRequestGet({ request, env, waitUntil }) {
  const url = new URL(request.url);
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "12", 10) || 12, 1), 15);

  const cache = caches.default;
  const cacheKey = new Request(`${url.origin}/api/videos?limit=${limit}`);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  try {
    const channelId = env.CHANNEL_ID || (await lookupChannelId(HANDLE));
    if (!channelId) throw new Error("channel id not found");

    const feed = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`, {
      cf: { cacheTtl: CACHE_SECONDS },
    });
    if (!feed.ok) throw new Error(`feed ${feed.status}`);

    const videos = parseFeed(await feed.text()).slice(0, limit);
    const res = json({ videos }, 200, CACHE_SECONDS);
    waitUntil(cache.put(cacheKey, res.clone()));
    return res;
  } catch (err) {
    return json({ videos: [], error: String(err.message || err) }, 502, 60);
  }
}

async function lookupChannelId(handle) {
  const res = await fetch(`https://www.youtube.com/@${handle}`, {
    headers: { "User-Agent": "Mozilla/5.0", "Accept-Language": "en-US,en;q=0.9" },
    cf: { cacheTtl: 86400 },
  });
  if (!res.ok) return null;
  const html = await res.text();
  const m =
    html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/) ||
    html.match(/"externalId":"(UC[\w-]{22})"/) ||
    html.match(/"channelId":"(UC[\w-]{22})"/);
  return m ? m[1] : null;
}

export function parseFeed(xml) {
  const out = [];
  for (const entry of xml.match(/<entry>[\s\S]*?<\/entry>/g) || []) {
    const id = pick(entry, /<yt:videoId>([\w-]{11})<\/yt:videoId>/);
    if (!id) continue;
    const title = decode(pick(entry, /<title>([\s\S]*?)<\/title>/) || "");
    const link = pick(entry, /<link rel="alternate" href="([^"]+)"/) || `https://www.youtube.com/shorts/${id}`;
    const published = pick(entry, /<published>([^<]+)<\/published>/);
    out.push({ id, title, url: link, published });
  }
  return out.sort((a, b) => (b.published || "").localeCompare(a.published || ""));
}

function pick(s, re) { const m = s.match(re); return m ? m[1] : null; }

function decode(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

function json(body, status, maxAge) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": `public, max-age=${maxAge}`,
    },
  });
}
