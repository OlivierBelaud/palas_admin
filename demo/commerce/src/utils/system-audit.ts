export interface RawDb {
  raw<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>
}

export type SystemHealthSource = 'shopify' | 'posthog' | 'klaviyo' | 'event_hub' | 'abandoned_cart_emails' | 'system'

export type SystemStatus = 'ok' | 'warning' | 'critical' | 'unknown'
export type FindingSeverity = 'critical' | 'warning' | 'info'

export interface SystemHealthCard {
  key: Exclude<SystemHealthSource, 'system'>
  label: string
  status: SystemStatus
  summary: string
  details: string[]
  href: string
}

export interface SystemAuditFindingInput {
  source: SystemHealthSource
  key: string
  severity: FindingSeverity
  title: string
  summary: string
  count: number
  href: string
  details: string[]
}

export interface SystemAuditSummary {
  generated_at: string
  overall_status: SystemStatus
  health: SystemHealthCard[]
  metrics: Record<string, number | string | null>
}

export interface SystemAuditResult {
  run_id: string
  summary: SystemAuditSummary
  findings: SystemAuditFindingInput[]
}

type AuditTrigger = 'nightly' | 'manual'

const DAY_MS = 24 * 60 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000
const NON_DISPATCHABLE_INTERNAL_EVENT = 'non_dispatchable_internal_event'
const GOOGLE_ADS_CONSENT_BLOCKERS = [
  'google_ads_ad_storage_consent_not_granted',
  'google_ads_ad_user_data_consent_not_granted',
  'google_ads_ad_personalization_consent_not_granted',
]

export async function runSystemAudit(db: RawDb, trigger: AuditTrigger): Promise<SystemAuditResult> {
  const startedAt = new Date()
  const [run] = await db.raw<{ id: string }>(
    `INSERT INTO system_audit_runs (trigger, status, overall_status, started_at, created_at, updated_at)
     VALUES ($1, 'running', 'unknown', $2, NOW(), NOW())
     RETURNING id`,
    [trigger, startedAt.toISOString()],
  )
  if (!run?.id) throw new MantaError('UNEXPECTED_STATE', 'Unable to create system audit run')

  try {
    const computed = await computeSystemAudit(db)
    await persistFindings(db, run.id, computed.findings, computed.summary.generated_at)
    await db.raw(
      `UPDATE system_audit_runs
       SET status = 'completed',
           overall_status = $2,
           finished_at = $3,
           summary = $4::jsonb,
           updated_at = NOW()
       WHERE id = $1`,
      [run.id, computed.summary.overall_status, computed.summary.generated_at, JSON.stringify(computed.summary)],
    )
    return { run_id: run.id, ...computed }
  } catch (err) {
    const finishedAt = new Date().toISOString()
    const message = err instanceof Error ? err.message : String(err)
    await db.raw(
      `UPDATE system_audit_runs
       SET status = 'failed',
           overall_status = 'critical',
           finished_at = $2,
           error_message = $3,
           updated_at = NOW()
       WHERE id = $1`,
      [run.id, finishedAt, message],
    )
    await persistFindings(
      db,
      run.id,
      [
        {
          source: 'system',
          key: 'audit_failed',
          severity: 'critical',
          title: 'Audit système échoué',
          summary: message,
          count: 1,
          href: '/',
          details: [message],
        },
      ],
      finishedAt,
    )
    throw err
  }
}

export async function computeSystemAudit(
  db: RawDb,
): Promise<{ summary: SystemAuditSummary; findings: SystemAuditFindingInput[] }> {
  const generatedAt = new Date()
  const findings: SystemAuditFindingInput[] = []
  const health: SystemHealthCard[] = []
  const metrics: Record<string, number | string | null> = {}

  health.push(await auditShopify(db, generatedAt, findings, metrics))
  health.push(await auditPosthog(db, generatedAt, findings, metrics))
  health.push(await auditKlaviyo(db, generatedAt, findings, metrics))
  health.push(await auditEventHub(db, generatedAt, findings, metrics))
  health.push(await auditAbandonedCartEmails(db, generatedAt, findings, metrics))

  const overallStatus = worstStatus(health.map((item) => item.status))
  return {
    summary: {
      generated_at: generatedAt.toISOString(),
      overall_status: overallStatus,
      health,
      metrics,
    },
    findings,
  }
}

