#!/usr/bin/env node

// Backfill Shopify shipping address fields onto the local orders mirror.
// Dry-run by default:
//   node scripts/backfill-order-shipping-address.mjs --prod
// Apply:
//   node scripts/backfill-order-shipping-address.mjs --prod --apply --days 30
//   node scripts/backfill-order-shipping-address.mjs --prod --apply --all

import { readFileSync } from 'node:fs'
import postgres from 'postgres'

const args = process.argv.slice(2)
const useProd = args.includes('--prod')
const apply = args.includes('--apply')
const all = args.includes('--all')

function readNumberFlag(name, fallback) {
  const idx = args.indexOf(name)
  if (idx === -1) return fallback
  const raw = args[idx + 1]
  const n = raw ? Number(raw) : NaN
  return Number.isFinite(n) && n > 0 ? n : fallback
}

function loadEnv(file, override) {
  try {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
      if (!match) continue
      let value = match[2].trim()
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      }
      if (override || !process.env[match[1]]) process.env[match[1]] = value
    }
  } catch {
    // ignore missing optional env files
  }
}

loadEnv('.env', false)
if (useProd) loadEnv('.env.production', true)

const databaseUrl = process.env.DATABASE_URL
const shopifyDomain = process.env.SHOPIFY_SHOP_DOMAIN ?? 'fancy-palas.myshopify.com'
const shopifyToken = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN ?? process.env.SHOPIFY_ADMIN_TOKEN
const apiVersion = process.env.SHOPIFY_ADMIN_API_VERSION ?? '2025-10'
const days = readNumberFlag('--days', 30)
const limit = readNumberFlag('--limit', 5000)
const batchSize = Math.min(readNumberFlag('--batch-size', 50), 100)

if (!databaseUrl) throw new Error('DATABASE_URL missing')
if (!shopifyToken) throw new Error('SHOPIFY_ADMIN_ACCESS_TOKEN missing')

const sql = postgres(databaseUrl, {
  ssl: useProd || /neon\.tech|amazonaws\.com|render\.com|railway\.app/.test(databaseUrl) ? 'require' : undefined,
  max: 4,
  prepare: false,
})

function normalizeShopifyOrderId(value) {
  const raw = String(value).trim()
  const match = raw.match(/(\d+)$/)
  return match ? match[1] : raw
}

function clean(value) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

async function fetchShippingByIds(ids) {
  const gids = ids.map((id) => `gid://shopify/Order/${normalizeShopifyOrderId(id)}`)
  const res = await fetch(`https://${shopifyDomain}/admin/api/${apiVersion}/graphql.json`, {
    method: 'POST',
    headers: {
      'X-Shopify-Access-Token': shopifyToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: `query OrdersShipping($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on Order {
            id
            shippingAddress { countryCodeV2 country city provinceCode }
          }
        }
      }`,
      variables: { ids: gids },
    }),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`Shopify ${res.status}: ${text.slice(0, 500)}`)
  const body = JSON.parse(text)
  if (body.errors?.length) throw new Error(`Shopify GraphQL: ${body.errors.map((err) => err.message).join(' | ')}`)

  const out = new Map()
  for (const node of body.data?.nodes ?? []) {
    if (!node?.id) continue
    out.set(normalizeShopifyOrderId(node.id), {
      shipping_country_code: clean(node.shippingAddress?.countryCodeV2),
      shipping_country_name: clean(node.shippingAddress?.country),
      shipping_city: clean(node.shippingAddress?.city),
      shipping_province_code: clean(node.shippingAddress?.provinceCode),
    })
  }
  return out
}

async function applyPatches(patches) {
  if (patches.length === 0) return
  await sql.unsafe(
    `WITH payload AS (
       SELECT *
         FROM jsonb_to_recordset($1::jsonb) AS x(
           id text,
           shipping_country_code text,
           shipping_country_name text,
           shipping_city text,
           shipping_province_code text
         )
     )
     UPDATE orders o
        SET shipping_country_code = payload.shipping_country_code,
            shipping_country_name = payload.shipping_country_name,
            shipping_city = payload.shipping_city,
            shipping_province_code = payload.shipping_province_code,
            updated_at = NOW()
       FROM payload
      WHERE o.id::text = payload.id`,
    [patches],
  )
}

try {
  console.log(
    `[backfill-order-shipping-address] target=${useProd ? 'PROD' : 'LOCAL'} apply=${apply} all=${all} days=${days} limit=${limit}`,
  )

  if (apply) {
    await sql.unsafe(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_country_code text`)
    await sql.unsafe(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_country_name text`)
    await sql.unsafe(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_city text`)
    await sql.unsafe(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_province_code text`)
    await sql.unsafe(`CREATE INDEX IF NOT EXISTS orders_shipping_country_code_idx ON orders (shipping_country_code)`)
  }

  const rows = await sql.unsafe(
    `SELECT id::text AS id, shopify_order_id
       FROM orders
      WHERE deleted_at IS NULL
        AND shopify_order_id IS NOT NULL
        AND shopify_order_id <> ''
        AND shipping_country_code IS NULL
        ${all ? '' : "AND placed_at >= NOW() - ($1::text || ' days')::interval"}
      ORDER BY placed_at DESC NULLS LAST
      LIMIT $${all ? 1 : 2}`,
    all ? [limit] : [String(days), limit],
  )

  let found = 0
  let withCountry = 0
  let updated = 0
  let errors = 0
  const samples = []

  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const batch = rows.slice(offset, offset + batchSize)
    try {
      const byShopifyId = await fetchShippingByIds(batch.map((row) => row.shopify_order_id))
      const patches = []
      for (const row of batch) {
        const shipping = byShopifyId.get(normalizeShopifyOrderId(row.shopify_order_id))
        if (!shipping) continue
        found += 1
        if (shipping.shipping_country_code) withCountry += 1
        const patch = { id: row.id, ...shipping }
        patches.push(patch)
        if (samples.length < 10) samples.push(patch)
      }
      if (apply) {
        await applyPatches(patches)
        updated += patches.length
      }
    } catch (err) {
      errors += batch.length
      if (errors <= 100) console.warn(`  batch offset=${offset}: ${err instanceof Error ? err.message : String(err)}`)
    }
    console.log(
      `  scanned=${Math.min(offset + batch.length, rows.length)}/${rows.length} found=${found} updated=${updated}`,
    )
  }

  console.log(
    JSON.stringify(
      {
        scanned: rows.length,
        found,
        with_country: withCountry,
        updated,
        errors,
        dry_run: !apply,
        samples,
      },
      null,
      2,
    ),
  )
} finally {
  await sql.end({ timeout: 5 })
}
