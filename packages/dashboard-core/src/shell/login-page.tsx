import { zodResolver } from "@hookform/resolvers/zod"
import { Alert, Button, Heading, Hint, Input, Text } from "@medusajs/ui"
import { useForm } from "react-hook-form"
import { Link, useLocation, useNavigate } from "react-router-dom"
import * as z from "zod"

import { Form } from "../components/common/form"
import AvatarBox from "../components/common/avatar-box"
import { useDashboardContext } from "../context"
import { isFetchError } from "../lib/is-fetch-error"

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

export const LoginPage = ({
  subtitle = "Sign in to your account",
  defaultRedirect = "/orders",
}: LoginPageProps) => {
  const location = useLocation()
  const navigate = useNavigate()
  const { authAdapter } = useDashboardContext()

  const from = location.state?.from?.pathname || defaultRedirect

  const form = useForm<z.infer<typeof LoginSchema>>({
    resolver: zodResolver(LoginSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  })

  const handleSubmit = form.handleSubmit(async ({ email, password }) => {
    try {
      await authAdapter.login({ email, password })
      navigate(from, { replace: true })
    } catch (error: unknown) {
      if (isFetchError(error)) {
        if ((error as { status: number }).status === 401) {
          form.setError("email", {
            type: "manual",
            message: (error as Error).message,
          })
          return
        }
      }
      form.setError("root.serverError", {
        type: "manual",
        message: error instanceof Error ? error.message : "Login failed",
      })
    }
  })

  const serverError = form.formState.errors?.root?.serverError?.message
  const validationError =
    form.formState.errors.email?.message ||
    form.formState.errors.password?.message

  return (
    <div className="bg-ui-bg-subtle flex min-h-dvh w-dvw items-center justify-center">
      <div className="m-4 flex w-full max-w-[280px] flex-col items-center">
        <AvatarBox />
        <div className="mb-4 flex flex-col items-center">
          <Heading>Welcome back</Heading>
          <Text size="small" className="text-ui-fg-subtle text-center">
            {subtitle}
          </Text>
        </div>
        <div className="flex w-full flex-col gap-y-3">
          <Form {...form}>
            <form
              onSubmit={handleSubmit}
              className="flex w-full flex-col gap-y-6"
            >
              <div className="flex flex-col gap-y-1">
                <Form.Field
                  control={form.control}
                  name="email"
                  render={({ field }) => {
                    return (
                      <Form.Item>
                        <Form.Control>
                          <Input
                            autoComplete="email"
                            {...field}
                            className="bg-ui-bg-field-component"
                            placeholder="Email"
                          />
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
                            className="bg-ui-bg-field-component"
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
                  <Hint className="inline-flex" variant={"error"}>
                    {validationError}
                  </Hint>
                </div>
              )}
              {serverError && (
                <Alert
                  className="bg-ui-bg-base items-center p-2"
                  dismissible
                  variant="error"
                >
                  {serverError}
                </Alert>
              )}
              <Button className="w-full" type="submit" isLoading={form.formState.isSubmitting}>
                Continue with Email
              </Button>
            </form>
          </Form>
        </div>
        <span className="text-ui-fg-muted txt-small my-6">
          Forgot your password?{" "}
          <Link
            to="/reset-password"
            className="text-ui-fg-interactive transition-fg hover:text-ui-fg-interactive-hover focus-visible:text-ui-fg-interactive-hover font-medium outline-none"
          >
            Reset it
          </Link>
        </span>
      </div>
    </div>
  )
}
