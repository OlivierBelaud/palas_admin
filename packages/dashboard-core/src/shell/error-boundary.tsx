import { ExclamationCircle } from "@medusajs/icons"
import { Text } from "@medusajs/ui"
import { Navigate, useLocation, useRouteError } from "react-router-dom"

export const ErrorBoundary = () => {
  const error = useRouteError()
  const location = useLocation()

  let code: number | null = null

  if (error && typeof error === "object" && "status" in error) {
    const status = (error as { status: number }).status
    if (status === 401) {
      return <Navigate to="/login" state={{ from: location }} replace />
    }
    code = status ?? null
  }

  if (process.env.NODE_ENV === "development") {
    console.error(error)
  }

  let title: string
  let message: string

  switch (code) {
    case 400:
      title = "Bad Request"
      message = "The request was invalid. Please try again."
      break
    case 404:
      title = "Not Found"
      message = "The page you are looking for does not exist."
      break
    case 500:
      title = "Internal Server Error"
      message = "An unexpected error occurred. Please try again later."
      break
    default:
      title = "An error occurred"
      message =
        error instanceof Error
          ? error.message
          : "Something went wrong. Please try again."
      break
  }

  return (
    <div className="flex size-full min-h-[calc(100vh-57px-24px)] items-center justify-center">
      <div className="flex flex-col gap-y-6">
        <div className="text-ui-fg-subtle flex flex-col items-center gap-y-3">
          <ExclamationCircle />
          <div className="flex flex-col items-center justify-center gap-y-1">
            <Text size="small" leading="compact" weight="plus">
              {title}
            </Text>
            <Text
              size="small"
              className="text-ui-fg-muted text-balance text-center"
            >
              {message}
            </Text>
          </div>
        </div>
      </div>
    </div>
  )
}
