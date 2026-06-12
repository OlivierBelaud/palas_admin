import { db, iso, json, nowMs, requireAdmin, timingHeader, unauthorized } from './runtime.mjs'

export default {
  async fetch(req) {
    const started = nowMs()
    const auth = requireAdmin(req)
    if (!auth) return unauthorized()
    const authDone = nowMs()

    if (req.method === 'GET') {
      const rows = await listInvites()
      const done = nowMs()
      return json(
        { data: rows.map((row) => publicInvite(row, req)) },
        {
          headers: {
            'server-timing': timingHeader({ auth: authDone - started, query: done - authDone, total: done - started }),
          },
        },
      )
    }

    if (req.method !== 'POST') {
      return json({ message: 'Method not allowed' }, { status: 405 })
    }

    const body = await req.json().catch(() => ({}))
    const action = typeof body.action === 'string' ? body.action : 'create'
    if (action === 'create') return await createInvite(req, body, started, authDone)
    if (action === 'resend' && typeof body.id === 'string') return await resendInvite(req, body.id, started, authDone)
    if (action === 'delete' && typeof body.id === 'string') return await deleteInvite(body.id, started, authDone)
    return json({ message: 'Action invalide' }, { status: 400 })
  },
}

function normalizeEmail(value) {
  if (typeof value !== 'string') return null
  const email = value.trim().toLowerCase()
  return email.includes('@') && email.length <= 320 ? email : null
}

function inviteUrl(req, token) {
  const base = (process.env.ADMIN_BASE_URL ?? process.env.MANTA_BASE_URL ?? new URL(req.url).origin).replace(/\/+$/, '')
  return `${base}/admin/accept-invite?token=${encodeURIComponent(token)}`
}

function inviteStatus(row) {
  if (row.user_id) return 'active'
  if (row.accepted) return 'accepted_missing_account'
  if (new Date(row.expires_at).getTime() < Date.now()) return 'expired'
  return 'invited'
}

function publicInvite(row, req) {
  const metadata = row.metadata ?? {}
  return {
    id: row.id,
    email: row.email,
    accepted: row.accepted,
    expires_at: row.expires_at ? iso(row.expires_at) : null,
    created_at: row.created_at ? iso(row.created_at) : null,
    updated_at: row.updated_at ? iso(row.updated_at) : null,
    status: inviteStatus(row),
    account: row.user_id
      ? {
          id: row.user_id,
          first_name: row.first_name,
          last_name: row.last_name,
          role: row.role,
          created_at: row.user_created_at ? iso(row.user_created_at) : null,
        }
      : null,
    email_send_status: metadata.email_send_status ?? null,
    email_sent_at: metadata.email_sent_at ?? null,
    email_resent_at: metadata.email_resent_at ?? null,
    email_send_error: metadata.email_send_error ?? null,
    email_provider_id: metadata.email_provider_id ?? null,
    resend_count: Number(metadata.resend_count ?? 0),
    invite_url: inviteUrl(req, row.token),
  }
}

function listInvites() {
  return db().unsafe(
    `SELECT
       i.id,
       i.email,
       i.accepted,
       i.token,
       i.expires_at,
       i.created_at,
       i.updated_at,
       i.metadata,
       a.id AS user_id,
       a.first_name,
       a.last_name,
       a.role,
       a.created_at AS user_created_at
     FROM admin_invites i
     LEFT JOIN admins a
       ON lower(a.email) = lower(i.email)
      AND a.deleted_at IS NULL
     WHERE i.deleted_at IS NULL
     ORDER BY i.created_at DESC`,
  )
}

async function getInvite(id) {
  const rows = await db().unsafe(
    `SELECT
       i.id,
       i.email,
       i.accepted,
       i.token,
       i.expires_at,
       i.created_at,
       i.updated_at,
       i.metadata,
       a.id AS user_id,
       a.first_name,
       a.last_name,
       a.role,
       a.created_at AS user_created_at
     FROM admin_invites i
     LEFT JOIN admins a
       ON lower(a.email) = lower(i.email)
      AND a.deleted_at IS NULL
     WHERE i.id = $1
       AND i.deleted_at IS NULL
     LIMIT 1`,
    [id],
  )
  return rows[0] ?? null
}

