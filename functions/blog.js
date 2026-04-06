
/**
 * functions/blog.js  ←  This file MUST live at this exact path in your project
 * ═══════════════════════════════════════════════════════════════════════════════
 * Cloudflare Pages Function — SSR OG Meta Injector
 *
 * WHAT IT DOES:
 * Social media bots (Facebook, X, LinkedIn, WhatsApp) are pure HTTP
 * scrapers — they never run JavaScript. This function runs SERVER-SIDE
 * on Cloudflare's edge and rewrites your <meta> tags before any bot
 * or browser receives the HTML.
 *
 * Result: every shared link shows the post's real title, description,
 * and cover image — exactly like Citizen TV's link previews.
 *
 * REQUIRED ENV VARIABLES (set in Cloudflare Pages → Settings → Env Vars):
 *   SUPABASE_URL   = https://abgmvftptdkrztfflxbn.supabase.co
 *   SUPABASE_ANON  = eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
 */

/* ── Site constants ──────────────────────────────────────────────────── */
const SITE_URL   = 'https://jamesmainamwangi.com';
const BLOG_URL   = `${SITE_URL}/blog.html`;
const AUTHOR     = 'James Maina Mwangi';
const SITE_NAME  = 'James Maina Mwangi — Engineering Blog';

/**
 * Professional fallback image (1200×630px).
 * Shown when a post has no cover_url, or when sharing the blog homepage.
 * STRONGLY RECOMMENDED: replace this with your own hosted image —
 * upload a 1200×630 photo of yourself or your workspace to Supabase
 * Storage and use that URL instead for maximum brand recognition.
 */
const DEFAULT_IMAGE =
  'https://images.unsplash.com/photo-1517694712202-14dd9538aa97?w=1200&q=80';

/**
 * Known social crawler User-Agent strings.
 * Matching any of these triggers the OG enrichment even on the
 * bare blog URL (no ?post= param) — ensures the list page also
 * gets a proper preview when shared.
 */
const BOTS = [
  'facebookexternalhit',  // Facebook, WhatsApp, Instagram
  'twitterbot',           // X / Twitter
  'linkedinbot',          // LinkedIn
  'telegrambot',          // Telegram
  'slackbot',             // Slack
  'discordbot',           // Discord
  'applebot',             // iMessage / Safari
  'googlebot',            // Google Search
  'bingbot',              // Bing
  'whatsapp',             // WhatsApp belt-and-braces
];

/* ══════════════════════════════════════════════════════════════════════
   PAGES FUNCTION ENTRY POINT
   Cloudflare calls onRequest() for every request to /blog.html
   ══════════════════════════════════════════════════════════════════════ */
export async function onRequest(context) {
  const { request, env } = context;
  const url       = new URL(request.url);
  const ua        = (request.headers.get('user-agent') || '').toLowerCase();
  const postSlug  = url.searchParams.get('post') || '';

  const isBot        = BOTS.some(b => ua.includes(b));
  const hasSlug      = postSlug.length > 0;
  const shouldEnrich = isBot || hasSlug;

  // 1. Always fetch the original static HTML from Pages
  const response = await context.next();

  // 2. If no enrichment needed, return immediately (zero overhead for users)
  if (!shouldEnrich) return response;

  // 3. Fetch post data from Supabase if we have a slug
  const post = hasSlug ? await getPost(postSlug, env) : null;

  // 4. Build the correct meta values for this post (or blog defaults)
  const meta = buildMeta(post, postSlug);

  // 5. Stream the HTML through HTMLRewriter, replacing meta tags on the fly
  return new HTMLRewriter()
    .on('title',                           new SetInnerContent(meta.pageTitle))
    .on('meta[name="description"]',        new SetContent(meta.description))
    .on('link[rel="canonical"]',           new SetHref(meta.url))
    .on('meta[property="og:title"]',       new SetContent(meta.title))
    .on('meta[property="og:description"]', new SetContent(meta.description))
    .on('meta[property="og:url"]',         new SetContent(meta.url))
    .on('meta[property="og:image"]',       new SetContent(meta.image))
    .on('meta[property="og:image:alt"]',   new SetContent(meta.imageAlt))
    .on('meta[property="og:type"]',        new SetContent(meta.type))
    .on('meta[name="twitter:card"]',       new SetContent('summary_large_image'))
    .on('meta[name="twitter:title"]',      new SetContent(meta.title))
    .on('meta[name="twitter:description"]',new SetContent(meta.description))
    .on('meta[name="twitter:image"]',      new SetContent(meta.image))
    .on('meta[name="twitter:image:alt"]',  new SetContent(meta.imageAlt))
    .transform(response);
}

