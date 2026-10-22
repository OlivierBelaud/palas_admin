#!/usr/bin/env node
import { createJiti } from 'jiti'
import postgres from 'postgres'

const args = process.argv.slice(2)
const options = { apply: false, minutes: 15, perCommand: 1000, pause: 250, database: '' }
for (let i = 0; i < args.length; i += 1) {
  const flag = args[i]
  if (flag === '--apply') options.apply = true
  else if (flag === '--max-minutes') options.minutes = Number(args[++i])
  else if (flag === '--per-command') options.perCommand = Number(args[++i])
  else if (flag === '--pause-ms') options.pause = Number(args[++i])
  else if (flag === '--confirm-database') options.database = args[++i]
  else throw new Error(`Unknown argument: ${flag}`)
}
if (!Number.isFinite(options.minutes) || options.minutes < 0.25 || options.minutes > 60)
  throw new Error('--max-minutes must be between 0.25 and 60')
if (!Number.isSafeInteger(options.perCommand) || options.perCommand < 1 || options.perCommand > 5000)
  throw new Error('--per-command must be an integer between 1 and 5000')
if (!Number.isSafeInteger(options.pause) || options.pause < 100 || options.pause > 5000)
  throw new Error('--pause-ms must be an integer between 100 and 5000')
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required')
const target = new URL(process.env.DATABASE_URL)
if (target.hostname.includes('-pooler.')) throw new Error('Use a direct connection, not the Neon pooler')

let connectionLost = false
const sql = postgres(process.env.DATABASE_URL, {
  max: 1,
  max_lifetime: null,
  onclose: () => {
    connectionLost = true
  },
  prepare: false,
  connect_timeout: 15,
  connection: {
    application_name: 'palas-workflow-backlog',
    statement_timeout: '15000',
    lock_timeout: '1000',
    idle_in_transaction_session_timeout: '15000',
  },
})
const jiti = createJiti(import.meta.url)
const { purgeTrackingWorkflows } = await jiti.import('../src/modules/event-hub/retention.ts')
let interrupted = false
process.on('SIGINT', () => {
  interrupted = true
})
process.on('SIGTERM', () => {
  interrupted = true
})
const started = Date.now()
const deadline = started + options.minutes * 60_000
let total = 0
let batches = 0
let reason = 'time_budget'
try {
  const [{ database }] = await sql`SELECT current_database() AS database`
  if (options.apply && options.database !== database)
    throw new Error('--confirm-database must match the connected database')
  if (!options.apply) {
    await purgeTrackingWorkflows(
      {
        raw: async (query, params) => {
          const plan = await sql.unsafe(`EXPLAIN ${query}`, params)
          console.log(JSON.stringify({ mode: 'dry-run', database, options, plan }))
          return [{ count: '0' }]
        },
      },
      options.perCommand,
    )
  } else {
    const [{ acquired }] =
      await sql`SELECT pg_try_advisory_lock(hashtext('palas_tracking_workflow_backlog')) AS acquired`
    if (!acquired) throw new Error('Another backlog operator already holds the lock')
    const db = {
      raw: async (query, params = []) => {
        if (connectionLost) throw new Error('Backlog database connection was closed')
        return sql.begin(async (transaction) => {
          const [{ acquired }] =
            await transaction`SELECT pg_try_advisory_xact_lock(hashtext('palas_tracking_workflow_backlog')) AS acquired`
          if (!acquired) throw new Error('Another backlog operator already holds the lock')
          return [...(await transaction.unsafe(query, params))]
        })
      },
    }
    while (!interrupted && !connectionLost && Date.now() < deadline) {
      const [{ waiting }] = await sql`SELECT count(*)::int AS waiting FROM pg_stat_activity
        WHERE datname=current_database() AND pid<>pg_backend_pid()
          AND wait_event_type='Lock' AND clock_timestamp()-query_start>INTERVAL '2 seconds'`
      if (waiting > 0) {
        reason = 'other_sessions_waiting_for_locks'
        break
      }
      if (connectionLost) break
      const batchStarted = Date.now()
      const deleted = await purgeTrackingWorkflows(db, options.perCommand)
      const elapsed = Date.now() - batchStarted
      total += deleted
      batches += 1
      console.log(
        JSON.stringify({
          at: new Date().toISOString(),
          batch: batches,
          deleted,
          total_deleted: total,
          batch_ms: elapsed,
        }),
      )
      if (deleted === 0) {
        reason = 'no_unlocked_candidates'
        break
      }
      await new Promise((resolve) =>
        setTimeout(resolve, elapsed > 2000 ? Math.max(options.pause, 1000) : options.pause),
      )
    }
    if (interrupted) reason = 'interrupted'
    if (connectionLost) {
      reason = 'connection_lost'
      process.exitCode = 1
    }
    console.log(JSON.stringify({ reason, batches, total_deleted: total, elapsed_ms: Date.now() - started }))
  }
} catch (error) {
  console.error(
    JSON.stringify({ reason: 'error', code: error.code, message: error.message, batches, total_deleted: total }),
  )
  process.exitCode = 1
} finally {
  await sql.end({ timeout: 5 })
}