async function auditShopify(
  db: RawDb,
  now: Date,
  findings: SystemAuditFindingInput[],
  metrics: Record<string, number | string | null>,
): Promise<SystemHealthCard> {
  const [row] = await db.raw<{
    contacts_latest: Date | string | null
    orders_latest: Date | string | null
    contacts_synced: string
    orders_synced: string
  }>(`
    SELECT
      (SELECT MAX(shopify_synced_at) FROM contacts) AS contacts_latest,
      (SELECT MAX(shopify_synced_at) FROM orders) AS orders_latest,
      (SELECT COUNT(*)::text FROM contacts WHERE shopify_customer_id IS NOT NULL) AS contacts_synced,
      (SELECT COUNT(*)::text FROM orders) AS orders_synced
  `)

  const contactsAge = ageMs(now, row?.contacts_latest)
  const ordersAge = ageMs(now, row?.orders_latest)
  metrics.shopify_contacts_synced = num(row?.contacts_synced)
  metrics.shopify_orders_synced = num(row?.orders_synced)
  metrics.shopify_contacts_latest_at = isoOrNull(row?.contacts_latest)
  metrics.shopify_orders_latest_at = isoOrNull(row?.orders_latest)

  const details = [
    `Contacts Shopify: ${formatAge(contactsAge)}`,
    `Orders Shopify: ${formatAge(ordersAge)}`,
    `${metrics.shopify_contacts_synced} contacts avec shopify_customer_id`,
    `${metrics.shopify_orders_synced} orders locales`,
  ]
  let status: SystemStatus = 'ok'
  const worstAge = Math.max(contactsAge ?? Number.POSITIVE_INFINITY, ordersAge ?? Number.POSITIVE_INFINITY)
  if (!Number.isFinite(worstAge)) {
    status = 'warning'
    addFinding(findings, {
      source: 'shopify',
      key: 'shopify_sync_unknown',
      severity: 'warning',
      title: 'Sync Shopify non vérifiable',
      summary: 'Aucun timestamp shopify_synced_at disponible pour contacts/orders.',
      count: 1,
      href: '/orders',
      details,
    })
  } else if (worstAge > 48 * HOUR_MS) {
    status = 'critical'
    addFinding(findings, {
      source: 'shopify',
      key: 'shopify_sync_stale_critical',
      severity: 'critical',
      title: 'Sync Shopify en retard critique',
      summary: `Le miroir Shopify le plus ancien a ${formatAge(worstAge)}.`,
      count: 1,
      href: '/orders',
      details,
    })
  } else if (worstAge > 26 * HOUR_MS) {
    status = 'warning'
    addFinding(findings, {
      source: 'shopify',
      key: 'shopify_sync_stale',
      severity: 'warning',
      title: 'Sync Shopify en retard',
      summary: `Le miroir Shopify le plus ancien a ${formatAge(worstAge)}.`,
      count: 1,
      href: '/orders',
      details,
    })
  }

  return {
    key: 'shopify',
    label: 'Shopify',
    status,
    summary:
      status === 'ok' ? 'Contacts et orders synchronisés récemment.' : 'La fraîcheur Shopify doit être vérifiée.',
    details,
    href: '/orders',
  }
}

