import postgres from 'postgres'

const APPLY = process.argv.includes('--apply')

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required')

const secret = process.env.MANTA_UID_SECRET || ''
if (!secret) throw new Error('MANTA_UID_SECRET is required')

const sql = postgres(databaseUrl, { max: 1 })

async function main() {
  const result = await sql.begin(async (tx) => {
    await tx`SELECT set_config('app.muid_secret', ${secret}, true)`

    await tx`
      CREATE TEMP TABLE muid_backfill_map ON COMMIT DROP AS
      WITH event_identity AS (
        SELECT e.event_id,
               e.distinct_id,
               COALESCE(
                 NULLIF(e.payload_normalized #>> '{user,email}', ''),
                 NULLIF(e.payload_normalized #>> '{user_data,email}', ''),
                 NULLIF(e.payload_normalized #>> '{email}', ''),
                 NULLIF(c_by_id.email, ''),
                 NULLIF(c_by_distinct.email, ''),
                 NULLIF(cart_by_distinct.email, '')
               ) AS email,
               COALESCE(
                 NULLIF(e.identity_muid, ''),
                 NULLIF(e.payload_normalized #>> '{user,muid}', ''),
                 NULLIF(e.payload_normalized #>> '{user,palas_muid}', ''),
                 NULLIF(e.payload_normalized #>> '{muid}', ''),
                 NULLIF(e.payload_normalized #>> '{palas_muid}', '')
               ) AS existing_muid
          FROM event_logs e
          LEFT JOIN contacts c_by_id
            ON c_by_id.id::text = e.payload_normalized #>> '{user,contact_id}'
          LEFT JOIN contacts c_by_distinct
            ON c_by_distinct.distinct_id = e.distinct_id
          LEFT JOIN LATERAL (
            SELECT c.email
              FROM carts c
             WHERE c.distinct_id = e.distinct_id
               AND c.email IS NOT NULL
               AND c.deleted_at IS NULL
             ORDER BY c.updated_at DESC NULLS LAST
             LIMIT 1
          ) cart_by_distinct ON TRUE
      ), resolved AS (
        SELECT event_id,
               distinct_id,
               CASE
                 WHEN existing_muid ~ '^muid_[a-f0-9]{32}$' THEN existing_muid
                 WHEN email IS NOT NULL THEN
                   'muid_' || substring(encode(hmac(('muid:' || lower(trim(email)))::bytea, current_setting('app.muid_secret')::bytea, 'sha256'), 'hex') from 1 for 32)
                 WHEN lower(regexp_replace(COALESCE(distinct_id, ''), '[^a-f0-9]', '', 'g')) ~ '^[a-f0-9]{32,}$' THEN
                   'muid_' || substring(lower(regexp_replace(distinct_id, '[^a-f0-9]', '', 'g')) from 1 for 32)
                 ELSE NULL
               END AS muid,
               CASE
                 WHEN existing_muid ~ '^muid_[a-f0-9]{32}$' THEN 'existing'
                 WHEN email IS NOT NULL THEN 'email'
                 WHEN lower(regexp_replace(COALESCE(distinct_id, ''), '[^a-f0-9]', '', 'g')) ~ '^[a-f0-9]{32,}$' THEN 'posthog_distinct_id'
                 ELSE NULL
               END AS source
          FROM event_identity
      )
      SELECT * FROM resolved WHERE muid IS NOT NULL
    `

    const [candidates] = await tx`
      SELECT COUNT(*)::int AS rows,
             COUNT(*) FILTER (WHERE source = 'email')::int AS email,
             COUNT(*) FILTER (WHERE source = 'posthog_distinct_id')::int AS posthog_distinct_id,
             COUNT(*) FILTER (WHERE source = 'existing')::int AS existing
        FROM muid_backfill_map
    `

    const [events] = await tx`
      WITH updated AS (
        UPDATE event_logs e
           SET identity_muid = m.muid,
               payload_normalized = jsonb_set(
                 jsonb_set(
                   jsonb_set(
                     jsonb_set(COALESCE(e.payload_normalized, '{}'::jsonb), '{user,muid}', to_jsonb(m.muid), true),
                     '{user,palas_muid}', to_jsonb(m.muid), true),
                   '{user,ga_client_id}', to_jsonb(m.muid), true),
                 '{muid}', to_jsonb(m.muid), true),
               metadata = jsonb_set(
                 COALESCE(e.metadata, '{}'::jsonb),
                 '{muid_backfill}',
                 jsonb_build_object('source', m.source, 'at', to_jsonb(now()), 'version', '2026-06-15-set-based'),
                 true),
               updated_at = now()
          FROM muid_backfill_map m
         WHERE e.event_id = m.event_id
           AND (e.identity_muid IS DISTINCT FROM m.muid
                OR COALESCE(e.payload_normalized #>> '{user,muid}', '') IS DISTINCT FROM m.muid
                OR COALESCE(e.payload_normalized #>> '{user,ga_client_id}', '') IS DISTINCT FROM m.muid
                OR COALESCE(e.payload_normalized #>> '{muid}', '') IS DISTINCT FROM m.muid)
         RETURNING 1
      )
      SELECT COUNT(*)::int AS updated FROM updated
    `

    const [dispatches] = await tx`
      WITH updated AS (
        UPDATE dispatch_logs d
           SET request_payload = jsonb_set(
                 jsonb_set(
                   (
                     jsonb_set(COALESCE(d.request_payload, '{}'::jsonb), '{client_id}', to_jsonb(m.muid), true)
                     || jsonb_build_object(
                       'user_properties',
                       COALESCE(d.request_payload -> 'user_properties', '{}'::jsonb)
                       || jsonb_build_object('palas_muid', jsonb_build_object('value', m.muid))
                     )
                   ),
                   '{events,0,params,palas_muid}', to_jsonb(m.muid), true),
                 '{user_id}',
                 to_jsonb(CASE
                   WHEN NULLIF(d.request_payload #>> '{user_id}', '') IS NULL THEN m.muid
                   WHEN d.request_payload #>> '{user_id}' = m.distinct_id THEN m.muid
                   ELSE d.request_payload #>> '{user_id}'
                 END),
                 true),
               metadata = jsonb_set(
                 COALESCE(d.metadata, '{}'::jsonb),
                 '{muid_backfill}',
                 jsonb_build_object('source', m.source, 'at', to_jsonb(now()), 'version', '2026-06-15-set-based'),
                 true),
               updated_at = now()
          FROM muid_backfill_map m
         WHERE d.event_id = m.event_id
           AND d.request_payload IS NOT NULL
           AND (COALESCE(d.request_payload #>> '{client_id}', '') IS DISTINCT FROM m.muid
                OR COALESCE(d.request_payload #>> '{user_properties,palas_muid,value}', '') IS DISTINCT FROM m.muid
                OR COALESCE(d.request_payload #>> '{events,0,params,palas_muid}', '') IS DISTINCT FROM m.muid
                OR d.request_payload #>> '{user_id}' = m.distinct_id
                OR NULLIF(d.request_payload #>> '{user_id}', '') IS NULL)
         RETURNING 1
      )
      SELECT COUNT(*)::int AS updated FROM updated
    `

    if (!APPLY) throw new Error(JSON.stringify({ dryRun: true, candidates, events, dispatches }))
    return { mode: 'apply', candidates, events, dispatches }
  }).catch((error) => {
    try {
      const payload = JSON.parse(error.message)
      if (payload.dryRun) return { mode: 'dry-run', ...payload }
    } catch {}
    throw error
  })

  console.log(JSON.stringify(result, null, 2))
}

try {
  await main()
} finally {
  await sql.end({ timeout: 5 })
}
