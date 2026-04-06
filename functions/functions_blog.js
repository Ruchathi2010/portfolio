/**
 * functions/blog.js
 * Cloudflare Pages Function — SSR OG Meta Injector
 */

/* ── Site constants ──────────────────────────────────────────────────── */
const SITE_URL   = 'https://jamesmainamwangi.com';
const BLOG_URL   = `${SITE_URL}/blog.html`;
const AUTHOR     = 'James Maina Mwangi';

/**
 * Professional fallback image (1200×630px).
 */
const DEFAULT_IMAGE =
  'https://images.unsplash.com/photo-1517694712202-14dd9538aa97?w=1200&q=80';

/**
 * Known social crawler User-Agent strings.
 */
const BOTS = [
  'facebookexternalhit', 
  'twitterbot',          
  'linkedinbot',         
  'telegrambot',         
  'slackbot',            
  'discordbot',          
  'applebot',            
  'googlebot',           
  'bingbot',             
  'whatsapp',            
];

/* ══════════════════════════════════════════════════════════════════════
   PAGES FUNCTION ENTRY POINT
   ══════════════════════════════════════════════════════════════════════ */
export async function onRequest(context) {
  const { request, env } = context;
  const url       = new URL(request.url);
  const ua        = (request.headers.get('user-agent') || '').toLowerCase();
  const postSlug  = url.searchParams.get('post') || '';

  const isBot        = BOTS.some(b => ua.includes(b));
  const hasSlug      = postSlug.length > 0;
  const shouldEnrich = isBot || hasSlug;

  // 1. Fetch the original static HTML
  const response = await context.next();

  // 2. If no enrichment needed, return immediately
  if (!shouldEnrich) return response;

  // 3. Fetch post data from Supabase
  const post = hasSlug ? await getPost(postSlug, env) : null;

  // 4. Build the meta values
  const meta = buildMeta(post, postSlug);

  // 5. Transform the HTML on the fly
  return new HTMLRewriter()
    .on('title',                            new SetInnerContent(meta.pageTitle))
    .on('meta[name="description"]',         new SetContent(meta.description))
    .on('link[rel="canonical"]',            new SetHref(meta.url))
    .on('meta[property="og:title"]',        new SetContent(meta.title))
    .on('meta[property="og:description"]',  new SetContent(meta.description))
    .on('meta[property="og:url"]',          new SetContent(meta.url))
    .on('meta[property="og:image"]',        new SetContent(meta.image))
    .on('meta[property="og:image:alt"]',    new SetContent(meta.imageAlt))
    .on('meta[property="og:type"]',         new SetContent(meta.type))
    .on('meta[name="twitter:card"]',        new SetContent('summary_large_image'))
    .on('meta[name="twitter:title"]',       new SetContent(meta.title))
    .on('meta[name="twitter:description"]', new SetContent(meta.description))
    .on('meta[name="twitter:image"]',       new SetContent(meta.image))
    .on('meta[name="twitter:image:alt"]',   new SetContent(meta.imageAlt))
    .transform(response);
}

/* ══════════════════════════════════════════════════════════════════════
   SUPABASE REST API QUERY
   ══════════════════════════════════════════════════════════════════════ */
async function getPost(slug, env) {
  // Use Dashboard Variables, or hardcoded fallbacks to prevent 1101 errors
  const base = env.SUPABASE_URL  || 'https://abgmvftptdkrztfflxbn.supabase.co';
  const key  = env.SUPABASE_ANON || '';

  if (!key) {
    console.error("Missing SUPABASE_ANON key. Please check Cloudflare Settings.");
    return null;
  }

  const apiUrl =
    `${base}/rest/v1/posts` +
    `?select=title,excerpt,cover_url,slug` +
    `&slug=eq.${encodeURIComponent(slug)}` +
    `&published=eq.true` +
    `&limit=1`;

  try {
    const res = await fetch(apiUrl, {
      headers: {
        'apikey': key,
        'Authorization': `Bearer ${key}`,
        'Accept': 'application/json',
      },
    });

    if (!res.ok) return null;

    const rows = await res.json();
    return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;

  } catch (err) {
    console.error('[OG] Fetch error:', err.message);
    return null;
  }
}

/* ══════════════════════════════════════════════════════════════════════
   META VALUE BUILDER
   ══════════════════════════════════════════════════════════════════════ */
function buildMeta(post, slug) {
  function cleanDesc(raw, max = 160) {
    const plain = String(raw || '')
      .replace(/<[^>]*>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    return plain.length > max ? plain.slice(0, max - 1) + '…' : plain;
  }

  function validImage(url) {
    const s = String(url || '').trim();
    return s.startsWith('http') ? s : DEFAULT_IMAGE;
  }

  if (post) {
    return {
      pageTitle: `${post.title} — ${AUTHOR}`,
      title: post.title,
      description: cleanDesc(post.excerpt),
      image: validImage(post.cover_url),
      imageAlt: `Cover image for: ${post.title}`,
      url: `${BLOG_URL}?post=${encodeURIComponent(post.slug || slug)}`,
      type: 'article',
    };
  }

  return {
    pageTitle: `Engineering Blog — ${AUTHOR}`,
    title: `Engineering Blog — ${AUTHOR}`,
    description: 'Insights on Full-Stack development and cybersecurity.',
    image: DEFAULT_IMAGE,
    imageAlt: AUTHOR,
    url: BLOG_URL,
    type: 'website',
  };
}

/* ══════════════════════════════════════════════════════════════════════
   HTMLREWRITER ELEMENT HANDLERS
   ══════════════════════════════════════════════════════════════════════ */
class SetInnerContent {
  constructor(text) { this.text = text; }
  element(el) { el.setInnerContent(this.text); }
}

class SetContent {
  constructor(value) { this.value = value; }
  element(el) { el.setAttribute('content', this.value); }
}

class SetHref {
  constructor(href) { this.href = href; }
  element(el) { el.setAttribute('href', this.href); }
}
