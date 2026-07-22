import { describe, expect, it } from 'vitest'
import {
  buildKlaviyoAbandonmentHogqlPredicate,
  isKlaviyoAbandonmentEvent,
} from '../klaviyo-abandonment-contract'

describe('Klaviyo abandonment event contract', () => {
  it.each([
    ['Shopify_Checkout_Abandonned', null],
    ['Checkout Abandoned', null],
    ['Ops Cart Abandoned', null],
    ['Received Email', 'Vous avez oublié quelque chose ?'],
    ['Received Email', 'Vous y pensez encore ?'],
    ['Received Email', "Votre panier n'attend plus que vous"],
    ['Received Email', 'Votre commande Palas vous attend'],
    ['Received Email', 'Il est temps de valider votre commande'],
    ['Received Email', 'Votre sélection de bijoux Palas vous attend'],
  ])('accepts metric=%s subject=%s', (metric, subject) => {
    expect(isKlaviyoAbandonmentEvent({ metric, subject })).toBe(true)
  })

  it.each([
    ['Placed Order', null],
    ['Received Email', null],
    ['Received Email', 'Bienvenue chez Palas'],
  ])('rejects metric=%s subject=%s', (metric, subject) => {
    expect(isKlaviyoAbandonmentEvent({ metric, subject })).toBe(false)
  })

  it('builds the ingestion predicate from every shared metric and subject needle', () => {
    const predicate = buildKlaviyoAbandonmentHogqlPredicate('km.name', 'subject_expression')

    for (const value of [
      'Shopify_Checkout_Abandonned',
      'Checkout Abandoned',
      'Ops Cart Abandoned',
      'oubli',
      'pensez encore',
      'attend plus que vous',
      'commande palas vous attend',
      'valider votre commande',
      'sélection de bijoux palas vous attend',
    ]) {
      expect(predicate).toContain(value)
    }
  })
})
