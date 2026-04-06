# James Mwangi Portfolio — jamesmainamwangi.com
## Cloudflare Pages + Supabase Stack

---
## 🗂 Files Delivered

| File | Purpose |
|------|---------|
| `style.css` | Global design system — import in every page |
| `blog.html` | Dynamic blog with masonry grid + single-post reading mode |
| `shop.html` | E-commerce with cart drawer + checkout modal |
| `schema.sql` | Supabase SQL — run once in the SQL Editor |

---

## 🚀 Setup in 5 Steps

### 1. Create Supabase Project
1. Go to [supabase.com](https://supabase.com) → New Project
2. Name it: `jm-portfolio` | Region: `West EU (Frankfurt)` (lowest latency from Nairobi)
3. Dashboard → SQL Editor → Paste `schema.sql` → Run

### 2. Get Your API Keys
Dashboard → Settings → API:
- **Project URL** → paste into `SUPABASE_URL` in blog.html & shop.html
- **anon / public key** → paste into `SUPABASE_ANON` in blog.html & shop.html

### 3. Deploy to Cloudflare Pages
```bash
# Option A: GitHub (recommended)
# Push all files to a GitHub repo, then:
# Cloudflare Dashboard → Pages → Create Project → Connect GitHub repo
# Build settings: Framework = None | Build command = (blank) | Output = /

# Option B: Direct Upload
# Cloudflare Dashboard → Pages → Upload Assets → drop the folder
```

### 4. Add Your Domain
Cloudflare Pages → Custom Domains → `jamesmainamwangi.com`
(Your domain is already on Cloudflare, so DNS auto-configures)

### 5. Add Posts & Products via Supabase Dashboard
- **Posts**: Table Editor → posts → Insert row (set `published = true` to show)
- **Products**: Table Editor → products → Insert row (set `active = true` to show)

---

## 🔐 Security Notes

- **RLS is enabled** on all tables. Public can only read published/active rows.
- Only authenticated Supabase users (you) can write, update, or delete.
- Orders can be placed by anon users (needed for checkout) but only you can view them.
- Comments require manual approval (`approved = true`) before displaying.

---

## ⚙️ Configuration Checklist

- [ ] Replace `SUPABASE_URL` in `blog.html`
- [ ] Replace `SUPABASE_ANON` in `blog.html`
- [ ] Replace `SUPABASE_URL` in `shop.html`
- [ ] Replace `SUPABASE_ANON` in `shop.html`
- [ ] Replace `PHOTO_URL` in `index.html` with your real photo
- [ ] Update WhatsApp number if different from +254711618115
- [ ] Run `schema.sql` in Supabase SQL Editor
- [ ] Deploy to Cloudflare Pages

---

## 📝 Adding Blog Posts

In Supabase Table Editor → `posts`, insert:
```json
{
  "slug": "my-post-url",
  "title": "My Post Title",
  "excerpt": "Short summary shown in the grid",
  "content": "# Heading\n\nYour markdown content here.",
  "cat": "Cybersecurity",
  "tags": ["tag1", "tag2"],
  "cover_url": "https://images.unsplash.com/photo-xxx?w=800&q=80",
  "read_time": "8 min read",
  "published": true
}
```

Content supports: `## headings`, `**bold**`, `` `code` ``, ` ```code blocks``` `, `> blockquotes`, `- lists`, `[links](url)`.

---

## 🛒 Adding Shop Products

In Supabase Table Editor → `products`, insert:
```json
{
  "sku": "PROD-001",
  "name": "Product Name",
  "description": "What it does and why it's great.",
  "price": 15000,
  "original_price": 18000,
  "currency": "KES",
  "category": "Keyboards",
  "image_url": "https://your-image-url.com/image.jpg",
  "stock": 20,
  "rating": 4.8,
  "review_count": 12,
  "active": true,
  "featured": true
}
```

---

## 📱 M-Pesa Integration (Daraja API)

The checkout modal has M-Pesa as a placeholder. To activate real STK Push:
1. Register at [developer.safaricom.co.ke](https://developer.safaricom.co.ke)
2. Create a Cloudflare Worker (or Supabase Edge Function) to handle the OAuth token + STK Push call
3. Call that worker from `placeOrder()` in `shop.html`

See blog post `mpesa-daraja-api-node` for the full implementation guide (add it to your posts table).

---

## 🎨 Design System

CSS variables in `style.css` — change these to retheme everything:
```css
--bg:     #0f172a;   /* Page background */
--bg2:    #1e293b;   /* Card background */
--accent: #6366f1;   /* Primary accent (indigo) */
--green:  #22d3a5;   /* Secondary accent (teal) */
--text:   #f8fafc;   /* Primary text */
```

---

Built with ❤️ by Claude for James Mwangi | jamesmainamwangi.com
