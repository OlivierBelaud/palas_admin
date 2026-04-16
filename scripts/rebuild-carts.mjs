#!/usr/bin/env node
// Rebuild carts table from PostHog events — standalone script.
// Usage: DATABASE_URL="..." POSTHOG_API_KEY="..." POSTHOG_HOST="..." node scripts/rebuild-carts.mjs

import postgres from 'postgres'

const dbUrl = process.env.DATABASE_URL
const posthogKey = process.env.POSTHOG_API_KEY
const posthogHost = process.env.POSTHOG_HOST ?? 'https://eu.i.posthog.com'

if (!dbUrl || !posthogKey) {
  console.error('DATABASE_URL and POSTHOG_API_KEY are required')
  process.exit(1)
}

const isNeon = dbUrl.includes('neon.tech') || dbUrl.includes('neon.')
const sql = postgres(dbUrl, { ssl: isNeon ? 'require' : undefined, max: 1 })

// Step 1: Fetch events from PostHog
console.log('Fetching cart/checkout events from PostHog...')
const res = await fetch(`${posthogHost}/api/projects/@current/query/`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${posthogKey}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    query: {
      kind: 'HogQLQuery',
      query: `
        SELECT event, distinct_id, timestamp, properties
        FROM events
        WHERE event LIKE 'cart:%' OR event LIKE 'checkout:%'
        ORDER BY timestamp ASC
        LIMIT 10000
      `,
    },
  }),
})
const data = await res.json()
if (!data.results) {
  console.error('PostHog error:', JSON.stringify(data).substring(0, 300))
  await sql.end()
  process.exit(1)
}

const events = data.results.map((row) => ({
  event: row[0],
  distinct_id: row[1],
  timestamp: row[2],
  properties: typeof row[3] === 'string' ? JSON.parse(row[3]) : row[3],
}))
console.log(`Fetched ${events.length} events`)

// Step 2: Wipe tables
console.log('Wiping carts + cart_events...')
await sql`DELETE FROM cart_events`
await sql`DELETE FROM carts`
console.log('Tables wiped')

// Step 3: Replay
const STAGES = ['cart', 'checkout_started', 'checkout_engaged', 'payment_attempted', 'completed']
function actionToStage(a) {
  if (a.startsWith('cart:')) return 'cart'
  if (a === 'checkout:started') return 'checkout_started'
  if (a === 'checkout:payment_info_submitted') return 'payment_attempted'
  if (a === 'checkout:completed') return 'completed'
  return 'checkout_engaged'
}

let rebuilt = 0,
  skipped = 0,
  errors = 0

