import { useDashboardContext } from '@manta/dashboard-core'
import { Alert, Badge, Button, Input, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@manta/ui'
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

type InviteResponse = {
  data?: {
    token?: string
    email?: string
  }
}

function authHeaders(authAdapter: ReturnType<typeof useDashboardContext>['authAdapter']) {
  return {
    'Content-Type': 'application/json',
    ...authAdapter.getAuthHeaders(),
  }
}

export default function SettingsUsersPage() {
  const { authAdapter } = useDashboardContext()
  const [users, setUsers] = useState<AdminUser[]>([])
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [inviteLink, setInviteLink] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isInviting, setIsInviting] = useState(false)

  const sortedUsers = useMemo(() => [...users].sort((a, b) => a.email.localeCompare(b.email)), [users])

  const loadUsers = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    const res = await window.fetch('/api/admin/users?limit=100', {
      headers: authHeaders(authAdapter),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.message || 'Unable to load users')
      setIsLoading(false)
      return
    }
    const body = (await res.json()) as { data?: AdminUser[] }
    setUsers(body.data ?? [])
    setIsLoading(false)
  }, [authAdapter])

  useEffect(() => {
    void loadUsers()
  }, [loadUsers])

  async function handleInvite(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setStatus(null)
    setInviteLink(null)
    setIsInviting(true)
    const res = await window.fetch('/api/admin/create-invite', {
      method: 'POST',
      headers: authHeaders(authAdapter),
      body: JSON.stringify({ email }),
    })
    const body = (await res.json().catch(() => ({}))) as InviteResponse & { message?: string }
    if (!res.ok) {
      setError(body.message || 'Unable to create invitation')
      setIsInviting(false)
      return
    }

    const token = body.data?.token
    setStatus(`Invitation created for ${body.data?.email ?? email}.`)
    if (token) {
      setInviteLink(`${window.location.origin}/accept-invite?token=${encodeURIComponent(token)}`)
    }
    setEmail('')
    setIsInviting(false)
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
        <p className="text-sm text-muted-foreground">Invite and review administrators.</p>
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
            Send invite
          </Button>
        </div>
        {status && <Alert variant="success">{status}</Alert>}
        {inviteLink && (
          <div className="rounded-md border bg-background p-3 text-sm">
            <a className="break-all font-medium text-primary hover:text-primary/80" href={inviteLink}>
              {inviteLink}
            </a>
          </div>
        )}
        {error && <Alert variant="error">{error}</Alert>}
      </form>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={4} className="text-muted-foreground">
                  Loading users...
                </TableCell>
              </TableRow>
            )}
            {!isLoading && sortedUsers.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-muted-foreground">
                  No users yet.
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
                  <TableCell>{user.created_at ? new Date(user.created_at).toLocaleDateString() : '-'}</TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
