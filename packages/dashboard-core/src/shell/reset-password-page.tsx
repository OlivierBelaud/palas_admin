import { Alert, Button, Input } from '@manta/ui'
import type React from 'react'
import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useDashboardContext } from '../context'

export const ResetPasswordPage = () => {
  const { authAdapter } = useDashboardContext()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const initialEmail = searchParams.get('email') ?? ''
  const token = searchParams.get('token') ?? ''
  const hasToken = token.length > 0

  const [email, setEmail] = useState(initialEmail)
  const [password, setPassword] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const title = useMemo(() => (hasToken ? 'Choose a new password' : 'Reset your password'), [hasToken])

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setStatus(null)
    setIsSubmitting(true)
    try {
      if (hasToken) {
        if (!authAdapter.confirmPasswordReset) throw new Error('Password reset is not configured')
        await authAdapter.confirmPasswordReset({ email, token, password })
        setStatus('Password updated. You can sign in now.')
        setTimeout(() => navigate('/login'), 800)
      } else {
        const requestReset = authAdapter.requestPasswordReset ?? authAdapter.resetPassword
        if (!requestReset) throw new Error('Password reset is not configured')
        await requestReset(email)
        setStatus('If this account exists, a reset email has been sent.')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-dvh w-dvw items-center justify-center bg-muted">
      <div className="m-4 flex w-full max-w-[320px] flex-col gap-4">
        <div className="flex flex-col items-center gap-1 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="text-sm text-muted-foreground">
            {hasToken ? 'Enter your email and a new password.' : 'Enter your admin email.'}
          </p>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <Input
            autoComplete="email"
            className="bg-background"
            onChange={(event) => setEmail(event.target.value)}
            placeholder="Email"
            required
            type="email"
            value={email}
          />
          {hasToken && (
            <Input
              autoComplete="new-password"
              className="bg-background"
              minLength={8}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="New password"
              required
              type="password"
              value={password}
            />
          )}
          {error && <Alert variant="error">{error}</Alert>}
          {status && <Alert variant="success">{status}</Alert>}
          <Button className="w-full" type="submit" isLoading={isSubmitting}>
            {hasToken ? 'Update password' : 'Send reset link'}
          </Button>
        </form>
        <Link className="text-center text-sm font-medium text-primary hover:text-primary/80" to="/login">
          Back to login
        </Link>
      </div>
    </div>
  )
}
