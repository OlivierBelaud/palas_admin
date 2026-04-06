import { cn, IconButton } from '@manta/ui'
import { X } from 'lucide-react'
import { useCallback, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { AiChat } from './ai-chat'
import { MAX_WIDTH, MIN_WIDTH, useAi } from './ai-provider'

// Maximize icon (expand to fullscreen)
const MaximizeIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <path
      d="M6 2H3a1 1 0 0 0-1 1v3M10 2h3a1 1 0 0 1 1 1v3M10 14h3a1 1 0 0 0 1-1v-3M6 14H3a1 1 0 0 1-1-1v-3"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)

// Minimize icon (shrink back to sidebar)
const MinimizeIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <path
      d="M3 6h3V3M13 6h-3V3M13 10h-3v3M3 10h3v3"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)

// Sparkles icon for the topbar button
export const SparklesIcon = ({ className }: { className?: string }) => (
  <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .962 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.582a.5.5 0 0 1 0 .962L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.962 0L9.937 15.5z"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
  </svg>
)

// Trash/reset icon
const TrashIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <path
      d="M2.5 4h11M5.5 4V2.5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1V4M6.5 7v4M9.5 7v4M3.5 4l.5 9a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1l.5-9"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)

/**
 * AiPanel — renders the AI chat in sidebar or fullscreen mode.
 *
 * CRITICAL: AiChat is ALWAYS rendered inside a single portal to preserve
 * the useChat state (including tool invocation parts / rendered components).
 * Switching between sidebar and fullscreen only changes the wrapper CSS —
 * the AiChat component is never unmounted/remounted.
 */
export const AiPanel = () => {
  const { isOpen, isFullscreen, panelWidth, close, setFullscreen, setPanelWidth, clearConversation, conversationKey } =
    useAi()

  if (!isOpen) return null

  // Always render in a portal so AiChat stays in the same React tree
  // regardless of sidebar ↔ fullscreen transitions.
  return createPortal(
    <>
      {/* Overlay — only in fullscreen */}
      {isFullscreen && <div className="fixed inset-0 z-[400] bg-background/60 backdrop-blur-sm" onClick={close} />}

      {/* Panel container — sidebar or fullscreen via CSS */}
      <div
        className={cn(
          'z-[400] flex flex-col overflow-hidden bg-background',
          isFullscreen
            ? 'fixed inset-2 rounded-lg border shadow-lg animate-in fade-in-0 slide-in-from-bottom-2 duration-200'
            : 'fixed right-0 top-0 h-full border-l border-border',
        )}
        style={isFullscreen ? undefined : { width: panelWidth }}
      >
        {/* Header — changes controls based on mode */}
        {isFullscreen ? (
          <FullscreenHeader onClose={close} onMinimize={() => setFullscreen(false)} onClear={clearConversation} />
        ) : (
          <SidebarHeader onClose={close} onMaximize={() => setFullscreen(true)} onClear={clearConversation} />
        )}

        {/* Chat — single instance, never unmounted */}
        <AiChat key={conversationKey} centered={isFullscreen} />
      </div>

      {/* Resize handle — sidebar only */}
      {!isFullscreen && <ResizeHandle width={panelWidth} onResize={setPanelWidth} />}
    </>,
    document.body,
  )
}

// ──────────────────────────────────────────────
// Resize handle (rendered outside the panel for hit area)
// ──────────────────────────────────────────────

const ResizeHandle = ({ width, onResize }: { width: number; onResize: (width: number) => void }) => {
  const isDragging = useRef(false)
  const startX = useRef(0)
  const startWidth = useRef(0)

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      isDragging.current = true
      startX.current = e.clientX
      startWidth.current = width
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
    },
    [width],
  )

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return
      const delta = startX.current - e.clientX
      const newWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startWidth.current + delta))
      onResize(newWidth)
    }

    const handleMouseUp = () => {
      if (isDragging.current) {
        isDragging.current = false
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [onResize])

  return (
    <div
      className="group fixed top-0 z-[401] flex h-full w-3 justify-center"
      style={{ right: width - 6, cursor: 'col-resize' }}
      onMouseDown={handleMouseDown}
    >
      <div className="h-full w-px bg-border" />
    </div>
  )
}

// ──────────────────────────────────────────────
// Headers
// ──────────────────────────────────────────────

const SidebarHeader = ({
  onClose,
  onMaximize,
  onClear,
}: {
  onClose: () => void
  onMaximize: () => void
  onClear: () => void
}) => (
  <div className="flex shrink-0 items-center justify-between border-b border-border p-3">
    <div className="flex items-center gap-x-1.5">
      <SparklesIcon className="text-muted-foreground" />
      <span className="text-sm font-medium text-foreground">AI Assistant</span>
    </div>
    <div className="flex items-center gap-1">
      <IconButton variant="ghost" size="small" onClick={onClear} title="New conversation">
        <TrashIcon />
      </IconButton>
      <IconButton variant="ghost" size="small" onClick={onMaximize}>
        <MaximizeIcon />
      </IconButton>
      <IconButton variant="ghost" size="small" onClick={onClose}>
        <X className="h-4 w-4" />
      </IconButton>
    </div>
  </div>
)

const FullscreenHeader = ({
  onClose,
  onMinimize,
  onClear,
}: {
  onClose: () => void
  onMinimize: () => void
  onClear: () => void
}) => (
  <div className="flex shrink-0 items-center justify-between gap-x-4 border-b border-border px-4 py-2">
    <div className="flex items-center gap-x-2">
      <IconButton variant="ghost" size="small" onClick={onClose}>
        <X className="h-4 w-4" />
      </IconButton>
      <span className="text-sm text-muted-foreground">esc</span>
    </div>
    <span className="text-sm font-medium text-foreground">AI Assistant</span>
    <div className="flex items-center gap-x-2">
      <IconButton variant="ghost" size="small" onClick={onClear} title="New conversation">
        <TrashIcon />
      </IconButton>
      <IconButton variant="ghost" size="small" onClick={onMinimize}>
        <MinimizeIcon />
      </IconButton>
    </div>
  </div>
)
