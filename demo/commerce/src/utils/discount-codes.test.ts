import { describe, expect, it } from 'vitest'
import { findWelcomeCouponInProperties } from './discount-codes'

describe('findWelcomeCouponInProperties', () => {
  it('returns a coupon from common Klaviyo welcome property names', () => {
    expect(findWelcomeCouponInProperties({ welcome_coupon_code: 'PALAS10-ABC1234' })).toBe('PALAS10-ABC1234')
    expect(findWelcomeCouponInProperties({ 'Welcome Coupon Code': 'WELCOME-XYZ' })).toBe('WELCOME-XYZ')
    expect(findWelcomeCouponInProperties({ discount_code: 'SURPRISE10' })).toBe('SURPRISE10')
  })

  it('ignores invalid coupon-looking values', () => {
    expect(findWelcomeCouponInProperties({ welcome_coupon_code: '' })).toBeNull()
    expect(findWelcomeCouponInProperties({ welcome_coupon_code: 'https://example.com' })).toBeNull()
    expect(findWelcomeCouponInProperties({ welcome_coupon_code: 'x' })).toBeNull()
  })
})