async function auditPosthog(
  db: RawDb,
  now: Date,
  findings: SystemAuditFindingInput[],
  metrics: Record<string, number | string | null>,
): Promise<SystemHealthCard> {
  const since = new Date(now.getTime() - DAY_MS).toISOString()
  const [row] = await db.raw<{
    total: string
    invalid: string
    non_dispatchable_internal: string
    identified: string
    latest_at: Date | string | null
  }>(
    `SELECT
       COUNT(*)::text AS total,
       COUNT(*) FILTER (
         WHERE valid = false
           AND NOT (
             jsonb_typeof(validation_errors) = 'array'
             AND validation_errors @> '["${NON_DISPATCHABLE_INTERNAL_EVENT}"]'::jsonb
             AND jsonb_array_length(validation_errors) = 1
           )
       )::text AS invalid,
       COUNT(*) FILTER (
         WHERE valid = false
           AND jsonb_typeof(validation_errors) = 'array'
           AND validation_errors @> '["${NON_DISPATCHABLE_INTERNAL_EVENT}"]'::jsonb
           AND jsonb_array_length(validation_errors) = 1
       )::text AS non_dispatchable_internal,
       COUNT(*) FILTER (
         WHERE identity_muid IS NOT NULL OR identity_email_sha256 IS NOT NULL OR distinct_id IS NOT NULL
       )::text AS identified,
       MAX(received_at) AS latest_at
     FROM event_logs
     WHERE received_at >= $1`,
    [since],
  )
  const total = num(row?.total)
  const invalid = num(row?.invalid)
  const nonDispatchableInternal = num(row?.non_dispatchable_internal)
  const identified = num(row?.identified)
  const invalidRate = rate(invalid, total)
  const identifiedRate = rate(identified, total)
  const latestAge = ageMs(now, row?.latest_at)
  metrics.posthog_events_24h = total
  metrics.posthog_invalid_24h = invalid
  metrics.posthog_non_dispatchable_internal_24h = nonDispatchableInternal
  metrics.posthog_invalid_rate_24h = invalidRate
  metrics.posthog_identified_rate_24h = identifiedRate
  metrics.posthog_latest_event_at = isoOrNull(row?.latest_at)

  const details = [
    `${total} events en 24h`,
    `${invalid} events invalides (${Math.round(invalidRate * 100)}%)`,
    `${nonDispatchableInternal} events internes non dispatchables`,
    `${identified} events identifiés (${Math.round(identifiedRate * 100)}%)`,
    `Dernier event: ${formatAge(latestAge)}`,
  ]
  let status: SystemStatus = 'ok'
  if (total === 0 || latestAge === null || latestAge > 6 * HOUR_MS) {
    status = 'critical'
    addFinding(findings, {
      source: 'posthog',
      key: 'posthog_no_recent_events',
      severity: 'critical',
      title: 'Aucun event récent',
      summary: latestAge === null ? 'Aucun event reçu en 24h.' : `Dernier event reçu il y a ${formatAge(latestAge)}.`,
      count: 1,
      href: '/tracking-health',
      details,
    })
  } else if (latestAge > 2 * HOUR_MS) {
    status = 'warning'
    addFinding(findings, {
      source: 'posthog',
      key: 'posthog_events_stale',
      severity: 'warning',
      title: 'Events PostHog en retard',
      summary: `Dernier event reçu il y a ${formatAge(latestAge)}.`,
      count: 1,
      href: '/tracking-health',
      details,
    })
  }
  if (invalid > 0) {
    const severity: FindingSeverity = invalid >= 10 || invalidRate >= 0.05 ? 'critical' : 'warning'
    status = worse(status, severity === 'critical' ? 'critical' : 'warning')
    addFinding(findings, {
      source: 'posthog',
      key: 'posthog_invalid_events',
      severity,
      title: 'Events mal formatés',
      summary: `${invalid} events invalides détectés sur les dernières 24h.`,
      count: invalid,
      href: '/tracking-health',
      details,
    })
  }

  return {
    key: 'posthog',
    label: 'PostHog events',
    status,
    summary: status === 'ok' ? 'Le flux event entrant est actif et valide.' : 'Le flux event entrant a des anomalies.',
    details,
    href: '/tracking-health',
  }
}

