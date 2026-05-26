import { Alert, Button, Input } from '@manta/ui'
import type React from 'react'
import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
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
  const title = useMemo(
    () => (hasToken ? 'Choisir un nouveau mot de passe' : 'Réinitialiser votre mot de passe'),
    [hasToken],
  )

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setStatus(null)
    setIsSubmitting(true)
    try {
      if (hasToken) {
        if (!authAdapter.confirmPasswordReset) throw new Error('Password reset is not configured')
        await authAdapter.confirmPasswordReset({ email, token, password })
        setStatus('Mot de passe mis à jour. Vous pouvez vous connecter.')
      } else {
        const requestReset = authAdapter.requestPasswordReset ?? authAdapter.resetPassword
        if (!requestReset) throw new Error('Password reset is not configured')
        await requestReset(email)
        setStatus('Si ce compte existe, un email de réinitialisation vient d’être envoyé.')
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
            {hasToken
              ? 'Saisissez votre email admin et votre nouveau mot de passe.'
              : 'Saisissez votre email admin pour recevoir un lien.'}
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
              placeholder="Nouveau mot de passe"
              required
              type="password"
              value={password}
            />
          )}
          {error && <Alert variant="error">{error}</Alert>}
          {status && <Alert variant="success">{status}</Alert>}
          <Button className="w-full" type="submit" isLoading={isSubmitting}>
            {hasToken ? 'Mettre à jour le mot de passe' : 'Envoyer le lien de réinitialisation'}
          </Button>
        </form>
        {status && (
          <Button className="w-full" variant="outline" type="button" onClick={() => navigate('/login')}>
            Retour à la connexion
          </Button>
        )}
      </div>
    </div>
  )
}