for (const evt of events) {
  const props = evt.properties ?? {}
  const $set = props.$set ?? {}
  const cart = props.cart ?? {}

  const cartToken = props.cart_token ?? cart.cart_token
  if (!cartToken) {
    skipped++
    continue
  }

  const email = $set.email ?? props.email ?? null
  if (email && /storebotmail|joonix\.net|mailinator|guerrillamail/i.test(email)) {
    skipped++
    continue
  }

  const items = JSON.stringify(cart.items ?? props.items ?? [])
  const totalPrice = Number(cart.total_price ?? props.total_price ?? 0)
  const currency = cart.currency ?? props.currency ?? 'EUR'
  const itemCount = (cart.items ?? props.items ?? []).length

  const newStage = actionToStage(evt.event)

  try {
    // Find by cart_token first, then fall back to distinct_id
    let existing =
      await sql`SELECT id, highest_stage, status, distinct_id, email, first_name, last_name, phone, city, country_code, shopify_order_id FROM carts WHERE cart_token = ${cartToken} LIMIT 1`
    if (existing.length === 0 && evt.distinct_id) {
      existing =
        await sql`SELECT id, highest_stage, status, distinct_id, email, first_name, last_name, phone, city, country_code, shopify_order_id FROM carts WHERE distinct_id = ${evt.distinct_id} LIMIT 1`
    }

    const currentStage = existing[0]?.highest_stage ?? 'cart'
    const highestStage = STAGES[Math.max(STAGES.indexOf(currentStage), STAGES.indexOf(newStage))] ?? newStage
    const status = evt.event === 'checkout:completed' ? 'completed' : (existing[0]?.status ?? 'active')

    const merge = (n, e) => n ?? e ?? null

    if (existing.length > 0) {
      const ex = existing[0]
      await sql`UPDATE carts SET
        distinct_id = ${merge(evt.distinct_id, ex.distinct_id)},
        email = ${merge(email, ex.email)},
        first_name = ${merge($set.first_name, ex.first_name)},
        last_name = ${merge($set.last_name, ex.last_name)},
        phone = ${merge($set.phone, ex.phone)},
        city = ${merge($set.city, ex.city)},
        country_code = ${merge($set.country, ex.country_code)},
        items = ${items}::jsonb,
        total_price = ${totalPrice},
        item_count = ${itemCount},
        currency = ${currency},
        last_action = ${evt.event},
        last_action_at = ${evt.timestamp},
        highest_stage = ${highestStage},
        status = ${status},
        shopify_order_id = ${merge(props.shopify_order_id, ex.shopify_order_id)},
        shipping_price = ${props.shipping_price != null ? Number(props.shipping_price) : null},
        discounts_amount = ${props.discounts_amount != null ? Number(props.discounts_amount) : null},
        subtotal_price = ${props.subtotal_price != null ? Number(props.subtotal_price) : null},
        total_tax = ${props.total_tax != null ? Number(props.total_tax) : null},
        updated_at = ${evt.timestamp}
      WHERE id = ${ex.id}`
    } else {
      await sql`INSERT INTO carts (
        id, cart_token, distinct_id, email, first_name, last_name, phone, city, country_code,
        items, total_price, item_count, currency, last_action, last_action_at, highest_stage, status,
        shopify_order_id, shipping_price, discounts_amount, subtotal_price, total_tax,
        created_at, updated_at
      ) VALUES (
        gen_random_uuid(), ${cartToken}, ${evt.distinct_id}, ${email},
        ${$set.first_name ?? null}, ${$set.last_name ?? null}, ${$set.phone ?? null},
        ${$set.city ?? null}, ${$set.country ?? null},
        ${items}::jsonb, ${totalPrice}, ${itemCount}, ${currency},
        ${evt.event}, ${evt.timestamp}, ${highestStage}, ${status},
        ${props.shopify_order_id ?? null},
        ${props.shipping_price != null ? Number(props.shipping_price) : null},
        ${props.discounts_amount != null ? Number(props.discounts_amount) : null},
        ${props.subtotal_price != null ? Number(props.subtotal_price) : null},
        ${props.total_tax != null ? Number(props.total_tax) : null},
        ${evt.timestamp}, ${evt.timestamp}
      )`
    }
    rebuilt++
  } catch (err) {
    errors++
    if (errors <= 10) console.error(`Error [${evt.event}]:`, err.message.substring(0, 150))
  }
}

console.log(`\nDone!`)
console.log(`  Rebuilt: ${rebuilt}`)
console.log(`  Skipped: ${skipped}`)
console.log(`  Errors: ${errors}`)

// Summary
const summary = await sql`SELECT status, COUNT(*) as cnt FROM carts GROUP BY status ORDER BY cnt DESC`
console.log('\nCart summary:')
for (const r of summary) console.log(`  ${r.status}: ${r.cnt}`)

const total = await sql`SELECT COUNT(*) as cnt FROM carts`
console.log(`Total carts: ${total[0].cnt}`)

const withEmail = await sql`SELECT COUNT(*) as cnt FROM carts WHERE email IS NOT NULL`
console.log(`With email: ${withEmail[0].cnt}`)

await sql.end()
