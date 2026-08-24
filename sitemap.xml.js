/**
 * functions/sitemap.xml.js
 * ─────────────────────────────────────────────────────────────────
 * Cloudflare Pages Function. File-based routing means requests to
 * /sitemap.xml hit this function directly — no extra config needed.
 *
 * Queries Supabase for every active product and emits a standard
 * sitemap <urlset>, one <url> per product page at /shop/<slug>,
 * plus your top-level shop page.
 *
 * NOTE ON `updated_at`: your products schema as given doesn't list
 * an updated_at column, but loadProducts() in shop.html already
 * orders by created_at, so the table likely has at least that.
 * This function tries updated_at first (best for <lastmod>) and
 * transparently falls back to created_at, then to no lastmod at all,
 * so it won't break if one of those columns isn't present. If
 * updated_at doesn't exist yet, add it with:
 *
 *   alter table products add column updated_at timestamptz default now();
 *   -- and a trigger to bump it on every update, e.g.:
 *   create or replace function set_updated_at() returns trigger as $$
 *   begin new.updated_at = now(); return new; end; $$ language plpgsql;
 *   create trigger products_set_updated_at before update on products
 *     for each row execute function set_updated_at();
 */

const SUPABASE_URL  = 'https://abgmvftptdkrztfflxbn.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFiZ212ZnRwdGRrcnp0ZmZseGJuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwODY2ODgsImV4cCI6MjA4OTY2MjY4OH0.WstNFP-z1BnaVE-LuDHx1qU-4H342t2DaU7Lud_Vvi4';
const SITE_URL       = 'https://jamesmainamwangi.com';

async function fetchActiveProducts() {
  // Try updated_at first — best signal for <lastmod>.
  const attempts = [
    'slug,updated_at',
    'slug,created_at',
    'slug',
  ];

  for (const select of attempts) {
    const url =
      `${SUPABASE_URL}/rest/v1/products?active=eq.true&select=${select}`;
    const res = await fetch(url, {
      headers: {
        apikey: SUPABASE_ANON,
        Authorization: `Bearer ${SUPABASE_ANON}`,
      },
    });
    if (res.ok) return res.json();
    // 400 usually means the column doesn't exist — try the next shape.
  }
  return [];
}

function xmlEscape(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function toISODate(value) {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d) ? null : d.toISOString().split('T')[0];
}

export async function onRequestGet() {
  const products = await fetchActiveProducts();

  const staticUrls = [
    { loc: `${SITE_URL}/`, changefreq: 'weekly', priority: '0.8' },
    { loc: `${SITE_URL}/shop.html`, changefreq: 'daily', priority: '0.9' },
  ];

  const productUrls = products
    .filter((p) => p.slug)
    .map((p) => {
      const lastmod = toISODate(p.updated_at || p.created_at);
      return {
        loc: `${SITE_URL}/shop/${p.slug}`,
        lastmod,
        changefreq: 'weekly',
        priority: '0.7',
      };
    });

  const allUrls = [...staticUrls, ...productUrls];

  const body =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    allUrls
      .map((u) => {
        const lines = [`  <url>`, `    <loc>${xmlEscape(u.loc)}</loc>`];
        if (u.lastmod) lines.push(`    <lastmod>${u.lastmod}</lastmod>`);
        if (u.changefreq) lines.push(`    <changefreq>${u.changefreq}</changefreq>`);
        if (u.priority) lines.push(`    <priority>${u.priority}</priority>`);
        lines.push(`  </url>`);
        return lines.join('\n');
      })
      .join('\n') +
    `\n</urlset>\n`;

  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'application/xml; charset=UTF-8',
      'cache-control': 'public, max-age=3600',
    },
  });
}
