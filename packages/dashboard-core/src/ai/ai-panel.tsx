import { IconButton, clx } from "@medusajs/ui"
import { XMark } from "@medusajs/icons"
import { createPortal } from "react-dom"
import { useCallback, useEffect, useRef } from "react"
import { useAi, MIN_WIDTH, MAX_WIDTH } from "./ai-provider"
import { AiChat } from "./ai-chat"

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
  <svg
    className={className}
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
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

export const AiPanel = () => {
  const { isOpen, isFullscreen, panelWidth, close, setFullscreen, setPanelWidth, clearConversation, conversationKey } = useAi()

  if (!isOpen) return null

  // Fullscreen modal — matches Medusa FocusModal: fixed inset-2
  if (isFullscreen) {
    return createPortal(
      <>
        {/* Overlay */}
        <div
          className="bg-ui-bg-overlay fixed inset-0 z-[400]"
          onClick={close}
        />
        {/* Modal */}
        <div
          className={clx(
            "bg-ui-bg-base shadow-elevation-modal fixed inset-2 z-[400] flex flex-col overflow-hidden rounded-lg border outline-none",
            "animate-in fade-in-0 slide-in-from-bottom-2 duration-200"
          )}
        >
          <FullscreenHeader
            onClose={close}
            onMinimize={() => setFullscreen(false)}
            onClear={clearConversation}
          />
          <AiChat key={conversationKey} centered />
        </div>
      </>,
      document.body
    )
  }

  // Sidebar panel — full height, with resize handle
  return (
    <ResizablePanel width={panelWidth} onResize={setPanelWidth}>
      <SidebarHeader
        onClose={close}
        onMaximize={() => setFullscreen(true)}
        onClear={clearConversation}
      />
      <AiChat key={conversationKey} />
    </ResizablePanel>
  )
}

// ──────────────────────────────────────────────
// Resizable panel wrapper
// ──────────────────────────────────────────────

const ResizablePanel = ({
  width,
  onResize,
  children,
}: {
  width: number
  onResize: (width: number) => void
  children: React.ReactNode
}) => {
  const isDragging = useRef(false)
  const startX = useRef(0)
  const startWidth = useRef(0)

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      isDragging.current = true
      startX.current = e.clientX
      startWidth.current = width
      document.body.style.cursor = "col-resize"
      document.body.style.userSelect = "none"
    },
    [width]
  )

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return
      // Dragging left = making panel wider (panel is on the right)
      const delta = startX.current - e.clientX
      const newWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startWidth.current + delta))
      onResize(newWidth)
    }

    const handleMouseUp = () => {
      if (isDragging.current) {
        isDragging.current = false
        document.body.style.cursor = ""
        document.body.style.userSelect = ""
      }
    }

    window.addEventListener("mousemove", handleMouseMove)
    window.addEventListener("mouseup", handleMouseUp)
    return () => {
      window.removeEventListener("mousemove", handleMouseMove)
      window.removeEventListener("mouseup", handleMouseUp)
    }
  }, [onResize])

  return (
    <div
      className="bg-ui-bg-base border-ui-border-base relative flex h-full shrink-0 flex-col border-l"
      style={{ width }}
    >
      {/* Resize handle — wide hit area (12px), thin visible line on hover */}
      <div
        className="group absolute -left-1.5 top-0 z-10 flex h-full w-3 justify-center"
        style={{ cursor: "col-resize" }}
        onMouseDown={handleMouseDown}
      >
        <div className="h-full w-0.5 transition-colors group-hover:bg-ui-fg-interactive group-active:bg-ui-fg-interactive" />
      </div>
      {/* Content */}
      <div className="flex h-full flex-1 flex-col overflow-hidden">
        {children}
      </div>
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
  // p-3 matches the shell Topbar padding exactly — shrink-0 keeps it fixed
  <div className="border-ui-border-base flex shrink-0 items-center justify-between border-b p-3">
    <div className="flex items-center gap-x-1.5">
      <SparklesIcon className="text-ui-fg-muted" />
      <span className="txt-compact-medium-plus text-ui-fg-base">
        AI Assistant
      </span>
    </div>
    <div className="flex items-center gap-1">
      <IconButton variant="transparent" size="small" onClick={onClear} title="New conversation">
        <TrashIcon />
      </IconButton>
      <IconButton variant="transparent" size="small" onClick={onMaximize}>
        <MaximizeIcon />
      </IconButton>
      <IconButton variant="transparent" size="small" onClick={onClose}>
        <XMark />
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
  <div className="border-ui-border-base flex shrink-0 items-center justify-between gap-x-4 border-b px-4 py-2">
    <div className="flex items-center gap-x-2">
      <IconButton variant="transparent" size="small" onClick={onClose}>
        <XMark />
      </IconButton>
      <span className="text-ui-fg-muted txt-compact-small">esc</span>
    </div>
    <span className="txt-compact-medium-plus text-ui-fg-base">
      AI Assistant
    </span>
    <div className="flex items-center gap-x-2">
      <IconButton variant="transparent" size="small" onClick={onClear} title="New conversation">
        <TrashIcon />
      </IconButton>
      <IconButton variant="transparent" size="small" onClick={onMinimize}>
        <MinimizeIcon />
      </IconButton>
    </div>
  </div>
)
