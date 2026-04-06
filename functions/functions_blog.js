/**
 * functions/blog.js
 * ═══════════════════════════════════════════════════════════════════════
 * Cloudflare Pages Function — Social Media OG Meta Injector
 *
 * FILE LOCATION IN YOUR PROJECT:
 *   your-repo/
 *   ├── functions/
 *   │   └── blog.js        ← THIS FILE
 *   ├── blog.html
 *   └── (other files)
 *
 * ENVIRONMENT VARIABLES (Cloudflare Pages → Settings → Environment Variables):
 *   SUPABASE_URL   →  https://abgmvftptdkrztfflxbn.supabase.co
 *   SUPABASE_ANON  →  eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
 *   (Enter WITHOUT quotes)
 *
 * AFTER DEPLOY — clear Facebook cache:
 *   https://developers.facebook.com/tools/debug/
 *   Paste your post URL → click "Scrape Again" twice
 * ═══════════════════════════════════════════════════════════════════════
 */

/* ── Constants ─────────────────────────────────────────────────────── */
const SITE_URL = 'https://jamesmainamwangi.com';
const BLOG_URL = `${SITE_URL}/blog.html`;
const AUTHOR   = 'James Maina Mwangi';

/**
 * Default OG image — shown when sharing the blog homepage or
 * when a post has no cover image. Replace with your own photo
 * (upload to Supabase Storage, use the public URL).
 */
const DEFAULT_IMAGE =
  'https://images.unsplash.com/photo-1517694712202-14dd9538aa97?w=1200&q=80';

const DEFAULTS = {
  title:       `Engineering Blog — ${AUTHOR}`,
  pageTitle:   `Engineering Blog — ${AUTHOR} | Full-Stack & Cybersecurity`,
  description: '14+ years of engineering insights on Full-Stack development, cybersecurity, M-Pesa integrations, and scalable global architecture.',
  image:       DEFAULT_IMAGE,
  imageAlt:    `${AUTHOR} — Full-Stack Developer & Cybersecurity Specialist`,
  url:         BLOG_URL,
  type:        'website',
};

/* ══════════════════════════════════════════════════════════════════════
   ENTRY POINT
   Wrapped in try/catch so ANY unhandled error still serves the page.
   ══════════════════════════════════════════════════════════════════════ */
export async function onRequest(context) {
  try {
    return await handleRequest(context);
  } catch (err) {
    console.error('[OG] Fatal error:', err.message);
    try { return await context.next(); } catch { /* ignore */ }
    return new Response('Blog loading…', {
      status: 200,
      headers: { 'Content-Type': 'text/html;charset=UTF-8' },
    });
  }
}

/* ══════════════════════════════════════════════════════════════════════
   MAIN HANDLER
   ══════════════════════════════════════════════════════════════════════ */
async function handleRequest(context) {
  const { request, env } = context;
  const reqUrl   = new URL(request.url);
  const postSlug = (reqUrl.searchParams.get('post') || '').trim();
  const ua       = (request.headers.get('user-agent') || '').toLowerCase();
  const isBot    = isSocialBot(ua);

  /* Step 1 — Get static HTML from Pages */
  let htmlResponse;
  try {
    htmlResponse = await context.next();
  } catch (err) {
    console.error('[OG] context.next() failed:', err.message);
    return new Response('Not found', { status: 404 });
  }

  /* Step 2 — Pass through non-200 responses unchanged (redirects, 404s) */
  if (!htmlResponse.ok && htmlResponse.status !== 304) {
    return htmlResponse;
  }

  /* Step 3 — Skip enrichment for regular users with no slug */
  if (!postSlug && !isBot) {
    return htmlResponse;
  }

  /* Step 4 — Fetch post from Supabase */
  const post = postSlug ? await fetchPost(postSlug, env) : null;
  console.log(post
    ? `[OG] Post found: "${post.title}"`
    : `[OG] No post for slug "${postSlug}" — using defaults`
  );

  /* Step 5 — Build meta values */
  const meta = buildMeta(post, postSlug);

  /* Step 6 — Make a mutable copy of the response */
  const response = new Response(htmlResponse.body, {
    status:     htmlResponse.status,
    statusText: htmlResponse.statusText,
    headers:    new Headers(htmlResponse.headers),
  });

  /* Instruct CDN to cache post pages for 5 min, homepage for 1 hour */
  response.headers.set(
    'Cache-Control',
    postSlug ? 'public, max-age=300, s-maxage=300'
             : 'public, max-age=3600, s-maxage=3600'
  );

  /* Step 7 — Rewrite meta tags with HTMLRewriter */
  return new HTMLRewriter()
    .on('title',                             new ReplaceText(meta.pageTitle))
    .on('meta[name="description"]',          new SetAttr('content', meta.description))
    .on('link[rel="canonical"]',             new SetAttr('href',    meta.url))
    .on('meta[property="og:title"]',         new SetAttr('content', meta.title))
    .on('meta[property="og:description"]',   new SetAttr('content', meta.description))
    .on('meta[property="og:url"]',           new SetAttr('content', meta.url))
    .on('meta[property="og:image"]',         new SetAttr('content', meta.image))
    .on('meta[property="og:image:alt"]',     new SetAttr('content', meta.imageAlt))
    .on('meta[property="og:image:width"]',   new SetAttr('content', '1200'))
    .on('meta[property="og:image:height"]',  new SetAttr('content', '630'))
    .on('meta[property="og:type"]',          new SetAttr('content', meta.type))
    .on('meta[property="og:site_name"]',     new SetAttr('content', `${AUTHOR} — Engineering Blog`))
    .on('meta[name="twitter:card"]',         new SetAttr('content', 'summary_large_image'))
    .on('meta[name="twitter:title"]',        new SetAttr('content', meta.title))
    .on('meta[name="twitter:description"]',  new SetAttr('content', meta.description))
    .on('meta[name="twitter:image"]',        new SetAttr('content', meta.image))
    .on('meta[name="twitter:image:alt"]',    new SetAttr('content', meta.imageAlt))
    .transform(response);
}

