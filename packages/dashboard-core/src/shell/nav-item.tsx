import { cn } from '@manta/ui'
import { Collapsible as RadixCollapsible } from 'radix-ui'
import { type PropsWithChildren, type ReactNode, useCallback, useEffect, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { ConditionalTooltip } from '../components/common/conditional-tooltip'

type ItemType = 'core' | 'extension' | 'setting'

type NestedItemProps = {
  label: string
  to: string
}

export type INavItem = {
  icon?: ReactNode
  label: string
  to: string
  items?: NestedItemProps[]
  type?: ItemType
  from?: string
  nested?: string
}

const BASE_NAV_LINK_CLASSES =
  'relative flex items-center gap-x-2 rounded-md py-1 pl-0.5 pr-2 outline-none text-muted-foreground transition-colors hover:bg-card/60 [&>svg]:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring truncate'
const ACTIVE_NAV_LINK_CLASSES = 'bg-card text-foreground font-semibold shadow-sm rounded-md hover:bg-card'
const NESTED_NAV_LINK_CLASSES = 'pl-[42px] pr-3 py-1.5 w-full text-muted-foreground truncate'
const SETTING_NAV_LINK_CLASSES = 'pl-3 py-1.5'

const getIsOpen = (to: string, items: NestedItemProps[] | undefined, pathname: string) => {
  return [to, ...(items?.map((i) => i.to) ?? [])].some((p) => pathname === p || pathname.startsWith(p + '/'))
}

const NavItemTooltip = ({ children }: PropsWithChildren<{ to: string }>) => {
  return <div className="w-full">{children}</div>
}

export const NavItem = ({ icon, label, to, items, type = 'core', from }: INavItem) => {
  const { pathname } = useLocation()
  const [open, setOpen] = useState(getIsOpen(to, items, pathname))

  useEffect(() => {
    setOpen(getIsOpen(to, items, pathname))
  }, [pathname, to, items])

  const navLinkClassNames = useCallback(
    ({
      to,
      isActive,
      isNested = false,
      isSetting = false,
    }: {
      to: string
      isActive: boolean
      isNested?: boolean
      isSetting?: boolean
    }) => {
      if (['core', 'setting'].includes(type)) {
        // Match exact path or nested path (segment-level, not string prefix)
        // e.g. /customer-groups matches /customer-groups and /customer-groups/123
        // but NOT /customer-groups-analysis
        isActive = pathname === to || pathname.startsWith(to + '/')
      }

      return cn(BASE_NAV_LINK_CLASSES, {
        [NESTED_NAV_LINK_CLASSES]: isNested,
        [ACTIVE_NAV_LINK_CLASSES]: isActive,
        [SETTING_NAV_LINK_CLASSES]: isSetting,
      })
    },
    [type, pathname],
  )

  const isSetting = type === 'setting'

  return (
    <div className="px-3">
      <NavItemTooltip to={to}>
        <NavLink
          to={to}
          end={items?.some((i) => i.to === pathname)}
          state={
            from
              ? {
                  from,
                }
              : undefined
          }
          className={({ isActive }) => {
            return cn(navLinkClassNames({ isActive, isSetting, to }), {
              'max-lg:hidden': !!items?.length,
            })
          }}
        >
          {type !== 'setting' && (
            <div className="flex size-6 items-center justify-center [&>svg]:h-4 [&>svg]:w-4">
              <Icon icon={icon} type={type} />
            </div>
          )}
          <span className="text-[13px] font-medium">{label}</span>
        </NavLink>
      </NavItemTooltip>
      {items && items.length > 0 && (
        <RadixCollapsible.Root open={open} onOpenChange={setOpen}>
          <RadixCollapsible.Trigger
            className={cn(
              'flex w-full items-center gap-x-2 rounded-md py-0.5 pl-0.5 pr-2 outline-none text-muted-foreground hover:text-foreground transition-colors hover:bg-accent lg:hidden',
              { 'pl-2': isSetting },
            )}
          >
            <div className="flex size-6 items-center justify-center">
              <Icon icon={icon} type={type} />
            </div>
            <span className="text-sm font-medium">{label}</span>
          </RadixCollapsible.Trigger>
          <RadixCollapsible.Content>
            <div className="flex flex-col gap-y-0.5 pb-2 pt-0.5">
              <ul className="flex flex-col gap-y-0.5">
                <li className="flex w-full items-center gap-x-1 lg:hidden">
                  <NavItemTooltip to={to}>
                    <NavLink
                      to={to}
                      end
                      className={({ isActive }) => {
                        return cn(
                          navLinkClassNames({
                            to,
                            isActive,
                            isSetting,
                            isNested: true,
                          }),
                        )
                      }}
                    >
                      <span className="text-sm font-medium">{label}</span>
                    </NavLink>
                  </NavItemTooltip>
                </li>
                {items.map((item) => {
                  return (
                    <li key={item.to} className="flex h-7 items-center">
                      <NavItemTooltip to={item.to}>
                        <NavLink
                          to={item.to}
                          end
                          className={({ isActive }) => {
                            return cn(
                              navLinkClassNames({
                                to: item.to,
                                isActive,
                                isSetting,
                                isNested: true,
                              }),
                            )
                          }}
                        >
                          <span className="text-sm font-medium">{item.label}</span>
                        </NavLink>
                      </NavItemTooltip>
                    </li>
                  )
                })}
              </ul>
            </div>
          </RadixCollapsible.Content>
        </RadixCollapsible.Root>
      )}
    </div>
  )
}

const Icon = ({ icon, type }: { icon?: ReactNode; type: ItemType }) => {
  if (!icon) {
    return null
  }

  return type === 'extension' ? (
    <div className="flex h-5 w-5 items-center justify-center rounded-[4px] border bg-card shadow-sm">
      <div className="h-[15px] w-[15px] overflow-hidden rounded-sm">{icon}</div>
    </div>
  ) : (
    icon
  )
}
