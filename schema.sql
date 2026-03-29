-- ═══════════════════════════════════════════════════════════════
-- JAMES MWANGI PORTFOLIO — SUPABASE SQL SCHEMA
-- Run this in: Supabase Dashboard → SQL Editor
-- ═══════════════════════════════════════════════════════════════

-- ── EXTENSIONS ──────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── POSTS (Blog) ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS posts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug         TEXT UNIQUE NOT NULL,
  title        TEXT NOT NULL,
  excerpt      TEXT,
  content      TEXT,                 -- Markdown / HTML body
  cat          TEXT,                 -- Category label
  tags         TEXT[] DEFAULT '{}',  -- Array of tag strings
  cover_url    TEXT,                 -- Hero image URL
  read_time    TEXT DEFAULT '5 min read',
  likes        INTEGER DEFAULT 0,
  views        INTEGER DEFAULT 0,
  published    BOOLEAN DEFAULT FALSE,
  featured     BOOLEAN DEFAULT FALSE,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

CREATE TRIGGER posts_updated_at
  BEFORE UPDATE ON posts
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- Indexes for blog queries
CREATE INDEX IF NOT EXISTS idx_posts_slug      ON posts(slug);
CREATE INDEX IF NOT EXISTS idx_posts_published ON posts(published, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_featured  ON posts(featured) WHERE featured = TRUE;
CREATE INDEX IF NOT EXISTS idx_posts_cat       ON posts(cat);

-- ── PRODUCTS (Shop) ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS products (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku          TEXT UNIQUE,
  name         TEXT NOT NULL,
  description  TEXT,
  price        NUMERIC(10,2) NOT NULL,
  original_price NUMERIC(10,2),      -- For "was / now" pricing
  currency     TEXT DEFAULT 'KES',
  category     TEXT,
  tags         TEXT[] DEFAULT '{}',
  image_url    TEXT,
  gallery      TEXT[] DEFAULT '{}',  -- Additional images
  stock        INTEGER DEFAULT 0,
  in_stock     BOOLEAN GENERATED ALWAYS AS (stock > 0) STORED,
  rating       NUMERIC(3,2) DEFAULT 0,
  review_count INTEGER DEFAULT 0,
  featured     BOOLEAN DEFAULT FALSE,
  active       BOOLEAN DEFAULT TRUE,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER products_updated_at
  BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE INDEX IF NOT EXISTS idx_products_active   ON products(active, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category) WHERE active = TRUE;
CREATE INDEX IF NOT EXISTS idx_products_featured ON products(featured) WHERE featured = TRUE AND active = TRUE;

-- ── COMMENTS ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS comments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id      UUID REFERENCES posts(id) ON DELETE CASCADE,
  author_name  TEXT NOT NULL,
  author_email TEXT,                 -- Stored hashed in practice; kept plain for simplicity
  body         TEXT NOT NULL CHECK (char_length(body) >= 3 AND char_length(body) <= 2000),
  approved     BOOLEAN DEFAULT FALSE, -- Admin must approve before display
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id, created_at);

-- ── ORDERS (lightweight) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS orders (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_name  TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  customer_email TEXT,
  items        JSONB NOT NULL,       -- Array of {id, name, qty, price}
  subtotal     NUMERIC(12,2) NOT NULL,
  delivery_fee NUMERIC(8,2) DEFAULT 200,
  total        NUMERIC(12,2) NOT NULL,
  payment_method TEXT DEFAULT 'mpesa', -- mpesa | card
  status       TEXT DEFAULT 'pending', -- pending | paid | dispatched | delivered
  notes        TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status, created_at DESC);

-- ═══════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY (RLS)
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE posts     ENABLE ROW LEVEL SECURITY;
ALTER TABLE products  ENABLE ROW LEVEL SECURITY;
ALTER TABLE comments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders    ENABLE ROW LEVEL SECURITY;

-- ── POSTS RLS ────────────────────────────────────────────────────
-- Anyone can read published posts
CREATE POLICY "Public can read published posts"
  ON posts FOR SELECT
  USING (published = TRUE);

-- Only authenticated users (you) can insert/update/delete
CREATE POLICY "Auth users manage posts"
  ON posts FOR ALL
  TO authenticated
  USING (TRUE) WITH CHECK (TRUE);

-- ── PRODUCTS RLS ─────────────────────────────────────────────────
CREATE POLICY "Public can read active products"
  ON products FOR SELECT
  USING (active = TRUE);

CREATE POLICY "Auth users manage products"
  ON products FOR ALL
  TO authenticated
  USING (TRUE) WITH CHECK (TRUE);

-- ── COMMENTS RLS ─────────────────────────────────────────────────
-- Public reads only approved comments
CREATE POLICY "Public can read approved comments"
  ON comments FOR SELECT
  USING (approved = TRUE);

-- Anyone can insert a comment (anon users can submit)
CREATE POLICY "Anyone can submit a comment"
  ON comments FOR INSERT
  TO anon, authenticated
  WITH CHECK (TRUE);

-- Only authenticated (you) can update/delete comments
CREATE POLICY "Auth users manage comments"
  ON comments FOR UPDATE, DELETE
  TO authenticated
  USING (TRUE);

-- ── ORDERS RLS ───────────────────────────────────────────────────
-- Anyone can create an order
CREATE POLICY "Anyone can place an order"
  ON orders FOR INSERT
  TO anon, authenticated
  WITH CHECK (TRUE);

-- Only authenticated (you) can read/manage orders
CREATE POLICY "Auth users manage orders"
  ON orders FOR SELECT, UPDATE, DELETE
  TO authenticated
  USING (TRUE);

-- ═══════════════════════════════════════════════════════════════
-- SEED DATA — sample posts
-- ═══════════════════════════════════════════════════════════════
INSERT INTO posts (slug, title, excerpt, cat, tags, read_time, published, featured, content) VALUES
(
  'owasp-top-10-node-django',
  'OWASP Top 10 in Practice: Hardening Node.js & Django APIs',
  'A practical walkthrough of the OWASP Top 10 vulnerabilities with real code patches for Node.js and Django — from injection flaws to security misconfiguration.',
  'Cybersecurity',
  ARRAY['OWASP', 'Node.js', 'Django', 'Security'],
  '11 min read', TRUE, TRUE,
  '## Introduction\n\nThe OWASP Top 10 is the definitive reference for web application security risks...'
),
(
  'mpesa-daraja-api-node',
  'Integrating M-Pesa Daraja API with Node.js: A Complete Guide',
  'Everything you need to accept M-Pesa payments in your Node.js application — OAuth tokens, STK Push, callback handling, and production gotchas.',
  'FullStack',
  ARRAY['M-Pesa', 'Node.js', 'Payments', 'FinTech'],
  '14 min read', TRUE, FALSE,
  '## Prerequisites\n\nYou will need a Safaricom Developer account...'
),
(
  'supabase-vs-firebase-2024',
  'Supabase vs Firebase: An Honest Comparison for African Developers',
  'Pricing, latency from Nairobi, offline support, SQL vs NoSQL — a data-driven comparison to help you pick the right backend for your next project.',
  'DevTools',
  ARRAY['Supabase', 'Firebase', 'Backend', 'Comparison'],
  '9 min read', TRUE, FALSE,
  '## Context\n\nBoth Supabase and Firebase offer generous free tiers...'
);

-- ═══════════════════════════════════════════════════════════════
-- SEED DATA — sample products
-- ═══════════════════════════════════════════════════════════════
INSERT INTO products (sku, name, description, price, original_price, category, tags, image_url, stock, rating, review_count, featured) VALUES
(
  'PKB-001',
  'Keychron K2 Pro Mechanical Keyboard',
  'Hot-swappable 75% mechanical keyboard with QMK/VIA support, RGB backlight, and Mac/Windows compatibility.',
  18500, 22000, 'Keyboards',
  ARRAY['mechanical', 'wireless', 'productivity'],
  'https://images.unsplash.com/photo-1618384887929-16ec33fab9ef?w=600&q=80',
  15, 4.8, 34, TRUE
),
(
  'MON-001',
  'Logitech MX Master 3S Wireless Mouse',
  'Ergonomic precision mouse with ultra-fast scrolling, 8K DPI, silent clicks, and 70-day battery life.',
  12000, 14500, 'Mice',
  ARRAY['wireless', 'ergonomic', 'productivity'],
  'https://images.unsplash.com/photo-1527864550417-7fd91fc51a46?w=600&q=80',
  22, 4.9, 51, TRUE
),
(
  'HUB-001',
  'Anker 13-in-1 USB-C Hub',
  'Thunderbolt 4 compatible hub: dual 4K HDMI, 10Gbps USB-A, SD/microSD, 100W PD, ethernet.',
  8500, NULL, 'Hubs & Docks',
  ARRAY['usb-c', 'hub', 'multiport'],
  'https://images.unsplash.com/photo-1609902726285-00668009f004?w=600&q=80',
  40, 4.6, 28, FALSE
),
(
  'CAB-001',
  'LED Bias Lighting Strip (2m, USB)',
  'Colour-adjustable bias lighting for monitor backlighting. Reduces eye strain during long coding sessions.',
  2200, NULL, 'Accessories',
  ARRAY['lighting', 'ergonomics', 'accessories'],
  'https://images.unsplash.com/photo-1563013544-824ae1b704d3?w=600&q=80',
  80, 4.4, 17, FALSE
);
