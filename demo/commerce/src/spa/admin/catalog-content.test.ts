import { describe, expect, it } from 'vitest'
import { shouldLoadCollectionMedia, shopifyImageThumbnail } from './catalog-content'

describe('catalog image selector', () => {
  it('does not load collection media before the selector opens', () => {
    expect(shouldLoadCollectionMedia(false, 'gid://shopify/Collection/1', null)).toBe(false)
    expect(shouldLoadCollectionMedia(true, 'gid://shopify/Collection/1', null)).toBe(true)
    expect(
      shouldLoadCollectionMedia(
        true,
        'gid://shopify/Collection/1',
        'gid://shopify/Collection/1',
      ),
    ).toBe(false)
  })

  it('requests small square Shopify CDN thumbnails', () => {
    const thumbnail = new URL(shopifyImageThumbnail('https://cdn.shopify.com/image.jpg?v=1', 120))
    expect(thumbnail.searchParams.get('width')).toBe('120')
    expect(thumbnail.searchParams.get('height')).toBe('120')
    expect(thumbnail.searchParams.get('crop')).toBe('center')
    expect(thumbnail.searchParams.get('v')).toBe('1')
  })
})
