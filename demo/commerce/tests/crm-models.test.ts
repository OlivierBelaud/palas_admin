// CRM-V1-01 — minimal guard: the new Phase 1 CRM model files exist and
// declare the entity name + the canonical columns the rest of the
// pipeline (sync workers, admin pages) is going to depend on.
//
// We don't load the modules at runtime here because demo code lints
// against importing from '@mantajs/core' to register globals, and the
// monorepo smoke test already runs `tsc --noEmit` across every model
// file (see tests/smoke.test.ts). This test is a faster, source-level
// regression catcher for the column list itself — drop a column and
// you'll see it before you ship.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(__dirname, '..', 'src', 'modules')

function read(rel: string): string {
  return readFileSync(resolve(ROOT, rel), 'utf8')
}

describe('CRM-V1-01 — Phase 1 model files', () => {
  it('Contact model declares the canonical columns', () => {
    const src = read('contact/entities/contact/model.ts')
    expect(src).toMatch(/defineModel\('Contact'/)
    for (const col of [
      'email:',
      'phone:',
      'locale:',
      'first_name:',
      'last_name:',
      'country_code:',
      'city:',
      'shopify_customer_id:',
      'klaviyo_profile_id:',
      'distinct_id:',
      'klaviyo_subscribed:',
      'klaviyo_suppressed:',
      'shopify_synced_at:',
      'klaviyo_synced_at:',
      'last_activity_at:',
    ]) {
      expect(src.includes(col), `Contact missing field "${col}"`).toBe(true)
    }
    // Searchable contract for the admin client list page filters.
    expect(src).toMatch(/email:\s*field\.text\(\)\.unique\(\)\.searchable\(\)/)
    expect(src).toMatch(/first_name:\s*field\.text\(\)\.nullable\(\)\.searchable\(\)/)
    expect(src).toMatch(/last_name:\s*field\.text\(\)\.nullable\(\)\.searchable\(\)/)
  })

  it('Order model declares the canonical columns', () => {
    const src = read('order/entities/order/model.ts')
    expect(src).toMatch(/defineModel\('Order'/)
    for (const col of [
      'shopify_order_id:',
      'shopify_customer_id:',
      'sales_channel:',
      'include_in_ecommerce_analytics:',
      'email:',
      'order_number:',
      'status:',
      'financial_status:',
      'fulfillment_status:',
      'total_price:',
      'currency:',
      'shipping_country_code:',
      'shipping_country_name:',
      'items:',
      'placed_at:',
      'cancelled_at:',
      'shopify_synced_at:',
    ]) {
      expect(src.includes(col), `Order missing field "${col}"`).toBe(true)
    }
    // Status enum values that downstream filters depend on.
    for (const val of ['pending', 'paid', 'fulfilled', 'cancelled', 'refunded']) {
      expect(src.includes(`'${val}'`), `Order status missing "${val}"`).toBe(true)
    }
  })

  it('KlaviyoExchangeResolved model declares the canonical columns', () => {
    const src = read('contact/entities/klaviyo-exchange-resolved/model.ts')
    expect(src).toMatch(/defineModel\('KlaviyoExchangeResolved'/)
    for (const col of ['exchange_id:', 'email:', 'resolved_at:', 'expires_at:']) {
      expect(src.includes(col), `KlaviyoExchangeResolved missing field "${col}"`).toBe(true)
    }
    expect(src).toMatch(/exchange_id:\s*field\.text\(\)\.unique\(\)/)
  })
})
