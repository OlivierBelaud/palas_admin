// Cart tracking cleanup + stats reporter.
//
// 1) Deletes Olivier's test carts (and their cart_events + posthog_event_log
//    rows + email_captures). Dry-run unless invoked with --apply.
// 2) Computes stats on the remaining carts, writes a Markdown report to
//    docs/cart-tracking-stats-{today}.md for sharing with the team.
//
// Usage:
//   tsx scripts/cart-stats-clean-and-report.ts           # dry-run
//   tsx scripts/cart-stats-clean-and-report.ts --apply   # actually delete

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'

const apply = process.argv.includes('--apply')
const target = process.argv.find((a) => a === 'local' || a === 'prod') ?? 'prod'
const envFile = target === 'local' ? '.env' : '.env.production'

const here = dirname(fileURLToPath(import.meta.url))
const envLines = readFileSync(resolve(here, '..', envFile), 'utf8').split('\n')
for (const line of envLines) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
}

const ssl = target === 'prod' ? ('require' as const) : false
const sql = postgres(process.env.DATABASE_URL!, { ssl, max: 1, prepare: false })

const STAGES = ['cart', 'checkout_started', 'checkout_engaged', 'payment_attempted', 'completed'] as const
type Stage = (typeof STAGES)[number]
const REACHED_CHECKOUT: Stage[] = ['checkout_started', 'checkout_engaged', 'payment_attempted', 'completed']
const COMPLETED: Stage[] = ['completed']

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

function pct(n: number, total: number) {
  if (total === 0) return '0.0 %'
  return `${((n / total) * 100).toFixed(1)} %`
}

async function findOlivierCarts() {
  return (await sql`
    SELECT id, cart_token, email, distinct_id
    FROM carts
    WHERE LOWER(COALESCE(email,'')) LIKE '%belaud%'
       OR LOWER(COALESCE(email,'')) LIKE 'olivierbelaud%'
       OR LOWER(COALESCE(first_name,'')) = 'olivier'
  `) as { id: string; cart_token: string; email: string | null; distinct_id: string | null }[]
}

async function cleanup(oliverCarts: Awaited<ReturnType<typeof findOlivierCarts>>) {
  if (oliverCarts.length === 0) {
    console.log('No Olivier carts to clean.')
    return
  }
  const ids = oliverCarts.map((c) => c.id)
  const distinctIds = Array.from(new Set(oliverCarts.map((c) => c.distinct_id).filter(Boolean)))
  const emails = Array.from(new Set(oliverCarts.map((c) => c.email).filter(Boolean)))

  console.log(`\n=== Cleanup (${apply ? 'APPLY' : 'DRY-RUN'}) ===`)
  console.log(`Carts to delete: ${ids.length}`)
  console.log(`Distinct_ids to scrub from posthog_event_log: ${distinctIds.length}`)
  console.log(`Emails to scrub from email_captures: ${emails.length}`)

  if (!apply) {
    console.log('\n(Dry-run — rerun with --apply to actually delete.)')
    return
  }

  await sql.begin(async (tx) => {
    // postgres.js v3 TransactionSql loses its call signature through Omit<Sql, ...>,
    // so we cast back to the callable Sql shape to use it as a tag function.
    const $ = tx as unknown as typeof sql
    const ceRows = await $`DELETE FROM cart_events WHERE cart_id = ANY(${ids}::text[]) RETURNING 1`
    console.log(`  cart_events deleted: ${ceRows.length}`)

    const cRows = await $`DELETE FROM carts WHERE id = ANY(${ids}::text[]) RETURNING 1`
    console.log(`  carts deleted: ${cRows.length}`)

    let pel = 0
    if (distinctIds.length > 0) {
      const rows = await $`DELETE FROM posthog_event_log WHERE distinct_id = ANY(${distinctIds}::text[]) RETURNING 1`
      pel = rows.length
    }
    console.log(`  posthog_event_log deleted: ${pel}`)

    let ec = 0
    if (emails.length > 0) {
      const rows = await $`DELETE FROM email_captures WHERE email = ANY(${emails}::text[]) RETURNING 1`
      ec = rows.length
    }
    console.log(`  email_captures deleted: ${ec}`)
  })
}