/* ══════════════════════════════════════════════════════════════════════
   SUPABASE FETCH
   ══════════════════════════════════════════════════════════════════════ */
async function fetchPost(slug, env) {
  /* Strip accidental quotes from env vars entered in the dashboard */
  const base = String(env.SUPABASE_URL  || '').trim().replace(/^["']|["']$/g, '');
  const key  = String(env.SUPABASE_ANON || '').trim().replace(/^["']|["']$/g, '');

  if (!base || !key) {
    console.error('[OG] Missing SUPABASE_URL or SUPABASE_ANON env vars');
    return null;
  }

  /* Build URL using URLSearchParams — avoids any encoding mistakes */
  const apiUrl = `${base}/rest/v1/posts?select=title%2Cexcerpt%2Ccover_url%2Cslug%2Ccat&slug=eq.${encodeURIComponent(slug)}&limit=1`;

  /* 4-second timeout — never block the page response for a slow DB */
  const controller = new AbortController();
  const timeout    = setTimeout(() => controller.abort(), 4000);

  try {
    const res = await fetch(apiUrl, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'apikey':        key,
        'Authorization': `Bearer ${key}`,
        'Accept':        'application/json',
        'Prefer':        'return=representation',
      },
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error(`[OG] Supabase HTTP ${res.status}: ${body.slice(0, 300)}`);
      return null;
    }

    const rows = await res.json().catch(() => []);
    return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;

  } catch (err) {
    clearTimeout(timeout);
    console.error(
      err.name === 'AbortError'
        ? '[OG] Supabase timed out after 4s'
        : `[OG] Supabase fetch error: ${err.message}`
    );
    return null;
  }
}

/* ══════════════════════════════════════════════════════════════════════
   META BUILDER
   ══════════════════════════════════════════════════════════════════════ */
function buildMeta(post, slug) {

  function clean(raw, max = 200) {
    const s = String(raw || '')
      .replace(/<[^>]*>/g, '')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ').trim();
    return s.length > max ? s.slice(0, max - 1) + '…' : s;
  }

  function safeImg(url) {
    try {
      const u = new URL(String(url || '').trim());
      if (u.protocol === 'https:' || u.protocol === 'http:') return u.href;
    } catch { /* fall through */ }
    return DEFAULT_IMAGE;
  }

  if (post && post.title) {
    const title = clean(post.title, 100);
    const desc  = clean(post.excerpt, 160) || DEFAULTS.description;
    const image = safeImg(post.cover_url);
    const url   = `${BLOG_URL}?post=${encodeURIComponent(post.slug || slug)}`;
    return {
      pageTitle:   `${title} — ${AUTHOR}`,
      title,
      description: desc,
      image,
      imageAlt:    `Cover image for: ${title}`,
      url,
      type:        'article',
    };
  }

  return { ...DEFAULTS };
}

/* ══════════════════════════════════════════════════════════════════════
   BOT DETECTION
   ══════════════════════════════════════════════════════════════════════ */
function isSocialBot(ua) {
  return [
    'facebookexternalhit', 'facebot', 'twitterbot', 'linkedinbot',
    'whatsapp', 'telegrambot', 'slackbot', 'discordbot', 'applebot',
    'googlebot', 'bingbot', 'pinterest', 'vkshare',
  ].some(b => ua.includes(b));
}

/* ══════════════════════════════════════════════════════════════════════
   HTMLREWRITER HANDLERS
   ══════════════════════════════════════════════════════════════════════ */

/** Replace all content inside <title>…</title> */
class ReplaceText {
  constructor(text) { this.text = text; }
  element(el) { el.setInnerContent(this.text); }
}

/** Set a single attribute on any element */
class SetAttr {
  constructor(attr, value) {
    this.attr  = attr;
    this.value = String(value ?? '');
  }
  element(el) { el.setAttribute(this.attr, this.value); }
}
