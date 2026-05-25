import { Alert, Button, Input } from '@manta/ui'
import type React from 'react'
import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useDashboardContext } from '../context'

export const AcceptInvitePage = () => {
  const { authAdapter } = useDashboardContext()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token') ?? ''
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(token ? null : 'Invitation token is missing')
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!token) return
    setError(null)
    setIsSubmitting(true)
    try {
      if (!authAdapter.acceptInvite) throw new Error('Invitations are not configured')
      await authAdapter.acceptInvite({
        token,
        password,
        first_name: firstName || undefined,
        last_name: lastName || undefined,
      })
      navigate('/login', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invitation failed')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-dvh w-dvw items-center justify-center bg-muted">
      <div className="m-4 flex w-full max-w-[340px] flex-col gap-4">
        <div className="flex flex-col items-center gap-1 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Create your account</h1>
          <p className="text-sm text-muted-foreground">Complete your admin invitation.</p>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-2">
            <Input
              autoComplete="given-name"
              className="bg-background"
              onChange={(event) => setFirstName(event.target.value)}
              placeholder="First name"
              value={firstName}
            />
            <Input
              autoComplete="family-name"
              className="bg-background"
              onChange={(event) => setLastName(event.target.value)}
              placeholder="Last name"
              value={lastName}
            />
          </div>
          <Input
            autoComplete="new-password"
            className="bg-background"
            minLength={8}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Password"
            required
            type="password"
            value={password}
          />
          {error && <Alert variant="error">{error}</Alert>}
          <Button className="w-full" disabled={!token} type="submit" isLoading={isSubmitting}>
            Accept invitation
          </Button>
        </form>
        <Link className="text-center text-sm font-medium text-primary hover:text-primary/80" to="/login">
          Back to login
        </Link>
      </div>
    </div>
  )
}