async function createInvite(req, body, started, authDone) {
  const email = normalizeEmail(body.email)
  if (!email) return json({ message: 'Email invalide' }, { status: 400 })

  const users = await db().unsafe(
    'SELECT id FROM admins WHERE lower(email) = lower($1) AND deleted_at IS NULL LIMIT 1',
    [email],
  )
  if (users.length > 0) return json({ message: 'Un compte admin existe deja pour cet email.' }, { status: 409 })

  const existing = await db().unsafe(
    `SELECT id
       FROM admin_invites
      WHERE lower(email) = lower($1)
        AND accepted = false
        AND deleted_at IS NULL
      ORDER BY created_at DESC
      LIMIT 1`,
    [email],
  )
  if (existing[0]?.id) return await resendInvite(req, existing[0].id, started, authDone)

  const id = crypto.randomUUID()
  const token = crypto.randomUUID()
  const expiresAt = new Date(Date.now() + 7 * 24 * 3600_000).toISOString()
  await db().unsafe(
    `INSERT INTO admin_invites (id, email, accepted, token, expires_at, metadata, created_at, updated_at)
     VALUES ($1, $2, false, $3, $4, $5::jsonb, now(), now())`,
    [id, email, token, expiresAt, JSON.stringify({})],
  )
  await recordSendResult(id, await sendInviteEmail(req, email, token), false)
  const invite = await getInvite(id)
  const done = nowMs()
  return json(
    { data: invite ? publicInvite(invite, req) : null },
    {
      status: 201,
      headers: {
        'server-timing': timingHeader({ auth: authDone - started, query: done - authDone, total: done - started }),
      },
    },
  )
}

async function resendInvite(req, id, started, authDone) {
  const invite = await getInvite(id)
  if (!invite) return json({ message: 'Invitation introuvable' }, { status: 404 })
  if (invite.accepted || invite.user_id) {
    return json({ message: 'Invitation deja acceptee. Le compte existe deja.' }, { status: 409 })
  }

  const token = crypto.randomUUID()
  const expiresAt = new Date(Date.now() + 7 * 24 * 3600_000).toISOString()
  await db().unsafe(
    `UPDATE admin_invites
        SET token = $2,
            expires_at = $3,
            updated_at = now()
      WHERE id = $1`,
    [id, token, expiresAt],
  )
  await recordSendResult(id, await sendInviteEmail(req, invite.email, token), true)

  const updated = await getInvite(id)
  const done = nowMs()
  return json(
    { data: updated ? publicInvite(updated, req) : null },
    {
      headers: {
        'server-timing': timingHeader({ auth: authDone - started, query: done - authDone, total: done - started }),
      },
    },
  )
}

async function deleteInvite(id, started, authDone) {
  const invite = await getInvite(id)
  if (!invite) return json({ message: 'Invitation introuvable' }, { status: 404 })
  if (invite.accepted || invite.user_id) {
    return json(
      { message: 'Invitation deja acceptee. Supprimer le compte admin est une action separee.' },
      { status: 409 },
    )
  }
  await db().unsafe('UPDATE admin_invites SET deleted_at = now(), updated_at = now() WHERE id = $1', [id])
  const done = nowMs()
  return json(
    { success: true },
    {
      headers: {
        'server-timing': timingHeader({ auth: authDone - started, query: done - authDone, total: done - started }),
      },
    },
  )
}

async function recordSendResult(id, result, resent) {
  await db().unsafe(
    `UPDATE admin_invites
        SET metadata = coalesce(metadata, '{}'::jsonb) || $2::jsonb ||
          CASE
            WHEN $3::boolean THEN jsonb_build_object('resend_count', coalesce((metadata->>'resend_count')::int, 0) + 1)
            ELSE '{}'::jsonb
          END,
            updated_at = now()
      WHERE id = $1`,
    [id, JSON.stringify(sendMetadata(result, resent)), resent],
  )
}

async function sendInviteEmail(req, email, token) {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.RESEND_FROM_EMAIL
  const acceptUrl = inviteUrl(req, token)
  if (!apiKey || !from) {
    return { status: 'PENDING', id: null, error: 'RESEND_API_KEY or RESEND_FROM_EMAIL unavailable' }
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [email],
        subject: 'Invitation Palas Admin',
        text: `Tu as ete invite a rejoindre l'admin Palas. Utilise ce lien pour accepter l'invitation : ${acceptUrl}\n\nCe lien expire dans 7 jours.`,
        html: `<p>Tu as ete invite a rejoindre l'admin Palas.</p><p><a href="${acceptUrl}">Accepter l'invitation</a></p><p>Ce lien expire dans 7 jours.</p>`,
        tags: [{ name: 'palas_admin_invite', value: 'true' }],
      }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) return { status: 'FAILURE', id: body.id ?? null, error: body.message ?? res.statusText }
    return { status: 'SUCCESS', id: body.id ?? null, error: null }
  } catch (err) {
    return { status: 'FAILURE', id: null, error: err instanceof Error ? err.message : String(err) }
  }
}

function sendMetadata(result, resent) {
  const now = new Date().toISOString()
  return {
    email_send_status: result.status,
    email_sent_at: now,
    email_provider_id: result.id,
    email_send_error: result.error,
    ...(resent ? { email_resent_at: now } : {}),
  }
}