async function auditKlaviyo(
  db: RawDb,
  now: Date,
  findings: SystemAuditFindingInput[],
  metrics: Record<string, number | string | null>,
): Promise<SystemHealthCard> {
  const [row] = await db.raw<{ latest_synced_at: Date | string | null; events_7d: string }>(
    `SELECT
       MAX(synced_at) AS latest_synced_at,
       COUNT(*) FILTER (WHERE occurred_at >= NOW() - INTERVAL '7 days')::text AS events_7d
     FROM klaviyo_events`,
  )
  const age = ageMs(now, row?.latest_synced_at)
  const events7d = num(row?.events_7d)
  metrics.klaviyo_latest_synced_at = isoOrNull(row?.latest_synced_at)
  metrics.klaviyo_events_7d = events7d
  const details = [`Dernière sync: ${formatAge(age)}`, `${events7d} events Klaviyo sur 7j`]
  let status: SystemStatus = 'ok'
  if (age === null) {
    status = 'warning'
    addFinding(findings, {
      source: 'klaviyo',
      key: 'klaviyo_sync_unknown',
      severity: 'warning',
      title: 'Sync Klaviyo non vérifiable',
      summary: 'Aucun timestamp synced_at disponible dans klaviyo_events.',
      count: 1,
      href: '/paniers-abandonnes',
      details,
    })
  } else if (age > 48 * HOUR_MS) {
    status = 'critical'
    addFinding(findings, {
      source: 'klaviyo',
      key: 'klaviyo_sync_stale_critical',
      severity: 'critical',
      title: 'Sync Klaviyo en retard critique',
      summary: `Dernière sync Klaviyo il y a ${formatAge(age)}.`,
      count: 1,
      href: '/paniers-abandonnes',
      details,
    })
  } else if (age > 26 * HOUR_MS) {
    status = 'warning'
    addFinding(findings, {
      source: 'klaviyo',
      key: 'klaviyo_sync_stale',
      severity: 'warning',
      title: 'Sync Klaviyo en retard',
      summary: `Dernière sync Klaviyo il y a ${formatAge(age)}.`,
      count: 1,
      href: '/paniers-abandonnes',
      details,
    })
  }

  return {
    key: 'klaviyo',
    label: 'Klaviyo',
    status,
    summary:
      status === 'ok'
        ? 'Les events Klaviyo récents sont disponibles localement.'
        : 'Le miroir Klaviyo doit être vérifié.',
    details,
    href: '/paniers-abandonnes',
  }
}

async function auditEventHub(
  db: RawDb,
  now: Date,
  findings: SystemAuditFindingInput[],
  metrics: Record<string, number | string | null>,
): Promise<SystemHealthCard> {
  const since = new Date(now.getTime() - DAY_MS).toISOString()
  const [row] = await db.raw<{
    total: string
    sent: string
    failed: string
    consent_blocked: string
    pending_stale: string
  }>(
    `SELECT
       COUNT(*)::text AS total,
       COUNT(*) FILTER (WHERE status = 'sent')::text AS sent,
       COUNT(*) FILTER (
         WHERE status IN ('error', 'not_configured')
            OR (
              status = 'invalid'
              AND NOT (destination = 'google_ads' AND error_code = ANY($2::text[]))
            )
       )::text AS failed,
       COUNT(*) FILTER (
         WHERE status = 'invalid'
           AND destination = 'google_ads'
           AND error_code = ANY($2::text[])
       )::text AS consent_blocked,
       COUNT(*) FILTER (
         WHERE status IN ('pending', 'retry', 'sending') AND event_received_at < NOW() - INTERVAL '15 minutes'
       )::text AS pending_stale
     FROM dispatch_logs
     WHERE event_received_at >= $1`,
    [since, GOOGLE_ADS_CONSENT_BLOCKERS],
  )
  const total = num(row?.total)
  const sent = num(row?.sent)
  const failed = num(row?.failed)
  const consentBlocked = num(row?.consent_blocked)
  const pendingStale = num(row?.pending_stale)
  metrics.event_hub_dispatches_24h = total
  metrics.event_hub_sent_24h = sent
  metrics.event_hub_failed_24h = failed
  metrics.event_hub_consent_blocked_24h = consentBlocked
  metrics.event_hub_pending_stale = pendingStale
  const details = [
    `${total} dispatches destination sur 24h`,
    `${sent} envoyés`,
    `${failed} en erreur/invalide/non configuré actionnables`,
    `${consentBlocked} bloqués par consentement publicitaire`,
    `${pendingStale} pending/retry > 15min`,
  ]
  let status: SystemStatus = 'ok'
  if (failed > 0) {
    status = 'critical'
    addFinding(findings, {
      source: 'event_hub',
      key: 'event_hub_dispatch_failed',
      severity: 'critical',
      title: 'Dispatch Event Hub en erreur',
      summary: `${failed} dispatches destination sont en erreur, invalides ou non configurés.`,
      count: failed,
      href: '/tracking-health',
      details,
    })
  }
  if (pendingStale > 0) {
    status = worse(status, 'warning')
    addFinding(findings, {
      source: 'event_hub',
      key: 'event_hub_dispatch_stale',
      severity: 'warning',
      title: 'Dispatch Event Hub en attente',
      summary: `${pendingStale} dispatches GA4 attendent depuis plus de 15 minutes.`,
      count: pendingStale,
      href: '/tracking-health',
      details,
    })
  }

  return {
    key: 'event_hub',
    label: 'Event Hub',
    status,
    summary:
      status === 'ok'
        ? 'Les dispatches Event Hub sont propres.'
        : 'Des dispatches Event Hub demandent une investigation.',
    details,
    href: '/tracking-health',
  }
}

