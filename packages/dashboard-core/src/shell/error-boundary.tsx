import { AlertCircle } from 'lucide-react'
import { Navigate, useLocation, useRouteError } from 'react-router-dom'

export const ErrorBoundary = () => {
  const error = useRouteError()
  const location = useLocation()

  let code: number | null = null

  if (error && typeof error === 'object' && 'status' in error) {
    const status = (error as { status: number }).status
    if (status === 401) {
      return <Navigate to="/login" state={{ from: location }} replace />
    }
    code = status ?? null
  }

  // Dev-only logging. Vite replaces import.meta.env.DEV at build time in the SPA.
  if ((import.meta as { env?: { DEV?: boolean } }).env?.DEV) {
    console.error(error)
  }

  let title: string
  let message: string

  switch (code) {
    case 400:
      title = 'Bad Request'
      message = 'The request was invalid. Please try again.'
      break
    case 404:
      title = 'Not Found'
      message = 'The page you are looking for does not exist.'
      break
    case 500:
      title = 'Internal Server Error'
      message = 'An unexpected error occurred. Please try again later.'
      break
    default:
      title = 'An error occurred'
      message = error instanceof Error ? error.message : 'Something went wrong. Please try again.'
      break
  }

  return (
    <div className="flex size-full min-h-[calc(100vh-57px-24px)] items-center justify-center">
      <div className="flex flex-col gap-y-6">
        <div className="flex flex-col items-center gap-y-3 text-muted-foreground">
          <AlertCircle />
          <div className="flex flex-col items-center justify-center gap-y-1">
            <span className="text-sm font-medium">{title}</span>
            <span className="text-sm text-muted-foreground text-balance text-center">{message}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
