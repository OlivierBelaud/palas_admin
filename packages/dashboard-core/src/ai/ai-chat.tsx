import { useChat } from "@ai-sdk/react"
import { useRef, useEffect } from "react"
import { IconButton, clx, toast } from "@medusajs/ui"
import { useDashboardContext } from "../context"
import { useAi, type StoredMessage } from "./ai-provider"
import { getRenderer } from "../renderers/index"
import { useNavigate } from "react-router-dom"
import { usePageContext } from "./use-page-context"
import type { DataComponent } from "../pages/types"

// Arrow-up send icon
const SendIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M8 13V3M8 3L3 8M8 3L13 8"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)

export const AiChat = ({ centered = false }: { centered?: boolean }) => {
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const { storedMessages, setStoredMessages } = useAi()
  const { dataSource, overrideStore } = useDashboardContext()
  const pageContext = usePageContext()
  const navigate = useNavigate()

  // Track which tool invocations we've already applied (by toolCallId)
  const appliedOverrides = useRef(new Set<string>())

  const baseUrl = dataSource.baseUrl === "/" ? "" : dataSource.baseUrl

  const { messages, input, handleInputChange, handleSubmit, isLoading, error } =
    useChat({
      api: `${baseUrl}/admin/ai/chat`,
      initialMessages: storedMessages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
      })),
      experimental_prepareRequestBody: ({ messages: msgs }) => {
        // Send current page context + list of custom pages so the AI knows what exists
        const customPagesMap = overrideStore.getCustomPages()
        const customNavs = overrideStore.getCustomNavItems()
        const customPagesContext = Object.keys(customPagesMap).length > 0
          ? { customPages: customNavs.map((n) => ({ pageId: n.key, label: n.label, path: n.path })) }
          : undefined
        // Send current navigation state for get_navigation tool
        const navOverride = overrideStore.getNavigationOverride()
        return {
          messages: msgs,
          ...(pageContext ? { pageContext } : {}),
          ...(customPagesContext || {}),
          ...(navOverride ? { navigationOverride: navOverride } : {}),
        }
      },
      // System prompt is handled server-side in /admin/ai/chat
      fetch: (url, options) =>
        fetch(url, { ...options, credentials: "include" }),
    })

  // Persist messages to localStorage when they change
  useEffect(() => {
    if (messages.length > 0) {
      const toStore: StoredMessage[] = messages.map((m) => ({
        id: m.id,
        role: m.role as "user" | "assistant",
        content: m.content,
      }))
      setStoredMessages(toStore)
    }
  }, [messages, setStoredMessages])

  // Apply modify_component / modify_page overrides from tool results
  useEffect(() => {
    for (const message of messages) {
      if (message.role !== "assistant") continue
      const parts = (message as any).parts || []
      for (const part of parts) {
        if (part.type !== "tool-invocation" || part.toolInvocation?.state !== "result") continue
        const inv = part.toolInvocation
        const callId = inv.toolCallId
        if (appliedOverrides.current.has(callId)) continue

        if (inv.toolName === "modify_component" && inv.result?.__modifyComponent) {
          const { componentId, component, reason } = inv.result
          overrideStore.setComponentOverride(componentId, component)
          appliedOverrides.current.add(callId)
          toast.success("Page updated", { description: reason })
        } else if (inv.toolName === "modify_page" && inv.result?.__modifyPage) {
          const { pageId, page, reason } = inv.result
          overrideStore.setPageOverride(pageId, page)
          appliedOverrides.current.add(callId)
          toast.success("Page updated", { description: reason })
        } else if (inv.toolName === "create_page" && inv.result?.__createPage) {
          const { page, components, navItem } = inv.result
          overrideStore.addCustomPage(page, components, navItem)
          appliedOverrides.current.add(callId)
          toast.success("Page created", { description: `"${navItem.label}" has been added to the navigation` })
          // Navigate to the new page
          navigate(page.route)
        } else if (inv.toolName === "delete_page" && inv.result?.__deletePage) {
          const { pageId } = inv.result
          overrideStore.removeCustomPage(pageId)
          appliedOverrides.current.add(callId)
          toast.success("Page deleted", { description: `"${pageId}" has been removed` })
          // If currently on the deleted page, redirect to orders
          if (window.location.pathname.includes(pageId)) {
            navigate("/orders")
          }
        } else if (inv.toolName === "reset_component" && inv.result?.__resetComponent) {
          const { componentId } = inv.result
          overrideStore.removeComponentOverride(componentId)
          appliedOverrides.current.add(callId)
          toast.success("Component reset", { description: `"${componentId}" restored to default` })
        } else if (inv.toolName === "update_custom_page" && inv.result?.__updateCustomPage) {
          const { pageId, updates, reason } = inv.result
          overrideStore.updateCustomPage(pageId, updates)
          appliedOverrides.current.add(callId)
          toast.success("Page updated", { description: reason })
          // If route changed and we're on the old route, navigate to the new one
          if (updates.route && window.location.pathname !== updates.route) {
            navigate(updates.route)
          }
        } else if (inv.toolName === "set_navigation" && inv.result?.__setNavigation) {
          const { navigation, reason } = inv.result
          overrideStore.setNavigationOverride(navigation)
          appliedOverrides.current.add(callId)
          toast.success("Navigation updated", { description: reason })
        } else if (inv.toolName === "reset_navigation" && inv.result?.__resetNavigation) {
          overrideStore.resetNavigationOverride()
          appliedOverrides.current.add(callId)
          toast.success("Navigation reset", { description: "Default menu restored" })
        } else if (inv.toolName === "get_navigation" && inv.result?.__getNavigation) {
          // get_navigation is read-only, just mark as applied
          appliedOverrides.current.add(callId)
        }
      }
    }
  }, [messages])

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Handle Enter to submit, Shift+Enter for newline
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      if (input.trim()) {
        handleSubmit(e as unknown as React.FormEvent<HTMLFormElement>)
      }
    }
  }

  const containerClass = centered ? "mx-auto w-full max-w-[720px]" : ""

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Messages area */}
      <div
        className={clx(
          "flex flex-1 flex-col overflow-y-auto",
          centered ? "items-center px-4 py-16" : "px-4 py-3"
        )}
      >
        <div
          className={clx("w-full flex-1", containerClass, {
            "flex items-center justify-center": messages.length === 0,
          })}
        >
          {messages.length === 0 && (
            <div className="text-ui-fg-muted text-center">
              <SparklesIcon className="mx-auto mb-3 h-8 w-8 opacity-40" />
              <p className="txt-compact-medium">How can I help?</p>
              <p className="txt-compact-small mt-1 opacity-60">
                Ask anything about your store data
              </p>
            </div>
          )}

          {messages.map((message) => (
            <div
              key={message.id}
              className={clx("mb-4", {
                "flex justify-end": message.role === "user",
              })}
            >
              {message.role === "user" ? (
                <div className="bg-ui-bg-field shadow-borders-base max-w-[85%] rounded-xl rounded-br-sm px-3 py-2">
                  <p className="txt-compact-small whitespace-pre-wrap">
                    {message.content}
                  </p>
                </div>
              ) : (
                <div className={centered ? "max-w-full" : "max-w-[95%]"}>
                  <AssistantMessage message={message} />
                </div>
              )}
            </div>
          ))}

          {isLoading && !hasVisibleContent(messages[messages.length - 1]) && (
            <div className="mb-4">
              <div className="flex items-center gap-1.5">
                <div className="bg-ui-fg-muted h-1.5 w-1.5 animate-pulse rounded-full" />
                <div className="bg-ui-fg-muted h-1.5 w-1.5 animate-pulse rounded-full [animation-delay:150ms]" />
                <div className="bg-ui-fg-muted h-1.5 w-1.5 animate-pulse rounded-full [animation-delay:300ms]" />
              </div>
            </div>
          )}

          {error && (
            <div className="bg-ui-bg-subtle-hover text-ui-fg-error mb-4 rounded-lg px-3 py-2">
              <p className="txt-compact-small">
                Error: {error.message || "Failed to get response"}
              </p>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input area */}
      <div
        className={clx(
          "border-ui-border-base shrink-0 border-t",
          centered ? "flex justify-center px-4 py-4" : "px-3 py-3"
        )}
      >
        <form
          onSubmit={handleSubmit}
          className={clx("flex items-end gap-x-2", containerClass)}
        >
          <textarea
            ref={inputRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="Ask about your store..."
            rows={1}
            className={clx(
              // Medusa Input base styles
              "caret-ui-fg-base bg-ui-bg-field hover:bg-ui-bg-field-hover shadow-borders-base",
              "placeholder-ui-fg-muted text-ui-fg-base transition-fg",
              "w-full appearance-none rounded-md outline-none",
              "focus-visible:shadow-borders-interactive-with-active",
              // Size: match Medusa h-8 base input
              "txt-compact-small min-h-8 flex-1 resize-none px-2 py-1.5",
              "max-h-[120px]"
            )}
            style={{ height: "auto", fieldSizing: "content" } as React.CSSProperties}
            onInput={(e) => {
              const target = e.target as HTMLTextAreaElement
              target.style.height = "auto"
              target.style.height = Math.min(target.scrollHeight, 120) + "px"
            }}
          />
          <IconButton
            type="submit"
            variant="primary"
            size="base"
            disabled={!input.trim() || isLoading}
          >
            <SendIcon />
          </IconButton>
        </form>
      </div>
    </div>
  )
}

