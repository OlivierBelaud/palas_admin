import { cn, IconButton } from '@manta/ui'
import { ChevronRight, PanelLeft, X } from 'lucide-react'
import { AnimatePresence } from 'motion/react'
import { Dialog as RadixDialog } from 'radix-ui'
import { type PropsWithChildren, type ReactNode, useEffect, useState } from 'react'
import { Link, Outlet, type UIMatch, useMatches, useNavigation } from 'react-router-dom'
import { AiPanel, SparklesIcon, useAi } from '../ai'
import { ProgressBar } from '../components/common/progress-bar'
import { useDashboardContext } from '../context'
import { useSidebar } from '../providers/sidebar-provider'

export const Shell = ({ children }: PropsWithChildren) => {
  const navigation = useNavigation()
  const loading = navigation.state === 'loading'
  const { isOpen, isFullscreen, panelWidth } = useAi()

  // Push content when AI sidebar is open (not in fullscreen — fullscreen floats)
  const pushRight = isOpen && !isFullscreen ? panelWidth : 0

  return (
    <div
      className="relative flex h-screen flex-col items-start overflow-hidden transition-[padding] duration-200 lg:flex-row"
      style={{ paddingRight: pushRight }}
    >
      <NavigationBar loading={loading} />
      <div>
        <MobileSidebarContainer>{children}</MobileSidebarContainer>
        <DesktopSidebarContainer>{children}</DesktopSidebarContainer>
      </div>
      <div className="flex h-screen w-full flex-row overflow-hidden">
        <div className="flex flex-1 flex-col overflow-auto">
          <Topbar />
          <main
            className={cn(
              'flex h-full w-full flex-col items-center overflow-y-auto bg-background transition-opacity delay-200 duration-200',
              {
                'opacity-25': loading,
              },
            )}
          >
            <Gutter>
              <Outlet />
            </Gutter>
          </main>
        </div>
      </div>
      <AiPanel />
    </div>
  )
}

const NavigationBar = ({ loading }: { loading: boolean }) => {
  const [showBar, setShowBar] = useState(false)

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>

    if (loading) {
      timeout = setTimeout(() => {
        setShowBar(true)
      }, 200)
    } else {
      setShowBar(false)
    }

    return () => {
      clearTimeout(timeout)
    }
  }, [loading])

  return (
    <div className="fixed inset-x-0 top-0 z-50 h-1">
      <AnimatePresence>{showBar ? <ProgressBar /> : null}</AnimatePresence>
    </div>
  )
}

const Gutter = ({ children }: PropsWithChildren) => {
  return <div className="flex w-full max-w-[1600px] flex-col gap-y-4 px-6 pt-10 pb-6">{children}</div>
}

const Breadcrumbs = () => {
  const matches = useMatches() as unknown as UIMatch<
    unknown,
    {
      breadcrumb?: (match?: UIMatch) => string | ReactNode
    }
  >[]

  const crumbs = matches
    .filter((match) => match.handle?.breadcrumb)
    .map((match) => {
      const handle = match.handle

      let label: string | ReactNode | undefined

      try {
        label = handle.breadcrumb?.(match)
      } catch (_error) {
        // noop
      }

      if (!label) {
        return null
      }

      return {
        label: label,
        path: match.pathname,
      }
    })
    .filter(Boolean) as { label: string | ReactNode; path: string }[]

  return (
    <ol className={cn('flex select-none items-center text-sm font-medium text-muted-foreground')}>
      {crumbs.map((crumb, index) => {
        const isLast = index === crumbs.length - 1
        const isSingle = crumbs.length === 1

        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: breadcrumbs derived from pathname, stable per route
          <li key={index} className={cn('flex items-center')}>
            {!isLast ? (
              <Link className="transition-colors hover:text-muted-foreground" to={crumb.path}>
                {crumb.label}
              </Link>
            ) : (
              <div>
                {!isSingle && <span className="block lg:hidden">...</span>}
                <span
                  className={cn({
                    'hidden lg:block': !isSingle,
                  })}
                >
                  {crumb.label}
                </span>
              </div>
            )}
            {!isLast && (
              <span className="mx-2">
                <ChevronRight className="h-3 w-3 rtl:rotate-180" />
              </span>
            )}
          </li>
        )
      })}
    </ol>
  )
}

const ToggleSidebar = () => {
  const { toggle } = useSidebar()

  return (
    <div>
      <IconButton className="hidden lg:flex" variant="ghost" onClick={() => toggle('desktop')} size="small">
        <PanelLeft className="h-4 w-4 text-muted-foreground rtl:rotate-180" />
      </IconButton>
      <IconButton className="hidden max-lg:flex" variant="ghost" onClick={() => toggle('mobile')} size="small">
        <PanelLeft className="h-4 w-4 text-muted-foreground rtl:rotate-180" />
      </IconButton>
    </div>
  )
}

const AiToggleButton = () => {
  const { toggle, isOpen } = useAi()
  const { aiEnabled } = useDashboardContext()
  if (!aiEnabled || isOpen) return null
  return (
    <IconButton variant="ghost" onClick={toggle}>
      <SparklesIcon className="h-4 w-4" />
    </IconButton>
  )
}

const Topbar = () => {
  return (
    <div
      className="grid shrink-0 w-full grid-cols-2 items-center border-b border-border bg-card px-3"
      style={{ height: 49 }}
    >
      <div className="flex items-center gap-x-1.5">
        <ToggleSidebar />
        <Breadcrumbs />
      </div>
      <div className="flex items-center justify-end gap-x-3">
        <AiToggleButton />
      </div>
    </div>
  )
}

const DesktopSidebarContainer = ({ children }: PropsWithChildren) => {
  const { desktop } = useSidebar()

  return (
    <div
      className={cn('hidden h-screen w-[240px] border-e border-border bg-background', {
        'lg:flex': desktop,
      })}
    >
      {children}
    </div>
  )
}

const MobileSidebarContainer = ({ children }: PropsWithChildren) => {
  const { mobile, toggle } = useSidebar()

  return (
    <RadixDialog.Root open={mobile} onOpenChange={() => toggle('mobile')}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay
          className={cn(
            'fixed inset-0 bg-black/80',
            'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
          )}
        />
        <RadixDialog.Content
          className={cn(
            'fixed inset-y-2 start-2 flex w-full max-w-[304px] flex-col overflow-hidden rounded-lg border-r bg-muted shadow-lg',
            'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:slide-out-to-start-1/2 data-[state=open]:slide-in-from-start-1/2 duration-200',
          )}
        >
          <div className="p-3">
            <RadixDialog.Close asChild>
              <IconButton size="small" variant="ghost" className="text-muted-foreground">
                <X className="h-4 w-4" />
              </IconButton>
            </RadixDialog.Close>
            <RadixDialog.Title className="sr-only">Navigation</RadixDialog.Title>
            <RadixDialog.Description className="sr-only">Main navigation sidebar</RadixDialog.Description>
          </div>
          {children}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  )
}
