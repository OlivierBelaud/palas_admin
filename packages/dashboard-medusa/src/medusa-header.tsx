import { Skeleton, useDashboardContext, useDocumentDirection } from '@manta/dashboard-core'
import { BuildingStorefront, EllipsisHorizontal, OpenRectArrowOut } from '@medusajs/icons'
import { Avatar, clx, DropdownMenu, Text } from '@medusajs/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'

export const MedusaHeader = () => {
  const { dataSource, authAdapter } = useDashboardContext()
  const direction = useDocumentDirection()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const { data, isPending, isError, error } = useQuery({
    queryKey: ['store', 'detail'],
    queryFn: async () => {
      const response = (await dataSource.fetch('/admin/stores')) as any
      const activeStore = response?.stores?.[0]
      if (!activeStore) throw new Error('No active store found')
      return activeStore
    },
  })

  const name = data?.name
  const fallback = name?.slice(0, 1).toUpperCase()
  const isLoaded = !isPending && !!data && !!name && !!fallback

  if (isError) {
    throw error
  }

  const handleLogout = async () => {
    await authAdapter.logout()
    queryClient.clear()
    navigate('/login')
  }

  return (
    <div className="w-full p-3">
      <DropdownMenu dir={direction}>
        <DropdownMenu.Trigger
          disabled={!isLoaded}
          className={clx(
            'bg-ui-bg-subtle transition-fg grid w-full grid-cols-[24px_1fr_15px] items-center gap-x-3 rounded-md p-0.5 pe-2 outline-none',
            'hover:bg-ui-bg-subtle-hover',
            'data-[state=open]:bg-ui-bg-subtle-hover',
            'focus-visible:shadow-borders-focus',
          )}
        >
          {fallback ? (
            <Avatar variant="squared" size="xsmall" fallback={fallback} />
          ) : (
            <Skeleton className="h-6 w-6 rounded-md" />
          )}
          <div className="block overflow-hidden text-start">
            {name ? (
              <Text size="small" weight="plus" leading="compact" className="truncate">
                {name}
              </Text>
            ) : (
              <Skeleton className="h-[9px] w-[120px]" />
            )}
          </div>
          <EllipsisHorizontal className="text-ui-fg-muted" />
        </DropdownMenu.Trigger>
        {isLoaded && (
          <DropdownMenu.Content className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-0">
            <div className="flex items-center gap-x-3 px-2 py-1">
              <Avatar variant="squared" size="small" fallback={fallback} />
              <div className="flex flex-col overflow-hidden">
                <Text size="small" weight="plus" leading="compact" className="truncate">
                  {name}
                </Text>
                <Text size="xsmall" leading="compact" className="text-ui-fg-subtle">
                  Store
                </Text>
              </div>
            </div>
            <DropdownMenu.Separator />
            <DropdownMenu.Item className="gap-x-2" asChild>
              <Link to="/settings/store">
                <BuildingStorefront className="text-ui-fg-subtle" />
                Store Settings
              </Link>
            </DropdownMenu.Item>
            <DropdownMenu.Separator />
            <DropdownMenu.Item onClick={handleLogout}>
              <div className="flex items-center gap-x-2">
                <OpenRectArrowOut className="text-ui-fg-subtle" />
                <span>Log out</span>
              </div>
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        )}
      </DropdownMenu>
    </div>
  )
}
