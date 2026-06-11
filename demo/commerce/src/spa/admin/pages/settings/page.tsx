import { useDashboardContext } from '@mantajs/dashboard'
import { Alert, Button } from '@mantajs/ui'
import { LogOut, ShieldCheck, UserRound } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

type CurrentUser = Awaited<ReturnType<ReturnType<typeof useDashboardContext>['authAdapter']['getCurrentUser']>>

export default function SettingsPage() {
  const { authAdapter } = useDashboardContext()
  const [error, setError] = useState<string | null>(null)
  const [isLoggingOut, setIsLoggingOut] = useState(false)
  const [user, setUser] = useState<CurrentUser | null>(null)

  useEffect(() => {
    let isMounted = true
    authAdapter
      .getCurrentUser()
      .then((currentUser) => {
        if (isMounted) setUser(currentUser)
      })
      .catch(() => {
        if (isMounted) setUser(null)
      })
    return () => {
      isMounted = false
    }
  }, [authAdapter])

  async function handleLogout() {
    setError(null)
    setIsLoggingOut(true)
    try {
      await globalThis.fetch('/api/admin/logout', {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      })
      localStorage.removeItem('manta-auth-token')
      localStorage.removeItem('manta-refresh-token')
      localStorage.removeItem('manta-auth-state')
      window.location.replace('/login')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to log out')
      setIsLoggingOut(false)
    }
  }

  const displayName = [user?.first_name, user?.last_name].filter(Boolean).join(' ') || user?.email || 'Admin user'

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">Manage access and account controls for the Palas admin.</p>
      </div>

      {error && <Alert variant="error">{error}</Alert>}

      <section className="rounded-md border bg-card">
        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
              <UserRound className="size-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-semibold">Session</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Signed in as <span className="font-medium text-foreground">{displayName}</span>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            disabled={isLoggingOut}
            data-testid="admin-logout-button"
            className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-input bg-background px-3 text-sm font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
          >
            <LogOut className="size-4" />
            {isLoggingOut ? 'Logging out...' : 'Log out'}
          </button>
        </div>
      </section>

      <section className="rounded-md border bg-card">
        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
              <ShieldCheck className="size-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold">Admin users</h2>
              <p className="mt-1 text-sm text-muted-foreground">Invite administrators and review active access.</p>
            </div>
          </div>
          <Button asChild variant="outline">
            <Link to="/settings/users">Manage users</Link>
          </Button>
        </div>
      </section>
    </div>
  )
}
