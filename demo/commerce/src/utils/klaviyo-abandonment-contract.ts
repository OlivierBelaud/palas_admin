export interface KlaviyoAbandonmentEventLike {
  metric: string
  subject: string | null
}

export const KLAVIYO_ABANDONMENT_METRICS = [
  'Shopify_Checkout_Abandonned',
  'Checkout Abandoned',
  'Ops Cart Abandoned',
] as const

export const KLAVIYO_ABANDONMENT_SUBJECT_NEEDLES = [
  'oubli',
  'pensez encore',
  'attend plus que vous',
  'commande palas vous attend',
  'valider votre commande',
  'sélection de bijoux palas vous attend',
] as const

export function isKlaviyoAbandonmentEvent(event: KlaviyoAbandonmentEventLike): boolean {
  if ((KLAVIYO_ABANDONMENT_METRICS as readonly string[]).includes(event.metric)) return true
  if (event.metric !== 'Received Email' || !event.subject) return false
  const subject = event.subject.toLocaleLowerCase('fr')
  return KLAVIYO_ABANDONMENT_SUBJECT_NEEDLES.some((needle) => subject.includes(needle))
}

function quoteHogql(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

/** Build the upstream predicate from the same constants used by the final guard. */
export function buildKlaviyoAbandonmentHogqlPredicate(metricExpression: string, subjectExpression: string): string {
  const metricPredicates = KLAVIYO_ABANDONMENT_METRICS.map(
    (metric) => `${metricExpression} = ${quoteHogql(metric)}`,
  )
  const subjectPredicates = KLAVIYO_ABANDONMENT_SUBJECT_NEEDLES.map(
    (needle) => `positionCaseInsensitive(${subjectExpression}, ${quoteHogql(needle)}) > 0`,
  )
  return `(
          ${metricPredicates.join('\n          OR ')}
          OR (
            ${metricExpression} = 'Received Email'
            AND (
              ${subjectPredicates.join('\n              OR ')}
            )
          )
        )`
}