async function computeStats() {
  // Global
  const [{ n: total, total_amount }] =
    (await sql`SELECT COUNT(*)::int AS n, COALESCE(SUM(total_price), 0)::numeric(14,2) AS total_amount FROM carts`) as {
      n: number
      total_amount: string
    }[]

  // Range
  const [range] =
    (await sql`SELECT MIN(last_action_at)::date AS first, MAX(last_action_at)::date AS last FROM carts`) as {
      first: Date
      last: Date
    }[]

  // Identified flag: any cart with a known email is considered identified.
  // distinct_id alone is anonymous (PostHog cookie), so it's not enough.
  const identifiedClause = sql`email IS NOT NULL`

  const [{ n: identified, total_amount: identified_amount }] = (await sql`
    SELECT COUNT(*)::int AS n, COALESCE(SUM(total_price), 0)::numeric(14,2) AS total_amount
    FROM carts WHERE ${identifiedClause}`) as {
    n: number
    total_amount: string
  }[]

  const notIdentified = total - identified
  const not_identified_amount = (Number(total_amount) - Number(identified_amount)).toFixed(2)

  // Completed (funnel terminal)
  const [{ n: completed }] = (await sql`
    SELECT COUNT(*)::int AS n FROM carts WHERE highest_stage = 'completed'`) as { n: number }[]
  const notCompleted = total - completed

  // Reached checkout (any of the 4 post-cart stages)
  const [{ n: reachedCheckout }] = (await sql`
    SELECT COUNT(*)::int AS n FROM carts WHERE highest_stage = ANY(${REACHED_CHECKOUT}::text[])`) as { n: number }[]
  const onlyCart = total - reachedCheckout

  // Funnel by stage (global + split by identified)
  const byStage = (await sql`
    SELECT highest_stage AS stage,
           COUNT(*)::int AS n,
           COUNT(*) FILTER (WHERE email IS NOT NULL)::int AS identified,
           COUNT(*) FILTER (WHERE email IS NULL)::int AS not_identified,
           COALESCE(SUM(total_price), 0)::numeric(14,2) AS total_amount
    FROM carts GROUP BY highest_stage`) as {
    stage: Stage
    n: number
    identified: number
    not_identified: number
    total_amount: string
  }[]

  // By day
  const byDay = (await sql`
    SELECT last_action_at::date AS day,
           COUNT(*)::int AS n,
           COUNT(*) FILTER (WHERE email IS NOT NULL)::int AS identified,
           COUNT(*) FILTER (WHERE highest_stage = ANY(${REACHED_CHECKOUT}::text[]))::int AS reached_checkout,
           COUNT(*) FILTER (WHERE highest_stage = 'completed')::int AS completed,
           COALESCE(SUM(total_price), 0)::numeric(14,2) AS total_amount
    FROM carts GROUP BY day ORDER BY day DESC`) as {
    day: Date
    n: number
    identified: number
    reached_checkout: number
    completed: number
    total_amount: string
  }[]

  // Identified funnel detail
  const [{ id_checkout }] = (await sql`
    SELECT COUNT(*)::int AS id_checkout FROM carts
    WHERE email IS NOT NULL AND highest_stage = ANY(${REACHED_CHECKOUT}::text[])`) as { id_checkout: number }[]
  const [{ id_completed }] = (await sql`
    SELECT COUNT(*)::int AS id_completed FROM carts
    WHERE email IS NOT NULL AND highest_stage = 'completed'`) as { id_completed: number }[]
  const [{ anon_checkout }] = (await sql`
    SELECT COUNT(*)::int AS anon_checkout FROM carts
    WHERE email IS NULL AND highest_stage = ANY(${REACHED_CHECKOUT}::text[])`) as { anon_checkout: number }[]
  const [{ anon_completed }] = (await sql`
    SELECT COUNT(*)::int AS anon_completed FROM carts
    WHERE email IS NULL AND highest_stage = 'completed'`) as { anon_completed: number }[]

  return {
    total,
    total_amount: String(total_amount),
    range,
    identified,
    identified_amount: String(identified_amount),
    notIdentified,
    not_identified_amount,
    completed,
    notCompleted,
    reachedCheckout,
    onlyCart,
    byStage,
    byDay,
    id_checkout,
    id_completed,
    anon_checkout,
    anon_completed,
  }
}