async function auditAbandonedCartEmails(
  db: RawDb,
  _now: Date,
  findings: SystemAuditFindingInput[],
  metrics: Record<string, number | string | null>,
): Promise<SystemHealthCard> {
  const [row] = await db.raw<{
    sent_7d: string
    failed_7d: string
    overdue_pending: string
    missing_locale_7d: string
    snapshot_errors_7d: string
    blocked_checks_24h: string
    discount_existing_customer_30d: string
  }>(`
    SELECT
      COUNT(m.id) FILTER (WHERE m.status = 'sent' AND m.sent_at >= NOW() - INTERVAL '7 days')::text AS sent_7d,
      COUNT(m.id) FILTER (WHERE m.status = 'failed' AND COALESCE(m.updated_at, m.created_at) >= NOW() - INTERVAL '7 days')::text AS failed_7d,
      COUNT(m.id) FILTER (WHERE m.status = 'pending' AND m.scheduled_for < NOW() - INTERVAL '15 minutes')::text AS overdue_pending,
      COUNT(m.id) FILTER (
        WHERE m.status = 'sent'
          AND m.sent_at >= NOW() - INTERVAL '7 days'
          AND m.message_type IN ('abandoned_cart_1', 'abandoned_cart_2', 'abandoned_cart_3', 'payment_help_1')
          AND (m.locale IS NULL OR m.locale = '')
      )::text AS missing_locale_7d,
      COUNT(m.id) FILTER (
        WHERE m.sent_at >= NOW() - INTERVAL '7 days'
          AND m.snapshot_error IS NOT NULL
      )::text AS snapshot_errors_7d,
      (
        SELECT COUNT(*)::text
        FROM abandoned_cart_checks c
        WHERE c.checked_at >= NOW() - INTERVAL '24 hours'
          AND c.status IN ('blocked', 'error')
      ) AS blocked_checks_24h,
      COUNT(m.id) FILTER (
        WHERE m.status = 'sent'
          AND m.sent_at >= NOW() - INTERVAL '30 days'
          AND m.discount_code IS NOT NULL
          AND COALESCE(ct.orders_count, 0) > 0
      )::text AS discount_existing_customer_30d
    FROM abandoned_cart_messages m
    LEFT JOIN contacts ct ON LOWER(ct.email) = LOWER(m.email)
  `)
  const sent7d = num(row?.sent_7d)
  const failed7d = num(row?.failed_7d)
  const overduePending = num(row?.overdue_pending)
  const missingLocale = num(row?.missing_locale_7d)
  const snapshotErrors = num(row?.snapshot_errors_7d)
  const blockedChecks = num(row?.blocked_checks_24h)
  const discountExistingCustomer = num(row?.discount_existing_customer_30d)
  metrics.abandoned_cart_sent_7d = sent7d
  metrics.abandoned_cart_failed_7d = failed7d
  metrics.abandoned_cart_overdue_pending = overduePending
  metrics.abandoned_cart_missing_locale_7d = missingLocale
  metrics.abandoned_cart_snapshot_errors_7d = snapshotErrors
  metrics.abandoned_cart_blocked_checks_24h = blockedChecks
  metrics.abandoned_cart_discount_existing_customer_30d = discountExistingCustomer

  const details = [
    `${sent7d} emails envoyés sur 7j`,
    `${failed7d} failed sur 7j`,
    `${overduePending} pending en retard`,
    `${missingLocale} emails envoyés sans locale`,
    `${discountExistingCustomer} réductions envoyées à contacts déjà clients`,
  ]
  let status: SystemStatus = 'ok'
  if (failed7d > 0) {
    status = 'critical'
    addFinding(findings, {
      source: 'abandoned_cart_emails',
      key: 'abandoned_cart_email_failed',
      severity: 'critical',
      title: 'Emails panier échoués',
      summary: `${failed7d} emails panier sont en échec sur les 7 derniers jours.`,
      count: failed7d,
      href: '/paniers-abandonnes/emails',
      details,
    })
  }
  if (overduePending > 0) {
    status = worse(status, 'critical')
    addFinding(findings, {
      source: 'abandoned_cart_emails',
      key: 'abandoned_cart_email_overdue',
      severity: 'critical',
      title: 'Emails panier en retard',
      summary: `${overduePending} emails pending auraient déjà dû partir.`,
      count: overduePending,
      href: '/paniers-abandonnes/emails',
      details,
    })
  }
  if (discountExistingCustomer > 0) {
    status = worse(status, 'critical')
    addFinding(findings, {
      source: 'abandoned_cart_emails',
      key: 'discount_sent_to_existing_customer',
      severity: 'critical',
      title: 'Réduction envoyée à client existant',
      summary: `${discountExistingCustomer} emails avec réduction ont été envoyés à des contacts avec commandes existantes.`,
      count: discountExistingCustomer,
      href: '/paniers-abandonnes/emails',
      details,
    })
  }
  if (missingLocale > 0) {
    status = worse(status, 'warning')
    addFinding(findings, {
      source: 'abandoned_cart_emails',
      key: 'abandoned_cart_email_missing_locale',
      severity: 'warning',
      title: 'Locale email manquante',
      summary: `${missingLocale} emails panier envoyés sur 7j n'ont pas de locale persistée.`,
      count: missingLocale,
      href: '/paniers-abandonnes/emails',
      details,
    })
  }
  if (snapshotErrors > 0 || blockedChecks > 0) {
    status = worse(status, 'warning')
    addFinding(findings, {
      source: 'abandoned_cart_emails',
      key: 'abandoned_cart_email_checks',
      severity: 'warning',
      title: 'Checks email à revoir',
      summary: `${snapshotErrors} erreurs snapshot sur 7j, ${blockedChecks} checks bloqués/en erreur sur 24h.`,
      count: snapshotErrors + blockedChecks,
      href: '/paniers-abandonnes/checks',
      details,
    })
  }

  return {
    key: 'abandoned_cart_emails',
    label: 'Emails panier',
    status,
    summary:
      status === 'ok'
        ? 'Relances panier conformes aux contrats V1.'
        : 'Les relances panier ont des violations à traiter.',
    details,
    href: '/paniers-abandonnes/emails',
  }
}

