import { zodResolver } from '@hookform/resolvers/zod'
import { Alert, Button, Input } from '@manta/ui'
import { useForm } from 'react-hook-form'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import * as z from 'zod'
import AvatarBox from '../components/common/avatar-box'
import { Form } from '../components/common/form'
import { useDashboardContext } from '../context'
import { isFetchError } from '../lib/is-fetch-error'

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
})

export interface LoginPageProps {
  /** Subtitle text (e.g. "Sign in to your Medusa Store") */
  subtitle?: string
  /** Default redirect path after login */
  defaultRedirect?: string
}

export const LoginPage = ({ subtitle = 'Sign in to your account', defaultRedirect = '/orders' }: LoginPageProps) => {
  const location = useLocation()
  const navigate = useNavigate()
  const { authAdapter } = useDashboardContext()

  const from = location.state?.from?.pathname || defaultRedirect

  const form = useForm<z.infer<typeof LoginSchema>>({
    resolver: zodResolver(LoginSchema),
    defaultValues: {
      email: '',
      password: '',
    },
  })

  const handleSubmit = form.handleSubmit(async ({ email, password }) => {
    try {
      await authAdapter.login({ email, password })
      navigate(from, { replace: true })
    } catch (error: unknown) {
      if (isFetchError(error)) {
        if ((error as { status: number }).status === 401) {
          form.setError('email', {
            type: 'manual',
            message: (error as Error).message,
          })
          return
        }
      }
      form.setError('root.serverError', {
        type: 'manual',
        message: error instanceof Error ? error.message : 'Login failed',
      })
    }
  })

  const serverError = form.formState.errors?.root?.serverError?.message
  const validationError = form.formState.errors.email?.message || form.formState.errors.password?.message

  return (
    <div className="flex min-h-dvh w-dvw items-center justify-center bg-muted">
      <div className="m-4 flex w-full max-w-[280px] flex-col items-center">
        <AvatarBox />
        <div className="mb-4 flex flex-col items-center">
          <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
          <span className="text-sm text-muted-foreground text-center">{subtitle}</span>
        </div>
        <div className="flex w-full flex-col gap-y-3">
          <Form {...form}>
            <form onSubmit={handleSubmit} className="flex w-full flex-col gap-y-6">
              <div className="flex flex-col gap-y-1">
                <Form.Field
                  control={form.control}
                  name="email"
                  render={({ field }) => {
                    return (
                      <Form.Item>
                        <Form.Control>
                          <Input autoComplete="email" {...field} className="bg-background" placeholder="Email" />
                        </Form.Control>
                      </Form.Item>
                    )
                  }}
                />
                <Form.Field
                  control={form.control}
                  name="password"
                  render={({ field }) => {
                    return (
                      <Form.Item>
                        <Form.Label>{}</Form.Label>
                        <Form.Control>
                          <Input
                            type="password"
                            autoComplete="current-password"
                            {...field}
                            className="bg-background"
                            placeholder="Password"
                          />
                        </Form.Control>
                      </Form.Item>
                    )
                  }}
                />
              </div>
              {validationError && (
                <div className="text-center">
                  <p className="inline-flex text-sm text-destructive">{validationError}</p>
                </div>
              )}
              {serverError && (
                <Alert className="items-center bg-background p-2" dismissible variant="error">
                  {serverError}
                </Alert>
              )}
              <Button className="w-full" type="submit" isLoading={form.formState.isSubmitting}>
                Continue with Email
              </Button>
            </form>
          </Form>
        </div>
        <span className="my-6 text-sm text-muted-foreground">
          Forgot your password?{' '}
          <Link
            to="/reset-password"
            className="font-medium text-primary transition-colors hover:text-primary/80 outline-none"
          >
            Reset it
          </Link>
        </span>
      </div>
    </div>
  )
}
