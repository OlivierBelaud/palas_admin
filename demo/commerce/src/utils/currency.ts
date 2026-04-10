const SYMBOLS: Record<string, string> = { EUR: '€', USD: '$', GBP: '£', CHF: 'CHF', CAD: 'CA$', AUD: 'A$' }

export function currencySymbol(code: string): string {
  return SYMBOLS[code] ?? code
}

export function formatMoney(amount: number | null | undefined, currency: string): string {
  if (amount == null) return '-'
  return `${amount} ${currencySymbol(currency)}`
}