// Simple markdown-ish rendering (bold, code, paragraphs)
const MessageContent = ({ content }: { content: string }) => {
  const paragraphs = content.split("\n\n")
  return (
    <>
      {paragraphs.map((p, i) => {
        const lines = p.split("\n")
        return (
          <p key={i} className="mb-2 last:mb-0">
            {lines.map((line, j) => (
              <span key={j}>
                {j > 0 && <br />}
                <InlineContent text={line} />
              </span>
            ))}
          </p>
        )
      })}
    </>
  )
}

const InlineContent = ({ text }: { text: string }) => {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g)
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith("`") && part.endsWith("`")) {
          return (
            <code
              key={i}
              className="bg-ui-bg-subtle-hover rounded px-1 py-0.5 text-xs"
            >
              {part.slice(1, -1)}
            </code>
          )
        }
        if (part.startsWith("**") && part.endsWith("**")) {
          return (
            <strong key={i} className="font-semibold">
              {part.slice(2, -2)}
            </strong>
          )
        }
        return <span key={i}>{part}</span>
      })}
    </>
  )
}

// ── Check if a message has visible content (text or completed render_component) ──

function hasVisibleContent(message: any): boolean {
  if (!message) return false
  // User messages always have visible content
  if (message.role === "user") return true
  // Check parts for visible text or completed render_component
  const parts = message.parts || []
  for (const part of parts) {
    if (part.type === "text" && part.text?.trim()) return true
    if (part.type === "tool-invocation" && part.toolInvocation?.state === "result") {
      const name = part.toolInvocation.toolName
      if (name === "render_component" || name === "modify_component" || name === "modify_page" || name === "create_page" || name === "delete_page" || name === "reset_component" || name === "update_custom_page" || name === "set_navigation" || name === "reset_navigation") return true
    }
  }
  // Fallback: check content string
  if (message.content?.trim()) return true
  return false
}

