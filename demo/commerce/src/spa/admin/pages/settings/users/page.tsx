import { useDashboardContext } from '@mantajs/dashboard'
import { Alert, Badge, Button, Input, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@mantajs/ui'
import { Copy, RefreshCw, Send, Trash2 } from 'lucide-react'
import type React from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'

type AdminUser = {
  id: string
  email: string
  first_name?: string | null
  last_name?: string | null
  role?: string | null
  created_at?: string | null
}

type AdminInvite = {
  id: string
  email: string
  accepted: boolean
  expires_at: string
  created_at: string
  updated_at: string
  status: 'invited' | 'expired' | 'active' | 'accepted_missing_account'
  account: {
    id: string
    first_name?: string | null
    last_name?: string | null
    role?: string | null
    created_at?: string | null
  } | null
  email_send_status?: 'SUCCESS' | 'FAILURE' | 'PENDING' | string | null
  email_sent_at?: string | null
  email_resent_at?: string | null
  email_send_error?: string | null
  resend_count?: number
  invite_url: string
}

function authHeaders(authAdapter: ReturnType<typeof useDashboardContext>['authAdapter']) {
  return {
    'Content-Type': 'application/json',
    ...authAdapter.getAuthHeaders(),
  }
}

function formatDate(value?: string | null) {
  if (!value) return '-'
  return new Date(value).toLocaleString()
}

function inviteBadge(invite: AdminInvite) {
  if (invite.status === 'active') return <Badge variant="green">Compte actif</Badge>
  if (invite.status === 'expired') return <Badge variant="orange">Expiree</Badge>
  if (invite.status === 'accepted_missing_account') return <Badge variant="red">A verifier</Badge>
  return <Badge variant="blue">Invitee</Badge>
}

function emailBadge(invite: AdminInvite) {
  if (invite.email_send_status === 'SUCCESS') return <Badge variant="green">Envoye</Badge>
  if (invite.email_send_status === 'FAILURE') return <Badge variant="red">Echec</Badge>
  if (invite.email_send_status === 'PENDING') return <Badge variant="orange">A confirmer</Badge>
  return <Badge variant="outline">Inconnu</Badge>
}

export default function SettingsUsersPage() {
  const { authAdapter } = useDashboardContext()
  const [users, setUsers] = useState<AdminUser[]>([])
  const [invites, setInvites] = useState<AdminInvite[]>([])
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isInviting, setIsInviting] = useState(false)
  const [busyInviteId, setBusyInviteId] = useState<string | null>(null)

  const sortedUsers = useMemo(() => [...users].sort((a, b) => a.email.localeCompare(b.email)), [users])

  const loadUsers = useCallback(async () => {
    const res = await window.fetch('/api/admin/users?limit=100', {
      headers: authHeaders(authAdapter),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      return body.message || 'Unable to load users'
    }
    const body = (await res.json()) as { data?: AdminUser[] }
    setUsers(body.data ?? [])
    return null
  }, [authAdapter])

  const loadInvites = useCallback(async () => {
    const res = await window.fetch('/api/admin/invitations', {
      headers: authHeaders(authAdapter),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      return body.message || 'Unable to load invitations'
    }
    const body = (await res.json()) as { data?: AdminInvite[] }
    setInvites(body.data ?? [])
    return null
  }, [authAdapter])

  const loadAll = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    const [usersError, invitesError] = await Promise.all([loadUsers(), loadInvites()])
    setError(usersError ?? invitesError ?? null)
    setIsLoading(false)
  }, [loadUsers, loadInvites])

  useEffect(() => {
    void loadAll()
  }, [loadAll])

  async function mutateInvitations(input: Record<string, unknown>) {
    const res = await window.fetch('/api/admin/invitations', {
      method: 'POST',
      headers: authHeaders(authAdapter),
      body: JSON.stringify(input),
    })
    const body = (await res.json().catch(() => ({}))) as { data?: AdminInvite; message?: string }
    return res.ok ? { data: body.data, error: null } : { data: null, error: body.message || 'Invitation action failed' }
  }

  async function handleInvite(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setStatus(null)
    setIsInviting(true)
    const result = await mutateInvitations({ action: 'create', email })
    if (result.error) {
      setError(result.error)
    } else {
      setEmail('')
      setStatus(`Invitation envoyee a ${result.data?.email ?? email}.`)
      await loadAll()
    }
    setIsInviting(false)
  }

  async function handleResend(invite: AdminInvite) {
    setError(null)
    setStatus(null)
    setBusyInviteId(invite.id)
    const result = await mutateInvitations({ action: 'resend', id: invite.id })
    if (result.error) {
      setError(result.error)
    } else {
      setStatus(`Invitation renvoyee a ${invite.email}.`)
      await loadInvites()
    }
    setBusyInviteId(null)
  }

  async function handleDelete(invite: AdminInvite) {
    setError(null)
    setStatus(null)
    setBusyInviteId(invite.id)
    const result = await mutateInvitations({ action: 'delete', id: invite.id })
    if (result.error) {
      setError(result.error)
    } else {
      setStatus(`Invitation supprimee pour ${invite.email}.`)
      await loadInvites()
    }
    setBusyInviteId(null)
  }

  async function handleCopy(invite: AdminInvite) {
    await navigator.clipboard.writeText(invite.invite_url)
    setStatus(`Lien copie pour ${invite.email}.`)
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Acces admin</h1>
        <p className="text-sm text-muted-foreground">Comptes actifs et invitations Palas.</p>
      </div>

      <form onSubmit={handleInvite} className="flex max-w-2xl flex-col gap-3 rounded-md border bg-card p-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <Input
            autoComplete="email"
            onChange={(event) => setEmail(event.target.value)}
            placeholder="admin@example.com"
            required
            type="email"
            value={email}
          />
          <Button type="submit" isLoading={isInviting}>
            <Send className="mr-2 size-4" />
            Inviter
          </Button>
        </div>
        {status && <Alert variant="success">{status}</Alert>}
        {error && <Alert variant="error">{error}</Alert>}
      </form>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Invitations</h2>
          <Button type="button" variant="outline" size="small" onClick={() => void loadAll()} isLoading={isLoading}>
            <RefreshCw className="mr-2 size-4" />
            Actualiser
          </Button>
        </div>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Expire le</TableHead>
                <TableHead>Dernier envoi</TableHead>
                <TableHead>Renvois</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={7} className="text-muted-foreground">
                    Chargement...
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && invites.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-muted-foreground">
                    Aucune invitation.
                  </TableCell>
                </TableRow>
              )}
              {!isLoading &&
                invites.map((invite) => {
                  const canManageInvite = invite.status === 'invited' || invite.status === 'expired'
                  return (
                    <TableRow key={invite.id}>
                      <TableCell className="font-medium">{invite.email}</TableCell>
                      <TableCell>{inviteBadge(invite)}</TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          {emailBadge(invite)}
                          {invite.email_send_error && (
                            <span
                              className="max-w-48 truncate text-xs text-destructive"
                              title={invite.email_send_error}
                            >
                              {invite.email_send_error}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>{formatDate(invite.expires_at)}</TableCell>
                      <TableCell>{formatDate(invite.email_resent_at ?? invite.email_sent_at)}</TableCell>
                      <TableCell>{invite.resend_count ?? 0}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-2">
                          <Button type="button" variant="outline" size="small" onClick={() => void handleCopy(invite)}>
                            <Copy className="mr-2 size-4" />
                            Copier
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="small"
                            disabled={!canManageInvite}
                            isLoading={busyInviteId === invite.id}
                            onClick={() => void handleResend(invite)}
                          >
                            <Send className="mr-2 size-4" />
                            Renvoyer
                          </Button>
                          <Button
                            type="button"
                            variant="destructive"
                            size="small"
                            disabled={!canManageInvite}
                            isLoading={busyInviteId === invite.id}
                            onClick={() => void handleDelete(invite)}
                          >
                            <Trash2 className="mr-2 size-4" />
                            Supprimer
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
            </TableBody>
          </Table>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Comptes actifs</h2>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Nom</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Cree le</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={4} className="text-muted-foreground">
                    Chargement...
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && sortedUsers.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-muted-foreground">
                    Aucun compte admin.
                  </TableCell>
                </TableRow>
              )}
              {!isLoading &&
                sortedUsers.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell className="font-medium">{user.email}</TableCell>
                    <TableCell>{[user.first_name, user.last_name].filter(Boolean).join(' ') || '-'}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{user.role ?? 'admin'}</Badge>
                    </TableCell>
                    <TableCell>{formatDate(user.created_at)}</TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  )
}
