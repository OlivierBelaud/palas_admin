import { Spinner } from "@medusajs/icons"
import { Navigate, Outlet, useLocation } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { useDashboardContext } from "../context"
import { SearchProvider } from "../providers/search-provider"
import { SidebarProvider } from "../providers/sidebar-provider"

export const ProtectedRoute = () => {
  const { authAdapter } = useDashboardContext()
  const location = useLocation()

  const { data: user, isLoading } = useQuery({
    queryKey: ["auth", "me"],
    queryFn: () => authAdapter.getCurrentUser(),
    retry: false,
  })

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner className="text-ui-fg-interactive animate-spin" />
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  return (
    <SidebarProvider>
      <SearchProvider>
        <Outlet />
      </SearchProvider>
    </SidebarProvider>
  )
}
