type RawDb = { raw: <T>(sql: string, params?: unknown[]) => Promise<T[]> }
type NotificationPort = {
  send: (input: {
    to: string
    channel: string
    subject?: string
    text?: string
    html?: string
    idempotency_key?: string
    tags?: Array<{ name: string; value: string }>
  }) => Promise<{ status: 'SUCCESS' | 'FAILURE' | 'PENDING'; id?: string; error?: Error }>
}

type MantaRequest = Request & {
  app?: {
    infra?: {
      db?: unknown
      notification?: NotificationPort
    }
  }
  scope?: { resolve: <T>(key: string) => T }
  authContext?: { id?: string; type?: string }
  verifyAuth?: (context: string) => Promise<unknown>
}

type InviteRow = {
  id: string
  email: string
  accepted: boolean
  token: string
  expires_at: string
  created_at: string
  updated_at: string
  metadata: Record<string, unknown> | null
  user_id: string | null
  first_name: string | null
  last_name: string | null
  role: string | null
  user_created_at: string | null
}

function dbFrom(req: MantaRequest): RawDb {
  const db = hasRawDb(req.app?.infra?.db) ? req.app?.infra?.db : req.scope?.resolve<RawDb>('IDatabasePort')
  if (!db) throw new MantaError('UNEXPECTED_STATE', 'Database unavailable')
  return db
}

function hasRawDb(value: unknown): value is RawDb {
  return !!value && typeof value === 'object' && typeof (value as { raw?: unknown }).raw === 'function'
}

async function requireAdmin(req: MantaRequest): Promise<Response | null> {
  const auth = req.authContext ?? (await req.verifyAuth?.('admin').catch(() => null))
  if (!auth || (typeof auth === 'object' && 'type' in auth && auth.type !== 'admin')) {
    return Response.json({ type: 'UNAUTHORIZED', message: 'Authentication required' }, { status: 401 })
  }
  return null
}

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const email = value.trim().toLowerCase()
  return email.includes('@') && email.length <= 320 ? email : null
}

function inviteUrl(req: Request, token: string): string {
  const base = (process.env.ADMIN_BASE_URL ?? process.env.MANTA_BASE_URL ?? new URL(req.url).origin).replace(/\/+$/, '')
  return `${base}/accept-invite?token=${encodeURIComponent(token)}`
}

function inviteStatus(row: InviteRow): string {
  if (row.user_id) return 'active'
  if (row.accepted) return 'accepted_missing_account'
  if (new Date(row.expires_at).getTime() < Date.now()) return 'expired'
  return 'invited'
}

