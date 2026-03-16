import {
  CogSixTooth,
  EllipsisHorizontal,
  MagnifyingGlass,
  OpenRectArrowOut,
  SquaresPlus,
  Sparkles,
} from "@medusajs/icons"
import { Avatar, Divider, DropdownMenu, Text, clx } from "@medusajs/ui"
import { ReactNode, useSyncExternalStore } from "react"
import { Link, useLocation, useNavigate } from "react-router-dom"
import { getOverrideStore, subscribe, getOverridesVersion } from "../globals"
import { useExtension } from "../providers/extension-provider"
import { useSearch } from "../providers/search-provider"
import { useDocumentDirection } from "../hooks/use-document-direction"
import { Skeleton } from "../components/common/skeleton"
import { NavItem, INavItem } from "./nav-item"
import { Shell } from "./shell"
import type { NavigationItem as NavOverrideItem } from "../interfaces/override-store"

// ──────────────────────────────────────────────
// Props — navigation, header, user are injected by distribution
// ──────────────────────────────────────────────

export interface MainLayoutProps {
  /** Static navigation items (from distribution) */
  navigation: Omit<INavItem, "pathname">[]
  /** Header component (store selector + logout) */
  headerSlot?: ReactNode
  /** User menu component */
  userMenuSlot?: ReactNode
  /** Icon map for navigation override rendering */
  iconMap?: Record<string, React.ReactElement>
}

export const MainLayout = ({ navigation, headerSlot, userMenuSlot, iconMap }: MainLayoutProps) => {
  return (
    <Shell>
      <MainSidebar
        navigation={navigation}
        headerSlot={headerSlot}
        userMenuSlot={userMenuSlot}
        iconMap={iconMap}
      />
    </Shell>
  )
}

const MainSidebar = ({ navigation, headerSlot, userMenuSlot, iconMap }: MainLayoutProps) => {
  return (
    <aside className="flex flex-1 flex-col justify-between overflow-y-auto">
      <div className="flex flex-1 flex-col">
        <div className="bg-ui-bg-subtle sticky top-0">
          {headerSlot}
          <div className="px-3">
            <Divider variant="dashed" />
          </div>
        </div>
        <div className="flex flex-1 flex-col justify-between">
          <div className="flex flex-1 flex-col">
            <CoreRouteSection navigation={navigation} iconMap={iconMap} />
            <CustomPagesSection />
            <ExtensionRouteSection />
          </div>
          <UtilitySection />
        </div>
        <div className="bg-ui-bg-subtle sticky bottom-0">
          {userMenuSlot ? (
            <div>
              <div className="px-3">
                <Divider variant="dashed" />
              </div>
              {userMenuSlot}
            </div>
          ) : null}
        </div>
      </div>
    </aside>
  )
}

const DEFAULT_ICON_MAP: Record<string, React.ReactElement> = {
  SquaresPlus: <SquaresPlus />,
  CogSixTooth: <CogSixTooth />,
  Sparkles: <Sparkles />,
}

const Searchbar = () => {
  const { toggleSearch } = useSearch()

  return (
    <div className="px-3">
      <button
        onClick={toggleSearch}
        className={clx(
          "bg-ui-bg-subtle text-ui-fg-subtle flex w-full items-center gap-x-2.5 rounded-md px-2 py-1 outline-none",
          "hover:bg-ui-bg-subtle-hover",
          "focus-visible:shadow-borders-focus"
        )}
      >
        <MagnifyingGlass />
        <div className="flex-1 text-start">
          <Text size="small" leading="compact" weight="plus">
            Search
          </Text>
        </div>
        <Text size="small" leading="compact" className="text-ui-fg-muted">
          ⌘K
        </Text>
      </button>
    </div>
  )
}

const CoreRouteSection = ({
  navigation,
  iconMap,
}: {
  navigation: Omit<INavItem, "pathname">[]
  iconMap?: Record<string, React.ReactElement>
}) => {
  const overrideStore = getOverrideStore()
  const _v = useSyncExternalStore(subscribe, getOverridesVersion)
  const navigationOverride = overrideStore.getNavigationOverride()

  const { getMenu } = useExtension()
  const menuItems = getMenu("coreExtensions")

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
            icon={mergedIconMap[item.icon] || <SquaresPlus />}
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
    <nav className="flex flex-col gap-y-1 py-3">
      <Searchbar />
      {coreRoutes.map((route) => {
        return <NavItem key={route.to} {...route} />
      })}
    </nav>
  )
}

const CustomPagesSection = () => {
  const overrideStore = getOverrideStore()
  const _v = useSyncExternalStore(subscribe, getOverridesVersion)
  const customNavItems = overrideStore.getCustomNavItems()
  const navigationOverride = overrideStore.getNavigationOverride()

  const visibleItems = navigationOverride
    ? customNavItems.filter((item) => {
        const inTopLevel = navigationOverride.some((nav) => nav.key === item.key)
        const inChildren = navigationOverride.some(
          (nav) => nav.children?.some((child) => child.key === item.key)
        )
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
          <Text size="xsmall" leading="compact" weight="plus" className="text-ui-fg-muted uppercase tracking-wider">
            Custom
          </Text>
        </div>
        <nav className="flex flex-col gap-y-0.5">
          {visibleItems.map((item) => (
            <NavItem
              key={item.key}
              to={item.path}
              label={item.label}
              icon={<Sparkles />}
            />
          ))}
        </nav>
      </div>
    </div>
  )
}

const ExtensionRouteSection = () => {
  const { getMenu } = useExtension()

  const menuItems = getMenu("coreExtensions").filter((item) => !item.nested)

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
          {menuItems.map((item, i) => {
            return (
              <NavItem
                key={i}
                to={item.to}
                label={item.label}
                icon={item.icon ? <item.icon /> : <SquaresPlus />}
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
      <NavItem
        label="Settings"
        to="/settings"
        from={location.pathname}
        icon={<CogSixTooth />}
      />
    </div>
  )
}
