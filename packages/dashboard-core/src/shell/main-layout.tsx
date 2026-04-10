import { cn, Divider } from '@manta/ui'
import { LayoutGrid, Search, Settings, Sparkles } from 'lucide-react'
import { type ReactNode, useEffect, useMemo } from 'react'
import { useLocation } from 'react-router-dom'
import { useDashboardContext } from '../context'
import type { NavigationItem as NavOverrideItem } from '../interfaces/override-store'
import { useExtension } from '../providers/extension-provider'
import { useSearch } from '../providers/search-provider'
import { type INavItem, NavItem } from './nav-item'
import { Shell } from './shell'

// ──────────────────────────────────────────────
// Props — navigation, header, user are injected by distribution
// ──────────────────────────────────────────────

export interface MainLayoutProps {
  /** Static navigation items (from distribution) */
  navigation: Omit<INavItem, 'pathname'>[]
  /** Header component (store selector + logout) */
  headerSlot?: ReactNode
  /** User menu component */
  userMenuSlot?: ReactNode
  /** Icon map for navigation override rendering */
  iconMap?: Record<string, React.ReactElement>
}

export const MainLayout = ({ navigation, headerSlot, userMenuSlot, iconMap }: MainLayoutProps) => {
  const { setDefaultNavigation } = useDashboardContext()

  // Memoize the serialized navigation so the effect doesn't fire on every render
  const serializedNav = useMemo(
    () =>
      navigation.map((item) => ({
        key: item.to,
        label: item.label,
        icon:
          (((item.icon as React.ReactElement)?.type as { name?: string } | undefined)?.name as string | undefined) ||
          'LayoutGrid',
        path: item.to,
        items: item.items?.map((child: { label: string; to: string }) => ({
          key: child.to,
          label: child.label,
          path: child.to,
        })),
      })),
    [navigation],
  )

  // Store default navigation so the AI chat can read it
  useEffect(() => {
    setDefaultNavigation(serializedNav)
  }, [serializedNav, setDefaultNavigation])

  return (
    <Shell>
      <MainSidebar navigation={navigation} headerSlot={headerSlot} userMenuSlot={userMenuSlot} iconMap={iconMap} />
    </Shell>
  )
}

const MainSidebar = ({ navigation, headerSlot, userMenuSlot, iconMap }: MainLayoutProps) => {
  return (
    <aside className="flex flex-1 flex-col justify-between overflow-y-auto">
      <div className="flex flex-1 flex-col">
        <div className="sticky top-0 border-b border-border" style={{ height: 49 }}>
          {headerSlot}
        </div>
        <div className="flex flex-1 flex-col justify-between">
          <div className="flex flex-1 flex-col">
            <CoreRouteSection navigation={navigation} iconMap={iconMap} />
            <CustomPagesSection />
            <ExtensionRouteSection />
          </div>
          <UtilitySection />
        </div>
        <div className="sticky bottom-0">{userMenuSlot ?? null}</div>
      </div>
    </aside>
  )
}

const DEFAULT_ICON_MAP: Record<string, React.ReactElement> = {
  LayoutGrid: <LayoutGrid className="h-4 w-4" />,
  SquaresPlus: <LayoutGrid className="h-4 w-4" />,
  Settings: <Settings className="h-4 w-4" />,
  CogSixTooth: <Settings className="h-4 w-4" />,
  Sparkles: <Sparkles className="h-4 w-4" />,
}

const Searchbar = () => {
  const { toggleSearch } = useSearch()

  return (
    <div className="px-3">
      <button
        onClick={toggleSearch}
        className={cn(
          'flex w-full items-center gap-x-2.5 rounded-md px-2 py-1 outline-none bg-muted text-muted-foreground',
          'hover:bg-accent',
          'focus-visible:ring-2 focus-visible:ring-ring',
        )}
      >
        <Search className="h-4 w-4" />
        <div className="flex-1 text-start">
          <span className="text-sm font-medium">Search</span>
        </div>
        <span className="text-sm text-muted-foreground">⌘K</span>
      </button>
    </div>
  )
}