// ── Assistant message: renders text + embedded components ──

const AssistantMessage = ({ message }: { message: any }) => {
  // Extract render_component tool invocations from message parts
  const parts = message.parts || []
  const renderParts: Array<{ type: "text"; content: string } | { type: "component"; result: any }> = []

  // If message has parts (AI SDK v4), use them
  if (parts.length > 0) {
    for (const part of parts) {
      if (part.type === "text" && part.text?.trim()) {
        renderParts.push({ type: "text", content: part.text })
      } else if (
        part.type === "tool-invocation" &&
        part.toolInvocation?.toolName === "render_component" &&
        part.toolInvocation?.state === "result" &&
        part.toolInvocation?.result?.__renderComponent
      ) {
        renderParts.push({ type: "component", result: part.toolInvocation.result })
      }
    }
  }

  // Fallback: if no parts or no render components found, render as text
  if (renderParts.length === 0 && message.content) {
    return (
      <div className="txt-compact-small text-ui-fg-base max-w-none">
        <MessageContent content={message.content} />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {renderParts.map((part, i) => {
        if (part.type === "text") {
          return (
            <div key={i} className="txt-compact-small text-ui-fg-base max-w-none">
              <MessageContent content={part.content} />
            </div>
          )
        }
        return <ChatBlockRenderer key={i} result={part.result} />
      })}
    </div>
  )
}

// ── Render a json-render block inline in chat ──

const ChatBlockRenderer = ({ result }: { result: { component: { type: string; props: Record<string, unknown> }; data: Record<string, unknown>; title?: string } }) => {
  const { component: spec, data, title } = result
  const Renderer = getRenderer(spec.type)

  if (!Renderer) {
    return (
      <div className="bg-ui-bg-subtle rounded-lg px-3 py-2 text-sm text-ui-fg-muted">
        Unknown component type: {spec.type}
      </div>
    )
  }

  // Build a DataComponent from the spec
  const dataComponent: DataComponent = {
    id: `chat-${spec.type}-${Date.now()}`,
    type: spec.type,
    props: spec.props,
  }

  return (
    <div className="chat-rendered-block overflow-hidden rounded-lg border border-ui-border-base">
      {title && (
        <div className="border-b border-ui-border-base bg-ui-bg-subtle px-3 py-1.5">
          <span className="txt-compact-small-plus text-ui-fg-subtle">{title}</span>
        </div>
      )}
      <div className="[&_.shadow-borders-base]:shadow-none [&_>div]:rounded-none">
        <Renderer component={dataComponent} data={data} />
      </div>
    </div>
  )
}

// Sparkles icon (used in empty state)
const SparklesIcon = ({ className }: { className?: string }) => (
  <svg
    className={className}
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