function publicInvite(row: InviteRow, req: Request) {
  const metadata = row.metadata ?? {}
  return {
    id: row.id,
    email: row.email,
    accepted: row.accepted,
    expires_at: row.expires_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    status: inviteStatus(row),
    account: row.user_id
      ? {
          id: row.user_id,
          first_name: row.first_name,
          last_name: row.last_name,
          role: row.role,
          created_at: row.user_created_at,
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

async function listInvites(db: RawDb): Promise<InviteRow[]> {
  return await db.raw<InviteRow>(
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

async function getInvite(db: RawDb, id: string): Promise<InviteRow | null> {
  const rows = await db.raw<InviteRow>(
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

async function sendInviteEmail(req: Request, notification: NotificationPort | undefined, email: string, token: string) {
  if (!notification) {
    return { status: 'PENDING' as const, id: null, error: 'Notification adapter unavailable' }
  }

  const acceptUrl = inviteUrl(req, token)
  const result = await notification.send({
    to: email,
    channel: 'email',
    subject: 'Invitation Palas Admin',
    text: `Tu as ete invite a rejoindre l'admin Palas. Utilise ce lien pour accepter l'invitation : ${acceptUrl}\n\nCe lien expire dans 7 jours.`,
    html: `<p>Tu as ete invite a rejoindre l'admin Palas.</p><p><a href="${acceptUrl}">Accepter l'invitation</a></p><p>Ce lien expire dans 7 jours.</p>`,
    idempotency_key: `palas:admin-invite:${email}:${token}`,
    tags: [{ name: 'palas_admin_invite', value: 'true' }],
  })

  return {
    status: result.status,
    id: result.id ?? null,
    error: result.error?.message ?? null,
  }
}

async function recordSendResult(
  db: RawDb,
  id: string,
  result: { status: string; id: string | null; error: string | null },
  resent: boolean,
) {
  const now = new Date().toISOString()
  const metadata: Record<string, unknown> = {
    email_send_status: result.status,
    email_sent_at: now,
    email_provider_id: result.id,
    email_send_error: result.error,
  }
  if (resent) {
    metadata.email_resent_at = now
  }

  await db.raw(
    `UPDATE admin_invites
     SET metadata = coalesce(metadata, '{}'::jsonb)
       || $2::jsonb
       || CASE
          WHEN $3::boolean THEN jsonb_build_object('resend_count', coalesce((metadata->>'resend_count')::int, 0) + 1)
          ELSE '{}'::jsonb
        END,
        updated_at = now()
     WHERE id = $1`,
    [id, JSON.stringify(metadata), resent],
  )
}

async function createInvite(req: MantaRequest, db: RawDb, body: Record<string, unknown>) {
  const email = normalizeEmail(body.email)
  if (!email) return Response.json({ message: 'Email invalide' }, { status: 400 })

  const existingUsers = await db.raw<{ id: string }>(
    'SELECT id FROM admins WHERE lower(email) = lower($1) AND deleted_at IS NULL LIMIT 1',
    [email],
  )
  if (existingUsers.length > 0) {
    return Response.json({ message: 'Un compte admin existe deja pour cet email.' }, { status: 409 })
  }

  const existingInvites = await db.raw<{ id: string }>(
    `SELECT id
     FROM admin_invites
     WHERE lower(email) = lower($1)
       AND accepted = false
       AND deleted_at IS NULL
     ORDER BY created_at DESC
     LIMIT 1`,
    [email],
  )

  if (existingInvites[0]?.id) {
    return await resendInvite(req, db, existingInvites[0].id)
  }

  const id = crypto.randomUUID()
  const token = crypto.randomUUID()
  const expiresAt = new Date(Date.now() + 7 * 24 * 3600_000).toISOString()

  await db.raw(
    `INSERT INTO admin_invites (id, email, accepted, token, expires_at, metadata, created_at, updated_at)
     VALUES ($1, $2, false, $3, $4, '{}'::jsonb, now(), now())`,
    [id, email, token, expiresAt],
  )

  const result = await sendInviteEmail(req, req.app?.infra?.notification, email, token)
  await recordSendResult(db, id, result, false)

  const invite = await getInvite(db, id)
  return Response.json({ data: invite ? publicInvite(invite, req) : null }, { status: 201 })
}

async function resendInvite(req: MantaRequest, db: RawDb, id: string) {
  const invite = await getInvite(db, id)
  if (!invite) return Response.json({ message: 'Invitation introuvable' }, { status: 404 })
  if (invite.accepted || invite.user_id) {
    return Response.json({ message: 'Invitation deja acceptee. Le compte existe deja.' }, { status: 409 })
  }

  const token = crypto.randomUUID()
  const expiresAt = new Date(Date.now() + 7 * 24 * 3600_000).toISOString()
  await db.raw('UPDATE admin_invites SET token = $2, expires_at = $3, updated_at = now() WHERE id = $1', [
    id,
    token,
    expiresAt,
  ])

  const result = await sendInviteEmail(req, req.app?.infra?.notification, invite.email, token)
  await recordSendResult(db, id, result, true)

  const updated = await getInvite(db, id)
  return Response.json({ data: updated ? publicInvite(updated, req) : null })
}

async function deleteInvite(db: RawDb, id: string) {
  const invite = await getInvite(db, id)
  if (!invite) return Response.json({ message: 'Invitation introuvable' }, { status: 404 })
  if (invite.accepted || invite.user_id) {
    return Response.json(
      { message: 'Invitation deja acceptee. Supprimer le compte admin est une action separee.' },
      { status: 409 },
    )
  }

  await db.raw('UPDATE admin_invites SET deleted_at = now(), updated_at = now() WHERE id = $1', [id])
  return Response.json({ success: true })
}

export async function GET(req: MantaRequest) {
  const unauthorized = await requireAdmin(req)
  if (unauthorized) return unauthorized

  const db = dbFrom(req)
  const rows = await listInvites(db)
  return Response.json({ data: rows.map((row) => publicInvite(row, req)) })
}

export async function POST(req: MantaRequest) {
  const unauthorized = await requireAdmin(req)
  if (unauthorized) return unauthorized

  const db = dbFrom(req)
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const action = typeof body.action === 'string' ? body.action : 'create'

  if (action === 'create') return await createInvite(req, db, body)
  if (action === 'resend' && typeof body.id === 'string') return await resendInvite(req, db, body.id)
  if (action === 'delete' && typeof body.id === 'string') return await deleteInvite(db, body.id)

  return Response.json({ message: 'Action invalide' }, { status: 400 })
}