const CoreRouteSection = ({
  navigation,
  iconMap,
}: {
  navigation: Omit<INavItem, 'pathname'>[]
  iconMap?: Record<string, React.ReactElement>
}) => {
  const { overrideStore, overridesVersion: _v } = useDashboardContext()
  const navigationOverride = overrideStore.getNavigationOverride()

  const { getMenu } = useExtension()
  const menuItems = getMenu('coreExtensions')

  const mergedIconMap = { ...DEFAULT_ICON_MAP, ...iconMap }

  // If we have a navigation override, render it instead of static routes
  if (navigationOverride) {
    return (
      <nav className="flex flex-col gap-y-1 py-3">
        <Searchbar />
        {navigationOverride.map((item: NavOverrideItem) => (
          <NavItem
            key={item.key}
            to={item.path}
            label={item.label}
            icon={mergedIconMap[item.icon] || <LayoutGrid className="h-4 w-4" />}
            items={item.children?.map((child) => ({
              label: child.label,
              to: child.path,
            }))}
          />
        ))}
      </nav>
    )
  }

  const coreRoutes = [...navigation]
  menuItems.forEach((item) => {
    if (item.nested) {
      const route = coreRoutes.find((route) => route.to === item.nested)
      if (route) {
        route.items?.push(item)
      }
    }
  })

  return (
    <nav className="flex flex-col gap-y-1 py-4">
      <div className="flex flex-col gap-y-1">
        {coreRoutes.map((route) => {
          return <NavItem key={route.to} {...route} />
        })}
      </div>
    </nav>
  )
}

const CustomPagesSection = () => {
  const { overrideStore, overridesVersion: _v } = useDashboardContext()
  const customNavItems = overrideStore.getCustomNavItems()
  const navigationOverride = overrideStore.getNavigationOverride()

  const visibleItems = navigationOverride
    ? customNavItems.filter((item) => {
        const inTopLevel = navigationOverride.some((nav) => nav.key === item.key)
        const inChildren = navigationOverride.some((nav) => nav.children?.some((child) => child.key === item.key))
        return !inTopLevel && !inChildren
      })
    : customNavItems

  if (!visibleItems.length) {
    return null
  }

  return (
    <div>
      <div className="px-3">
        <Divider variant="dashed" />
      </div>
      <div className="flex flex-col gap-y-1 py-3">
        <div className="px-3 pb-1">
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Custom</span>
        </div>
        <nav className="flex flex-col gap-y-0.5">
          {visibleItems.map((item) => (
            <NavItem key={item.key} to={item.path} label={item.label} icon={<Sparkles className="h-4 w-4" />} />
          ))}
        </nav>
      </div>
    </div>
  )
}

const ExtensionRouteSection = () => {
  const { getMenu } = useExtension()

  const menuItems = getMenu('coreExtensions').filter((item) => !item.nested)

  if (!menuItems.length) {
    return null
  }

  return (
    <div>
      <div className="px-3">
        <Divider variant="dashed" />
      </div>
      <div className="flex flex-col gap-y-1 py-3">
        <nav className="flex flex-col gap-y-0.5 py-1 pb-4">
          {menuItems.map((item) => {
            return (
              <NavItem
                key={item.to ?? item.label}
                to={item.to}
                label={item.label}
                icon={item.icon ? <item.icon /> : <LayoutGrid className="h-4 w-4" />}
                items={item.items}
                type="extension"
              />
            )
          })}
        </nav>
      </div>
    </div>
  )
}

const UtilitySection = () => {
  const location = useLocation()

  return (
    <div className="flex flex-col gap-y-0.5 py-3">
      <NavItem label="Settings" to="/settings" from={location.pathname} icon={<Settings className="h-4 w-4" />} />
    </div>
  )
}
