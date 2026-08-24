/**
 * functions/shop/[slug].js
 * ─────────────────────────────────────────────────────────────────
 * Cloudflare Pages Function. Requests to /shop/<anything> hit this
 * automatically (file-based routing) — e.g. /shop/dell-latitude-5510.
 *
 * WHAT THIS ACTUALLY NEEDS TO DO, GIVEN THE GOAL IS "GET FOUND IN
 * SEARCH", NOT JUST "LOOK RIGHT WHEN SHARED":
 *
 * Meta tags and JSON-LD tell a crawler what the page is ABOUT. They
 * don't give it anything to actually index and rank on — that has
 * to be real text content in the HTML. shop.html only fills in the
 * product modal (name, description, specs) via JavaScript, after
 * the page loads and openProductDetail() fetches the row. Google's
 * crawler can execute JS and often does render it, but that's a
 * slower, unreliable second pass — plenty of product pages sit
 * un-indexed for weeks because the renderer never got around to
 * them. Bing, DuckDuckGo, and most other engines are far worse at
 * this than Google.
 *
 * So this does two things instead of one:
 *   1. Rewrites <title>/meta/OG/JSON-LD.
 *   2. Injects a real, visible <section> directly into the HTML
 *      body — name, image, description, price, specs — so a crawler
 *      sees actual indexable text on the very first response, no JS
 *      required. This is standard progressive enhancement (server-
 *      render real content, then hand off to the richer JS UI), not
 *      hidden/cloaked content: it's the same info the modal shows,
 *      visible to a real visitor for the instant before the modal
 *      opens over it.
 *
 * FLOW:
 *   1. Fetch the product row from Supabase (server-side).
 *   2. Fetch shop.html.
 *   3. Prepend <base href="/"> so shop.html's relative asset/nav
 *      paths still resolve when served from /shop/<slug>.
 *   4. Rewrite head tags, append canonical/OG/Twitter/JSON-LD.
 *   5. Prepend the visible SEO content block (with the product name
 *      as the page's <h1>) right after <body>.
 *   6. Demote shop.html's own hero heading (#shopHeroTitle) from h1
 *      to h2 — on a product URL, the product name is the one h1;
 *      the catalogue tagline is a different page's heading, and
 *      leaving it as h1 would mean two h1s on the same page.
 *   7. Append a script that opens the interactive modal on load and
 *      hides the SEO block once it does (so a real visitor sees the
 *      normal shop UI, not duplicated content).
 *
 * DEPLOY: no config needed — Cloudflare Pages wires up the route
 * from the `functions/` folder automatically.
 *
 * AFTER DEPLOYING — indexing itself still takes real-world time:
 *   - Submit https://jamesmainamwangi.com/sitemap.xml in Google
 *     Search Console (Sitemaps tab) so Google knows every product
 *     URL exists, rather than waiting to discover them by crawling.
 *   - Use Search Console's URL Inspection tool → "Request indexing"
 *     on a few key product pages to speed up the first crawl.
 *   - Verify robots.txt isn't blocking /shop/.
 *   - New sites/pages commonly take days to a few weeks to appear in
 *     search even when everything above is correct.
 */

const SUPABASE_URL  = 'https://abgmvftptdkrztfflxbn.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFiZ212ZnRwdGRrcnp0ZmZseGJuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwODY2ODgsImV4cCI6MjA4OTY2MjY4OH0.WstNFP-z1BnaVE-LuDHx1qU-4H342t2DaU7Lud_Vvi4';
const SITE_URL       = 'https://jamesmainamwangi.com';

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function stripHtml(html) {
  return String(html || '').replace(/<[^>]*>/g, '');
}

function formatPrice(amount, currency) {
  if (currency === 'USD') return '$' + Number(amount).toFixed(2);
  return 'KES ' + Number(amount || 0).toLocaleString('en-KE');
}

async function fetchProduct(slug) {
  const url =
    `${SUPABASE_URL}/rest/v1/products` +
    `?slug=eq.${encodeURIComponent(slug)}` +
    `&active=eq.true` +
    `&select=id,sku,slug,name,description,expert_verdict,meta_description,` +
    `tech_specs,price,original_price,currency,category,tags,image_url,` +
    `image_urls,stock,active,rating,review_count,featured`;

  const res = await fetch(url, {
    headers: {
      apikey: SUPABASE_ANON,
      Authorization: `Bearer ${SUPABASE_ANON}`,
    },
  });

  if (!res.ok) return null;
  const rows = await res.json();
  return rows[0] || null;
}

function buildJsonLd(p, images) {
  const jsonLd = {
    '@context': 'https://schema.org/',
    '@type': 'Product',
    name: p.name,
    image: images,
    description: p.meta_description || p.description || '',
    brand: { '@type': 'Brand', name: 'James Mwangi' },
    offers: {
      '@type': 'Offer',
      priceCurrency: p.currency || 'KES',
      price: String(p.price),
      availability: p.stock > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      url: `${SITE_URL}/shop/${p.slug}`,
    },
  };

  if (p.rating && p.review_count) {
    jsonLd.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: String(p.rating),
      reviewCount: String(p.review_count),
    };
  }

  return JSON.stringify(jsonLd);
}

