// Unit test — canonical cart-tracking event names (single source of truth).
// Guards against drift between the entity enums, the ingestCartEvent command,
// and the posthog-cart-tracker subscriber.

import { describe, expect, it } from 'vitest'
import { CART_EVENT_NAMES, isCartEventName } from '../src/modules/cart-tracking/events'

describe('cart-tracking canonical events', () => {
  it('has 13 canonical event names', () => {
    expect(CART_EVENT_NAMES).toHaveLength(13)
  })

  it('all names are unique', () => {
    const set = new Set(CART_EVENT_NAMES)
    expect(set.size).toBe(CART_EVENT_NAMES.length)
  })

  it('includes the previously-missing names (cart:cleared, cart:closed, cart:discount_applied)', () => {
    // Regression guard: these were in the entity enums but not in the command's
    // Zod enum, so the command would reject them. Must now accept all 13.
    expect(CART_EVENT_NAMES).toContain('cart:cleared')
    expect(CART_EVENT_NAMES).toContain('cart:closed')
    expect(CART_EVENT_NAMES).toContain('cart:discount_applied')
  })

  it('includes all checkout funnel stages', () => {
    expect(CART_EVENT_NAMES).toContain('checkout:started')
    expect(CART_EVENT_NAMES).toContain('checkout:contact_info_submitted')
    expect(CART_EVENT_NAMES).toContain('checkout:address_info_submitted')
    expect(CART_EVENT_NAMES).toContain('checkout:shipping_info_submitted')
    expect(CART_EVENT_NAMES).toContain('checkout:payment_info_submitted')
    expect(CART_EVENT_NAMES).toContain('checkout:completed')
  })

  it('isCartEventName type guard accepts canonical names and rejects others', () => {
    expect(isCartEventName('cart:cleared')).toBe(true)
    expect(isCartEventName('checkout:completed')).toBe(true)
    expect(isCartEventName('checkout:contact')).toBe(false) // truncated form
    expect(isCartEventName('unknown')).toBe(false)
    expect(isCartEventName(null)).toBe(false)
    expect(isCartEventName(42)).toBe(false)
  })
})