/* ══════════════════════════════════════════════════════════════════════
   SUPABASE REST API QUERY
   Fetches only the 5 columns needed for OG tags — keeps it fast.
   ══════════════════════════════════════════════════════════════════════ */
async function getPost(slug, env) {
  const base = env.SUPABASE_URL  || 'https://abgmvftptdkrztfflxbn.supabase.co';
  const key  = env.SUPABASE_ANON || '';

  const apiUrl =
    `${base}/rest/v1/posts` +
    `?select=title,excerpt,cover_url,slug,cat` +
    `&slug=eq.${encodeURIComponent(slug)}` +
    `&published=eq.true` +
    `&limit=1`;

  try {
    const res = await fetch(apiUrl, {
      headers: {
        'apikey':        key,
        'Authorization': `Bearer ${key}`,
        'Accept':        'application/json',
      },
    });

    if (!res.ok) {
      console.error(`[OG] Supabase ${res.status} for slug: ${slug}`);
      return null;
    }

    const rows = await res.json();
    return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;

  } catch (err) {
    console.error('[OG] Fetch error:', err.message);
    return null;
  }
}

/* ══════════════════════════════════════════════════════════════════════
   META VALUE BUILDER
   Returns a clean, validated object of all tag values.
   ══════════════════════════════════════════════════════════════════════ */
function buildMeta(post, slug) {
  /* ── Helpers ──────────────────────────────────────────────────────── */

  // Strip HTML tags, collapse whitespace, truncate to 160 chars
  function cleanDesc(raw, max = 160) {
    const plain = String(raw || '')
      .replace(/<[^>]*>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    return plain.length > max ? plain.slice(0, max - 1) + '…' : plain;
  }

  // Validate image URL — must be absolute https:// for all platforms
  function validImage(url) {
    const s = String(url || '').trim();
    return s.startsWith('https://') || s.startsWith('http://') ? s : DEFAULT_IMAGE;
  }

  /* ── Per-post meta ────────────────────────────────────────────────── */
  if (post) {
    const image = validImage(post.cover_url);
    const desc  = cleanDesc(post.excerpt);
    const url   = `${BLOG_URL}?post=${encodeURIComponent(post.slug || slug)}`;

    return {
      pageTitle: `${post.title} — ${AUTHOR}`,  // Browser tab + Google SERP
      title:      post.title,                   // OG/Twitter — no author suffix (cleaner)
      description: desc,
      image,
      imageAlt:  `Cover image for: ${post.title}`,
      url,
      type:      'article',
    };
  }

  /* ── Blog homepage defaults ───────────────────────────────────────── */
  return {
    pageTitle:   `Engineering Blog — ${AUTHOR} | Full-Stack & Cybersecurity`,
    title:       `Engineering Blog — ${AUTHOR}`,
    description: cleanDesc(
      '14+ years of engineering insights on Full-Stack development, ' +
      'cybersecurity, M-Pesa integrations, and scalable global architecture.'
    ),
    image:    DEFAULT_IMAGE,
    imageAlt: `${AUTHOR} — Full-Stack Developer & Cybersecurity Specialist`,
    url:      BLOG_URL,
    type:     'website',
  };
}

/* ══════════════════════════════════════════════════════════════════════
   HTMLREWRITER ELEMENT HANDLERS
   Cloudflare streams HTML in chunks — these handlers mutate each
   matching element without buffering the whole document in memory.
   ══════════════════════════════════════════════════════════════════════ */

/** Replaces <title> text content */
class SetInnerContent {
  constructor(text) { this.text = text; }
  element(el)       { el.setInnerContent(this.text); }
}

/** Sets the `content` attribute on <meta> tags */
class SetContent {
  constructor(value) { this.value = value; }
  element(el)        { el.setAttribute('content', this.value); }
}

/** Sets the `href` attribute on <link rel="canonical"> */
class SetHref {
  constructor(href) { this.href = href; }
  element(el)       { el.setAttribute('href', this.href); }
}
