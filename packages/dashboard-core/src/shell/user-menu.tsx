import { Avatar, cn, DropdownMenu } from '@manta/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { BookOpen, ExternalLink, MoreHorizontal, ScrollText, SunMoon, User as UserIcon } from 'lucide-react'
import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Skeleton } from '../components/common/skeleton'
import { useDashboardContext } from '../context'
import { useDocumentDirection } from '../hooks/use-document-direction'
import { useTheme } from '../providers/theme-provider'

export interface UserMenuProps {
  /** Documentation URL */
  docsUrl?: string
  /** Changelog URL */
  changelogUrl?: string
}

export const UserMenu = ({ docsUrl, changelogUrl }: UserMenuProps) => {
  const location = useLocation()
  const direction = useDocumentDirection()

  const [openMenu, setOpenMenu] = useState(false)

  return (
    <div>
      <DropdownMenu dir={direction} open={openMenu} onOpenChange={setOpenMenu}>
        <UserBadge />
        <DropdownMenu.Content className="min-w-[var(--radix-dropdown-menu-trigger-width)] max-w-[var(--radix-dropdown-menu-trigger-width)]">
          <UserItem />
          <DropdownMenu.Separator />
          <DropdownMenu.Item asChild>
            <Link to="/settings/profile" state={{ from: location.pathname }}>
              <UserIcon className="me-2 h-4 w-4 text-muted-foreground" />
              Profile Settings
            </Link>
          </DropdownMenu.Item>
          {docsUrl && (
            <>
              <DropdownMenu.Separator />
              <DropdownMenu.Item asChild>
                <Link to={docsUrl} target="_blank">
                  <BookOpen className="me-2 h-4 w-4 text-muted-foreground" />
                  Documentation
                </Link>
              </DropdownMenu.Item>
            </>
          )}
          {changelogUrl && (
            <DropdownMenu.Item asChild>
              <Link to={changelogUrl} target="_blank">
                <ScrollText className="me-2 h-4 w-4 text-muted-foreground" />
                Changelog
              </Link>
            </DropdownMenu.Item>
          )}
          <DropdownMenu.Separator />
          <ThemeToggle />
          <DropdownMenu.Separator />
          <Logout />
        </DropdownMenu.Content>
      </DropdownMenu>
    </div>
  )
}

const UserBadge = () => {
  const { authAdapter } = useDashboardContext()
  const {
    data: user,
    isPending,
    isError,
    error,
  } = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () => authAdapter.getCurrentUser(),
  })

  const name = [user?.first_name, user?.last_name].filter(Boolean).join(' ')
  const displayName = name || user?.email

  const fallback = displayName ? displayName[0].toUpperCase() : null

  if (isPending) {
    return (
      <button className="flex max-w-[192px] select-none items-center gap-x-2 overflow-hidden text-ellipsis whitespace-nowrap rounded-full border py-1 ps-1 pe-2.5 shadow-sm">
        <Skeleton className="h-5 w-5 rounded-full" />
        <Skeleton className="h-[9px] w-[70px]" />
      </button>
    )
  }

  if (isError) {
    throw error
  }

  return (
    <div className="p-3">
      <DropdownMenu.Trigger
        disabled={!user}
        className={cn(
          'grid w-full cursor-pointer grid-cols-[24px_1fr_15px] items-center gap-2 rounded-md py-1 ps-0.5 pe-2 outline-none',
          'hover:bg-card/60',
          'data-[state=open]:bg-card/60',
          'focus-visible:ring-2 focus-visible:ring-ring',
        )}
      >
        <div className="flex size-6 items-center justify-center">
          {fallback ? <Avatar size="xsmall" fallback={fallback} /> : <Skeleton className="h-6 w-6 rounded-full" />}
        </div>
        <div className="flex items-center overflow-hidden">
          {displayName ? (
            <span className="truncate text-xs font-medium">{displayName}</span>
          ) : (
            <Skeleton className="h-[9px] w-[70px]" />
          )}
        </div>
        <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
      </DropdownMenu.Trigger>
    </div>
  )
}

const ThemeToggle = () => {
  const { theme, setTheme } = useTheme()

  return (
    <DropdownMenu.SubMenu>
      <DropdownMenu.SubMenuTrigger dir="ltr" className="rounded-md rtl:rotate-180">
        <SunMoon className="me-2 h-4 w-4 text-muted-foreground" />
        <span className="rtl:rotate-180">Theme</span>
      </DropdownMenu.SubMenuTrigger>
      <DropdownMenu.SubMenuContent>
        <DropdownMenu.RadioGroup value={theme}>
          <DropdownMenu.RadioItem
            value="system"
            onClick={(e) => {
              e.preventDefault()
              setTheme('system')
            }}
          >
            System
          </DropdownMenu.RadioItem>
          <DropdownMenu.RadioItem
            value="light"
            onClick={(e) => {
              e.preventDefault()
              setTheme('light')
            }}
          >
            Light
          </DropdownMenu.RadioItem>
          <DropdownMenu.RadioItem
            value="dark"
            onClick={(e) => {
              e.preventDefault()
              setTheme('dark')
            }}
          >
            Dark
          </DropdownMenu.RadioItem>
        </DropdownMenu.RadioGroup>
      </DropdownMenu.SubMenuContent>
    </DropdownMenu.SubMenu>
  )
}

const Logout = () => {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { authAdapter } = useDashboardContext()

  const handleLogout = async () => {
    await authAdapter.logout()
    queryClient.clear()
    navigate('/login')
  }

  return (
    <DropdownMenu.Item onClick={handleLogout}>
      <div className="flex items-center gap-x-2">
        <ExternalLink className="h-4 w-4 text-muted-foreground" />
        <span>Log out</span>
      </div>
    </DropdownMenu.Item>
  )
}

const UserItem = () => {
  const { authAdapter } = useDashboardContext()
  const {
    data: user,
    isPending,
    isError,
    error,
  } = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () => authAdapter.getCurrentUser(),
  })

  const loaded = !isPending && !!user

  if (!loaded) {
    return <div></div>
  }

  const name = [user.first_name, user.last_name].filter(Boolean).join(' ')
  const email = user.email
  const fallback = name ? name[0].toUpperCase() : email[0].toUpperCase()
  const avatar = user.avatar_url

  if (isError) {
    throw error
  }

  return (
    <div className="flex items-center gap-x-3 overflow-hidden px-2 py-1">
      <Avatar size="small" variant="rounded" src={avatar || undefined} fallback={fallback} />
      <div className="block w-full min-w-0 max-w-[187px] overflow-hidden whitespace-nowrap">
        <span className="overflow-hidden text-ellipsis whitespace-nowrap text-sm font-medium">{name || email}</span>
        {!!name && (
          <span className="overflow-hidden text-ellipsis whitespace-nowrap text-xs text-muted-foreground block">
            {email}
          </span>
        )}
      </div>
    </div>
  )
}