async function persistFindings(
  db: RawDb,
  runId: string,
  findings: SystemAuditFindingInput[],
  observedAt: string,
): Promise<void> {
  if (findings.length === 0) return
  const params: unknown[] = []
  const placeholders: string[] = []
  findings.forEach((finding, index) => {
    const base = index * 10
    placeholders.push(
      `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}::jsonb, $${base + 10}, NOW(), NOW())`,
    )
    params.push(
      runId,
      finding.source,
      finding.key,
      finding.severity,
      finding.title,
      finding.summary,
      finding.count,
      finding.href,
      JSON.stringify(finding.details),
      observedAt,
    )
  })
  await db.raw(
    `INSERT INTO system_audit_findings
       (run_id, source, key, severity, title, summary, count, href, details, observed_at, created_at, updated_at)
     VALUES ${placeholders.join(', ')}`,
    params,
  )
}

function addFinding(findings: SystemAuditFindingInput[], finding: SystemAuditFindingInput): void {
  findings.push(finding)
}

function num(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (typeof value === 'string') {
    const n = Number(value)
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

function rate(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 10000) / 10000 : 0
}

function ageMs(now: Date, value: Date | string | null | undefined): number | null {
  if (!value) return null
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime()
  if (!Number.isFinite(time)) return null
  return Math.max(0, now.getTime() - time)
}

function isoOrNull(value: Date | string | null | undefined): string | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

function formatAge(age: number | null): string {
  if (age === null) return 'inconnu'
  if (age < HOUR_MS) return `${Math.max(1, Math.round(age / 60000))}min`
  if (age < DAY_MS) return `${Math.round(age / HOUR_MS)}h`
  return `${Math.round(age / DAY_MS)}j`
}

function worse(a: SystemStatus, b: SystemStatus): SystemStatus {
  return statusRank(b) > statusRank(a) ? b : a
}

function worstStatus(statuses: SystemStatus[]): SystemStatus {
  return statuses.reduce<SystemStatus>((current, status) => worse(current, status), 'ok')
}

function statusRank(status: SystemStatus): number {
  switch (status) {
    case 'critical':
      return 3
    case 'warning':
      return 2
    case 'unknown':
      return 1
    case 'ok':
      return 0
  }
}
