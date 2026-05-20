// One-shot bootstrap — create the CRM v1 tables (Phase 1):
//   * contacts
//   * orders
//   * klaviyo_exchange_resolved
//   * cart_contact (pivot for the cart→contact 1:1 link)
//   * order_contact (pivot for the order→contact N:1 link)
//
// Standalone tsx script, same pattern as bootstrap-email-captures.ts.
// Idempotent — safe to re-run; registers itself in `_manta_migrations`.
//
// Usage (local DB):
//   cd demo/commerce
//   pnpm exec tsx scripts/bootstrap-crm.ts
//
// Usage (prod Neon):
//   cd demo/commerce
//   pnpm exec tsx scripts/bootstrap-crm.ts --prod

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'

const here = dirname(fileURLToPath(import.meta.url))

function loadEnv(relPath: string, { override }: { override: boolean }): boolean {
  const full = resolve(here, '..', relPath)
  try {
    const raw = readFileSync(full, 'utf8')
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
      if (!m) continue
      if (override || !process.env[m[1]]) process.env[m[1]] = m[2]
    }
    console.log(`[bootstrap-crm] loaded ${full}`)
    return true
  } catch {
    return false
  }
}

const useProd = process.argv.includes('--prod')
loadEnv('.env', { override: false })
if (useProd) loadEnv('.env.production', { override: true })

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  console.error('DATABASE_URL missing — add to .env or .env.production')
  process.exit(1)
}

const MIGRATION_NAME = 'crm_v1_phase1_bootstrap_2026_05_08'

// ── contacts ─────────────────────────────────────────────────────────
// Anyone with a known email — purchased or not. Email is the natural
// key (lowercased upstream); shopify_customer_id / klaviyo_profile_id /
// distinct_id are nullable because we discover those identifiers
// progressively.
const CREATE_CONTACTS = `
CREATE TABLE IF NOT EXISTS contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  phone text,
  locale text NOT NULL DEFAULT 'fr-FR',
  first_name text,
  last_name text,
  country_code text,
  city text,
  shopify_customer_id text,
  klaviyo_profile_id text,
  distinct_id text,
  orders_count integer NOT NULL DEFAULT 0,
  total_spent double precision NOT NULL DEFAULT 0,
  first_order_at timestamptz,
  last_order_at timestamptz,
  klaviyo_subscribed boolean NOT NULL DEFAULT false,
  klaviyo_suppressed boolean NOT NULL DEFAULT false,
  shopify_synced_at timestamptz,
  klaviyo_synced_at timestamptz,
  last_activity_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  deleted_at timestamptz
)
`

const INDEXES_CONTACTS = [
  'CREATE INDEX IF NOT EXISTS contacts_shopify_customer_id_idx ON contacts (shopify_customer_id)',
  'CREATE INDEX IF NOT EXISTS contacts_klaviyo_profile_id_idx ON contacts (klaviyo_profile_id)',
  'CREATE INDEX IF NOT EXISTS contacts_distinct_id_idx ON contacts (distinct_id)',
  'CREATE INDEX IF NOT EXISTS contacts_last_activity_at_idx ON contacts (last_activity_at DESC)',
]

// ── orders ───────────────────────────────────────────────────────────
// Local mirror of Shopify orders. shopify_order_id is the canonical
// unique key. status is a simplified lifecycle; the raw Shopify status
// fields are kept verbatim alongside.
const CREATE_ORDERS = `
CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shopify_order_id text NOT NULL UNIQUE,
  shopify_customer_id text,
  email text,
  order_number text,
  status text NOT NULL,
  financial_status text,
  fulfillment_status text,
  total_price double precision NOT NULL,
  currency text NOT NULL DEFAULT 'EUR',
  items jsonb,
  placed_at timestamptz,
  cancelled_at timestamptz,
  shopify_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  deleted_at timestamptz
)
`

const INDEXES_ORDERS = [
  'CREATE INDEX IF NOT EXISTS orders_shopify_customer_id_idx ON orders (shopify_customer_id)',
  'CREATE INDEX IF NOT EXISTS orders_email_idx ON orders (email)',
  'CREATE INDEX IF NOT EXISTS orders_placed_at_idx ON orders (placed_at DESC)',
]