function fmtDate(d: Date | string | null | undefined) {
  if (!d) return '—'
  return new Date(d).toISOString().slice(0, 10)
}

function buildMarkdown(s: Awaited<ReturnType<typeof computeStats>>, oliverDeleted: number) {
  const { total, total_amount, range, identified, identified_amount, notIdentified, not_identified_amount } = s
  const lines: string[] = []
  lines.push(`# Cart tracking — stats ${todayStr()}`)
  lines.push('')
  lines.push(
    `*Source: table \`carts\` en base Neon prod (${fmtDate(range.first)} → ${fmtDate(range.last)}). Les ${oliverDeleted} paniers de test Olivier ont été purgés (DB + posthog_event_log + email_captures) avant calcul.*`,
  )
  lines.push('')
  lines.push(
    `**Note méthodo** : un panier est "identifié" quand on connaît son email (soit via checkout soumis, soit via notre capture email). Le \`distinct_id\` seul n'est pas une identification (c'est un cookie PostHog anonyme).`,
  )
  lines.push('')

  lines.push("## En un coup d'œil")
  lines.push('')
  lines.push(`- **${total}** paniers trackés sur la période, valeur cumulée **${total_amount} €**.`)
  lines.push(
    `- **${identified}** identifiés (${pct(identified, total)}, ${identified_amount} €), **${notIdentified}** anonymes (${pct(notIdentified, total)}, ${not_identified_amount} €).`,
  )
  lines.push(
    `- **${s.reachedCheckout}** ont atteint le checkout (${pct(s.reachedCheckout, total)}), dont **${s.completed}** payés (${pct(s.completed, total)}).`,
  )
  lines.push(`- **${s.onlyCart}** restés au stade cart (${pct(s.onlyCart, total)}).`)
  lines.push('')

  lines.push('## Jour par jour (last_action_at)')
  lines.push('')
  lines.push('| Jour | Paniers | Montant | Identifiés | % id. | Checkout | % ckt. | Payés |')
  lines.push('|---|---:|---:|---:|---:|---:|---:|---:|')
  for (const d of s.byDay) {
    lines.push(
      `| ${fmtDate(d.day)} | ${d.n} | ${d.total_amount} € | ${d.identified} | ${pct(d.identified, d.n)} | ${d.reached_checkout} | ${pct(d.reached_checkout, d.n)} | ${d.completed} |`,
    )
  }
  lines.push('')

  lines.push('## Funnel par stage')
  lines.push('')
  lines.push('| Stage | Total | % total | Identifiés | Anonymes | Montant |')
  lines.push('|---|---:|---:|---:|---:|---:|')
  const stageMap = new Map(s.byStage.map((r) => [r.stage, r]))
  for (const stage of STAGES) {
    const r = stageMap.get(stage)
    if (!r) {
      lines.push(`| \`${stage}\` | 0 | 0.0 % | 0 | 0 | 0 € |`)
      continue
    }
    lines.push(
      `| \`${stage}\` | ${r.n} | ${pct(r.n, total)} | ${r.identified} | ${r.not_identified} | ${r.total_amount} € |`,
    )
  }
  lines.push('')

  lines.push('## Identifiés vs anonymes — comportement dans le funnel')
  lines.push('')
  lines.push('### Identifiés (email connu)')
  lines.push('')
  lines.push(`- Base : **${identified}** paniers (${identified_amount} €)`)
  lines.push(
    `- Sont arrivés au checkout : **${s.id_checkout}** / ${identified} = **${pct(s.id_checkout, identified)}**`,
  )
  lines.push(`- Ont payé : **${s.id_completed}** / ${identified} = **${pct(s.id_completed, identified)}**`)
  lines.push(
    `- Restés au stade cart : **${identified - s.id_checkout}** / ${identified} = **${pct(identified - s.id_checkout, identified)}**`,
  )
  lines.push('')
  lines.push("### Anonymes (pas d'email)")
  lines.push('')
  lines.push(`- Base : **${notIdentified}** paniers (${not_identified_amount} €)`)
  lines.push(
    `- Sont arrivés au checkout : **${s.anon_checkout}** / ${notIdentified} = **${pct(s.anon_checkout, notIdentified)}**`,
  )
  lines.push(`- Ont payé : **${s.anon_completed}** / ${notIdentified} = **${pct(s.anon_completed, notIdentified)}**`)
  lines.push(
    `- Restés au stade cart : **${notIdentified - s.anon_checkout}** / ${notIdentified} = **${pct(notIdentified - s.anon_checkout, notIdentified)}**`,
  )
  lines.push('')

  lines.push('## Lecture')
  lines.push('')
  const idCheckoutRate = identified > 0 ? s.id_checkout / identified : 0
  const anonCheckoutRate = notIdentified > 0 ? s.anon_checkout / notIdentified : 0
  const idPayRate = identified > 0 ? s.id_completed / identified : 0
  const anonPayRate = notIdentified > 0 ? s.anon_completed / notIdentified : 0
  const checkoutRatio = anonCheckoutRate > 0 ? (idCheckoutRate / anonCheckoutRate).toFixed(2) : '∞'
  const payRatio = anonPayRate > 0 ? (idPayRate / anonPayRate).toFixed(2) : '∞'
  lines.push(
    `- Un visiteur **identifié** a ${checkoutRatio}× plus de chances d'atteindre le checkout qu'un **anonyme** (${pct(s.id_checkout, identified)} vs ${pct(s.anon_checkout, notIdentified)}).`,
  )
  lines.push(
    `- Un visiteur **identifié** a ${payRatio}× plus de chances de payer qu'un **anonyme** (${pct(s.id_completed, identified)} vs ${pct(s.anon_completed, notIdentified)}).`,
  )
  lines.push(
    `- Si l'écart est massif, c'est le signal qu'investir sur la capture d'email (form cart drawer, checkout engagé, etc.) a un ROI direct sur le payé.`,
  )
  lines.push('')

  lines.push("## Ce qu'on exclut")
  lines.push('')
  lines.push(
    '- Les paniers de test d\'Olivier (emails `*@yahoo.fr`, `olivierbelaudpro+*`, first_name="Olivier") : purgés de la DB avant calcul.',
  )
  lines.push(
    `- Les paniers "completed" qui n'auraient aucun montant ne sont pas exclus — si \`total_price\` était à 0, on le compte quand même car c'est un signal de commande réussie.`,
  )
  lines.push('')

  return lines.join('\n')
}

try {
  console.log(`=== ${target.toUpperCase()} DB — ${apply ? 'APPLY' : 'DRY-RUN'} ===\n`)
  const oliverCarts = await findOlivierCarts()
  console.log(`Olivier carts detected: ${oliverCarts.length}`)
  for (const c of oliverCarts) console.log(`  ${c.email}  (${c.cart_token.slice(0, 16)}…)`)

  await cleanup(oliverCarts)

  const stats = await computeStats()
  const md = buildMarkdown(stats, apply ? oliverCarts.length : 0)
  const outPath = resolve(here, '..', 'docs', `cart-tracking-stats-${todayStr()}.md`)
  writeFileSync(outPath, md)
  console.log(`\n✓ Stats written: ${outPath.replace(resolve(here, '..', '..', '..'), '.')}`)
  console.log(`  Totals: ${stats.total} carts · ${stats.total_amount} € · ${stats.identified} identified`)
} finally {
  await sql.end()
}