/** Real, visible, crawlable product content — server-rendered, no JS required to read it */
function buildSeoBlock(p, images, description) {
  const specsRows = (p.tech_specs && typeof p.tech_specs === 'object')
    ? Object.entries(p.tech_specs).map(([key, val]) => {
        const label = key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
        const value = Array.isArray(val) ? val.join(', ')
          : (val && typeof val === 'object') ? JSON.stringify(val)
          : String(val);
        return `<tr><td style="padding:.5rem .75rem;color:#94a3b8;font-size:.8rem;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid #1e293b;">${esc(label)}</td><td style="padding:.5rem .75rem;border-bottom:1px solid #1e293b;">${esc(value)}</td></tr>`;
      }).join('')
    : '';

  return `
<section id="seoProductBlock" style="max-width:900px;margin:6.5rem auto 2rem;padding:0 1.5rem;font-family:sans-serif;color:#e2e8f0;">
  <nav style="font-size:.75rem;color:#94a3b8;margin-bottom:1rem;">
    <a href="/shop.html" style="color:#94a3b8;">Shop</a>${p.category ? ` / ${esc(p.category)}` : ''}
  </nav>
  <h1 style="font-size:1.85rem;font-weight:800;margin-bottom:.75rem;line-height:1.2;">${esc(p.name)}</h1>
  ${images[0] ? `<img src="${esc(images[0])}" alt="${esc(p.name)}" width="600" height="450" style="width:100%;max-width:480px;border-radius:12px;margin-bottom:1rem;display:block;">` : ''}
  <p style="font-size:1.4rem;font-weight:700;margin-bottom:1rem;">
    ${esc(formatPrice(p.price, p.currency))}
    ${p.original_price ? `<span style="font-size:.9rem;color:#94a3b8;text-decoration:line-through;margin-left:.5rem;">${esc(formatPrice(p.original_price, p.currency))}</span>` : ''}
  </p>
  <p style="font-size:1rem;line-height:1.7;color:#cbd5e1;margin-bottom:1.25rem;max-width:65ch;">${esc(description)}</p>
  ${specsRows ? `<h2 style="font-size:1.1rem;font-weight:700;margin:1.5rem 0 .75rem;">Specifications</h2><table style="width:100%;max-width:600px;border-collapse:collapse;font-size:.85rem;">${specsRows}</table>` : ''}
  ${p.expert_verdict ? `<h2 style="font-size:1.1rem;font-weight:700;margin:1.5rem 0 .75rem;">Expert Verdict</h2><p style="font-size:.9rem;line-height:1.7;color:#cbd5e1;max-width:65ch;">${esc(p.expert_verdict)}</p>` : ''}
</section>`;
}

class TextSetter {
  constructor(text) { this.text = text; }
  element(el) { el.setInnerContent(this.text); }
}

class AttrSetter {
  constructor(attr, value) { this.attr = attr; this.value = value; }
  element(el) { el.setAttribute(this.attr, this.value); }
}

class Prepender {
  constructor(html) { this.html = html; }
  element(el) { el.prepend(this.html, { html: true }); }
}

class Appender {
  constructor(html) { this.html = html; }
  element(el) { el.append(this.html, { html: true }); }
}

/** Renames an element's tag (e.g. h1 → h2) while keeping its attributes/content */
class TagRenamer {
  constructor(newTagName) { this.newTagName = newTagName; }
  element(el) { el.tagName = this.newTagName; }
}

export async function onRequestGet({ params, request }) {
  const slug = params.slug;

  if (!slug || !SLUG_RE.test(slug)) {
    return new Response('Not found', { status: 404 });
  }

  const [product, shellRes] = await Promise.all([
    fetchProduct(slug),
    fetch(new URL('/shop.html', request.url)),
  ]);

  if (!product) {
    return new Response(shellRes.body, {
      status: 404,
      headers: { 'content-type': 'text/html; charset=UTF-8' },
    });
  }

  const images = Array.isArray(product.image_urls) && product.image_urls.length
    ? product.image_urls.filter(Boolean)
    : (product.image_url ? [product.image_url] : []);

  const title       = `${product.name} — James Mwangi Tech Shop`;
  const description = product.meta_description || stripHtml(product.description).slice(0, 160);
  const image       = images[0] || '';
  const pageUrl      = `${SITE_URL}/shop/${product.slug}`;
  const jsonLd       = buildJsonLd(product, images);
  const seoBlock     = buildSeoBlock(product, images, product.meta_description || stripHtml(product.description || ''));

  const modalOpenScript = `
    <script>
      window.addEventListener('load', function () {
        var seo = document.getElementById('seoProductBlock');
        if (typeof openProductDetail === 'function') {
          openProductDetail(${JSON.stringify(product.slug)});
          if (seo) seo.style.display = 'none';
        }
      });
    </script>`;

  const headExtras = `
    <link rel="canonical" href="${pageUrl}">
    <meta property="og:image" content="${image}">
    <meta property="og:url" content="${pageUrl}">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${esc(product.name)}">
    <meta name="twitter:description" content="${esc(description)}">
    <meta name="twitter:image" content="${image}">
    <script type="application/ld+json">${jsonLd}</script>`;

  const rewriter = new HTMLRewriter()
    .on('head', new Prepender('<base href="/">'))
    .on('head', new Appender(headExtras))
    .on('title', new TextSetter(title))
    .on('meta[name="description"]', new AttrSetter('content', description))
    .on('meta[property="og:title"]', new AttrSetter('content', product.name))
    .on('meta[property="og:description"]', new AttrSetter('content', description))
    .on('meta[property="og:type"]', new AttrSetter('content', 'product'))
    .on('body', new Prepender(seoBlock))
    // The SEO block above already provides this page's one h1 (the
    // product name) — demote shop.html's own hero heading so it
    // doesn't compete as a second h1 on the same URL.
    .on('#shopHeroTitle', new TagRenamer('h2'))
    .on('body', new Appender(modalOpenScript));

  const rewritten = rewriter.transform(shellRes);

  return new Response(rewritten.body, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=UTF-8',
      'cache-control': 'public, max-age=300, s-maxage=3600',
    },
  });
}