// ── klaviyo_exchange_resolved ────────────────────────────────────────
// Cache of `?k=<exchange_id>` lookups against Klaviyo. No FK to
// contacts because the contact may not exist yet at lookup time —
// downstream code joins on lowercased email.
const CREATE_KLAVIYO_EXCHANGE = `
CREATE TABLE IF NOT EXISTS klaviyo_exchange_resolved (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exchange_id text NOT NULL UNIQUE,
  email text NOT NULL,
  resolved_at timestamptz NOT NULL,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  deleted_at timestamptz
)
`

const INDEXES_KLAVIYO_EXCHANGE = [
  'CREATE INDEX IF NOT EXISTS klaviyo_exchange_resolved_email_idx ON klaviyo_exchange_resolved (email)',
]

// ── cart_contact (pivot, 1:1) ────────────────────────────────────────
// Mirrors the schema produced by the framework's `generateLinkPgTable`
// for `defineLink('cart', 'contact')`. Idempotent CREATE IF NOT EXISTS;
// indexes match `idx_<table>_<fk>`.
const CREATE_CART_CONTACT = `
CREATE TABLE IF NOT EXISTS cart_contact (
  id text PRIMARY KEY,
  cart_id text NOT NULL,
  contact_id text NOT NULL,
  created_at timestamptz DEFAULT NOW(),
  updated_at timestamptz DEFAULT NOW(),
  deleted_at timestamptz
)
`

const INDEXES_CART_CONTACT = [
  'CREATE INDEX IF NOT EXISTS idx_cart_contact_cart_id ON cart_contact (cart_id)',
  'CREATE INDEX IF NOT EXISTS idx_cart_contact_contact_id ON cart_contact (contact_id)',
]

// ── order_contact (pivot, N:1) ───────────────────────────────────────
const CREATE_ORDER_CONTACT = `
CREATE TABLE IF NOT EXISTS order_contact (
  id text PRIMARY KEY,
  order_id text NOT NULL,
  contact_id text NOT NULL,
  created_at timestamptz DEFAULT NOW(),
  updated_at timestamptz DEFAULT NOW(),
  deleted_at timestamptz
)
`

const INDEXES_ORDER_CONTACT = [
  'CREATE INDEX IF NOT EXISTS idx_order_contact_order_id ON order_contact (order_id)',
  'CREATE INDEX IF NOT EXISTS idx_order_contact_contact_id ON order_contact (contact_id)',
]

const sql = postgres(DATABASE_URL, {
  ssl: useProd ? 'require' : undefined,
  max: 2,
  prepare: false,
})

const STATEMENTS: Array<{ label: string; ddl: string }> = [
  { label: 'contacts table', ddl: CREATE_CONTACTS },
  ...INDEXES_CONTACTS.map((ddl) => ({ label: 'contacts index', ddl })),
  { label: 'orders table', ddl: CREATE_ORDERS },
  ...INDEXES_ORDERS.map((ddl) => ({ label: 'orders index', ddl })),
  { label: 'klaviyo_exchange_resolved table', ddl: CREATE_KLAVIYO_EXCHANGE },
  ...INDEXES_KLAVIYO_EXCHANGE.map((ddl) => ({ label: 'klaviyo_exchange_resolved index', ddl })),
  { label: 'cart_contact pivot', ddl: CREATE_CART_CONTACT },
  ...INDEXES_CART_CONTACT.map((ddl) => ({ label: 'cart_contact index', ddl })),
  { label: 'order_contact pivot', ddl: CREATE_ORDER_CONTACT },
  ...INDEXES_ORDER_CONTACT.map((ddl) => ({ label: 'order_contact index', ddl })),
]

try {
  console.log(`[bootstrap-crm] target: ${useProd ? 'PROD (Neon)' : 'LOCAL'}`)

  for (const { label, ddl } of STATEMENTS) {
    console.log(`[bootstrap-crm] applying: ${label}`)
    await sql.unsafe(ddl)
  }

  await sql.unsafe(`INSERT INTO _manta_migrations (name, applied_sql) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [
    MIGRATION_NAME,
    STATEMENTS.map((s) => s.ddl.trim())
      .join(';\n')
      .slice(0, 8000),
  ])

  const [{ contacts }] = await sql<{ contacts: string }[]>`SELECT count(*)::text AS contacts FROM contacts`
  const [{ orders }] = await sql<{ orders: string }[]>`SELECT count(*)::text AS orders FROM orders`
  console.log(`[bootstrap-crm] done — contacts=${contacts} orders=${orders}`)
} catch (err) {
  console.error('[bootstrap-crm] FAILED:', err)
  process.exitCode = 1
} finally {
  await sql.end()
}
