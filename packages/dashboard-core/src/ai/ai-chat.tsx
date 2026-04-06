import { useChat } from '@ai-sdk/react'
import { cn, IconButton, toast } from '@manta/ui'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useDashboardContext } from '../context'
import type { DataComponent } from '../pages/types'
import { getRenderer } from '../renderers/index'
import { AIDataTable } from './ai-data-table'
import { type StoredMessage, useAi } from './ai-provider'
import { usePageContext } from './use-page-context'

// Arrow-up send icon
const SendIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
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
  const { dataSource, overrideStore, defaultNavigation } = useDashboardContext()
  const queryClient = useQueryClient()
  const pageContext = usePageContext()
  const navigate = useNavigate()

  // Track which tool invocations we've already applied (by toolCallId)
  const appliedOverrides = useRef(new Set<string>())

  const baseUrl = dataSource.baseUrl === '/' ? '' : dataSource.baseUrl

  // Get auth token for AI chat requests
  const token =
    typeof localStorage !== 'undefined'
      ? localStorage.getItem('manta-auth-token') || localStorage.getItem('manta:token:admin')
      : null

  const { messages, input, handleInputChange, handleSubmit, isLoading, error } = useChat({
    api: `${baseUrl}/api/admin/ai/chat`,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    initialMessages: storedMessages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
    })),
    experimental_prepareRequestBody: ({ messages: msgs }) => {
      // Send current page context + list of custom pages so the AI knows what exists
      const customPagesMap = overrideStore.getCustomPages()
      const customNavs = overrideStore.getCustomNavItems()
      const customPagesContext =
        Object.keys(customPagesMap).length > 0
          ? { customPages: customNavs.map((n) => ({ pageId: n.key, label: n.label, path: n.path })) }
          : undefined
      // Send navigation state: override + defaults so AI knows the real menu
      const navOverride = overrideStore.getNavigationOverride()
      return {
        messages: msgs,
        ...(pageContext ? { pageContext } : {}),
        ...(customPagesContext || {}),
        ...(navOverride ? { navigationOverride: navOverride } : {}),
        defaultNavigation,
      }
    },
    // System prompt is handled server-side in /admin/ai/chat
    fetch: (url, options) => fetch(url, { ...options, credentials: 'include' }),
  })

  // Persist messages to localStorage when they change
  useEffect(() => {
    if (messages.length > 0) {
      const toStore: StoredMessage[] = messages.map((m) => ({
        id: m.id,
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }))
      setStoredMessages(toStore)
    }
  }, [messages, setStoredMessages])

  // Apply modify_component / modify_page overrides from tool results
  useEffect(() => {
    for (const message of messages) {
      if (message.role !== 'assistant') continue
      const parts = (message as any).parts || []
      for (const part of parts) {
        if (part.type !== 'tool-invocation' || part.toolInvocation?.state !== 'result') continue
        const inv = part.toolInvocation
        const callId = inv.toolCallId
        if (appliedOverrides.current.has(callId)) continue

        if (inv.toolName === 'modify_component' && inv.result?.__modifyComponent) {
          const { componentId, component, reason } = inv.result
          overrideStore.setComponentOverride(componentId, component)
          appliedOverrides.current.add(callId)
          toast.success('Page updated', { description: reason })
        } else if (inv.toolName === 'modify_page' && inv.result?.__modifyPage) {
          const { pageId, page, reason } = inv.result
          overrideStore.setPageOverride(pageId, page)
          appliedOverrides.current.add(callId)
          toast.success('Page updated', { description: reason })
        } else if (inv.toolName === 'create_page' && inv.result?.__createPage) {
          const { page, components, navItem } = inv.result
          overrideStore.addCustomPage(page, components, navItem)
          appliedOverrides.current.add(callId)
          toast.success('Page created', { description: `"${navItem.label}" has been added to the navigation` })
          // Navigate to the new page
          navigate(page.route)
        } else if (inv.toolName === 'delete_page' && inv.result?.__deletePage) {
          const { pageId } = inv.result
          overrideStore.removeCustomPage(pageId)
          appliedOverrides.current.add(callId)
          toast.success('Page deleted', { description: `"${pageId}" has been removed` })
          // If currently on the deleted page, redirect to orders
          if (window.location.pathname.includes(pageId)) {
            navigate('/orders')
          }
        } else if (inv.toolName === 'reset_component' && inv.result?.__resetComponent) {
          const { componentId } = inv.result
          overrideStore.removeComponentOverride(componentId)
          appliedOverrides.current.add(callId)
          toast.success('Component reset', { description: `"${componentId}" restored to default` })
        } else if (inv.toolName === 'update_custom_page' && inv.result?.__updateCustomPage) {
          const { pageId, updates, reason } = inv.result
          overrideStore.updateCustomPage(pageId, updates)
          appliedOverrides.current.add(callId)
          toast.success('Page updated', { description: reason })
          // If route changed and we're on the old route, navigate to the new one
          if (updates.route && window.location.pathname !== updates.route) {
            navigate(updates.route)
          }
        } else if (inv.toolName === 'set_navigation' && inv.result?.__setNavigation) {
          const { navigation, reason } = inv.result
          overrideStore.setNavigationOverride(navigation)
          appliedOverrides.current.add(callId)
          toast.success('Navigation updated', { description: reason })
        } else if (inv.toolName === 'reset_navigation' && inv.result?.__resetNavigation) {
          overrideStore.resetNavigationOverride()
          appliedOverrides.current.add(callId)
          toast.success('Navigation reset', { description: 'Default menu restored' })
        } else if (inv.toolName === 'get_navigation' && inv.result?.__getNavigation) {
          // get_navigation is read-only, just mark as applied
          appliedOverrides.current.add(callId)
        } else if (
          inv.toolName?.startsWith('command_') &&
          inv.result?.success &&
          !appliedOverrides.current.has(callId)
        ) {
          // A CQRS command was executed by the AI — invalidate all queries so the UI refreshes
          appliedOverrides.current.add(callId)
          queryClient.invalidateQueries()
        }
      }
    }
  }, [messages])

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Handle Enter to submit, Shift+Enter for newline
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (input.trim()) {
        handleSubmit(e as unknown as React.FormEvent<HTMLFormElement>)
      }
    }
  }

  const containerClass = centered ? 'mx-auto w-full max-w-[720px]' : ''

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Messages area */}
      <div className={cn('flex flex-1 flex-col overflow-y-auto', centered ? 'items-center px-4 py-16' : 'px-4 py-3')}>
        <div
          className={cn('w-full flex-1', containerClass, {
            'flex items-center justify-center': messages.length === 0,
          })}
        >
          {messages.length === 0 && (
            <div className="text-center text-muted-foreground">
              <SparklesIcon className="mx-auto mb-3 h-8 w-8 opacity-40" />
              <p className="text-sm font-medium">How can I help?</p>
              <p className="mt-1 text-sm opacity-60">Ask anything about your store data</p>
            </div>
          )}

          {messages.map((message) => (
            <div
              key={message.id}
              className={cn('mb-4', {
                'flex justify-end': message.role === 'user',
              })}
            >
              {message.role === 'user' ? (
                <div className="max-w-[85%] rounded-xl rounded-br-sm bg-card px-3 py-2 shadow-[0_2px_6px_rgba(0,0,0,0.06)]">
                  <p className="whitespace-pre-wrap text-sm">{message.content}</p>
                </div>
              ) : (
                <div className={centered ? 'max-w-full' : 'max-w-[95%]'}>
                  <AssistantMessage message={message} />
                </div>
              )}
            </div>
          ))}

          {isLoading && !hasVisibleContent(messages[messages.length - 1]) && (
            <div className="mb-4">
              <div className="flex items-center gap-1.5">
                <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground" />
                <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground [animation-delay:150ms]" />
                <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground [animation-delay:300ms]" />
              </div>
            </div>
          )}

          {error && (
            <div className="mb-4 rounded-lg bg-accent px-3 py-2 text-destructive">
              <p className="text-sm">Error: {error.message || 'Failed to get response'}</p>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input area */}
      <div className={cn('shrink-0', centered ? 'flex justify-center px-4 py-4' : 'px-3 py-3')}>
        <form onSubmit={handleSubmit} className={cn('relative', containerClass)}>
          <div className="flex flex-col rounded-md border border-border bg-card transition-colors focus-within:border-foreground/20">
            <textarea
              ref={inputRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder="Ask about your store..."
              rows={1}
              className={cn(
                'w-full appearance-none bg-transparent outline-none',
                'caret-foreground placeholder-muted-foreground text-foreground',
                'min-h-[48px] resize-none px-3 pt-3 pb-1 text-sm',
                'max-h-[120px]',
              )}
              style={{ height: 'auto', fieldSizing: 'content' } as React.CSSProperties}
              onInput={(e) => {
                const target = e.target as HTMLTextAreaElement
                target.style.height = 'auto'
                target.style.height = Math.min(target.scrollHeight, 120) + 'px'
              }}
            />
            <div className="flex items-center justify-end px-2 pb-2">
              <button
                type="submit"
                disabled={!input.trim() || isLoading}
                className={cn(
                  'flex h-7 w-7 items-center justify-center rounded-md transition-colors',
                  'disabled:opacity-30',
                  input.trim()
                    ? 'bg-foreground text-background cursor-pointer'
                    : 'bg-muted-foreground/20 text-muted-foreground',
                )}
              >
                <SendIcon />
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}

// Simple markdown-ish rendering (bold, code, paragraphs)
const MessageContent = ({ content }: { content: string }) => {
  if (!content) return null
  const paragraphs = content.split('\n\n')
  return (
    <>
      {paragraphs.map((p, i) => {
        const lines = p.split('\n')
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
        if (part.startsWith('`') && part.endsWith('`')) {
          return (
            <code key={i} className="rounded bg-accent px-1 py-0.5 text-xs">
              {part.slice(1, -1)}
            </code>
          )
        }
        if (part.startsWith('**') && part.endsWith('**')) {
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
  if (message.role === 'user') return true
  // Check parts for visible text or completed render_component
  const parts = message.parts || []
  for (const part of parts) {
    if (part.type === 'text' && part.text?.trim()) return true
    if (part.type === 'tool-invocation' && part.toolInvocation?.state === 'result') {
      const name = part.toolInvocation.toolName
      if (
        name === 'render_component' ||
        name === 'modify_component' ||
        name === 'modify_page' ||
        name === 'create_page' ||
        name === 'delete_page' ||
        name === 'reset_component' ||
        name === 'update_custom_page' ||
        name === 'set_navigation' ||
        name === 'reset_navigation'
      )
        return true
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
  const renderParts: Array<{ type: 'text'; content: string } | { type: 'component'; result: any }> = []

  // If message has parts (AI SDK v4), use them
  if (parts.length > 0) {
    for (const part of parts) {
      if (part.type === 'text' && part.text?.trim()) {
        renderParts.push({ type: 'text', content: part.text })
      } else if (
        part.type === 'tool-invocation' &&
        part.toolInvocation?.toolName === 'render_component' &&
        part.toolInvocation?.state === 'result' &&
        part.toolInvocation?.result?.__renderComponent
      ) {
        renderParts.push({ type: 'component', result: part.toolInvocation.result })
      }
    }
  }

  // Fallback: if no parts or no render components found, render as text
  if (renderParts.length === 0 && message.content) {
    return (
      <div className="max-w-none text-sm text-foreground">
        <MessageContent content={message.content} />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {renderParts.map((part, i) => {
        if (part.type === 'text') {
          return (
            <div key={i} className="max-w-none text-sm text-foreground">
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

const ChatBlockRenderer = ({
  result,
}: {
  result: { component: { type: string; props: Record<string, unknown> }; data: Record<string, unknown>; title?: string }
}) => {
  const { component: spec, data, title } = result

  // Entity tables use AIDataTable — in-memory search/filter/pagination, no URL deps
  const typeNorm = spec.type.toLowerCase().replace(/-/g, '')
  if (typeNorm === 'entitytable' || typeNorm === 'datatable') {
    const props = spec.props as {
      columns?: Array<{ key: string; label: string; type?: string; filterable?: boolean | string[] }>
      searchable?: boolean
      pageSize?: number
    }
    const items = Array.isArray(data) ? data : (data as any)?.items || []
    return (
      <div className="chat-rendered-block overflow-hidden rounded-lg border border-border">
        <AIDataTable
          items={items as Record<string, unknown>[]}
          columns={props.columns ?? []}
          title={title}
          searchable={props.searchable !== false}
          pageSize={props.pageSize ?? 5}
        />
      </div>
    )
  }

  const Renderer = getRenderer(spec.type)

  if (!Renderer) {
    return (
      <div className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
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
    <div className="chat-rendered-block overflow-hidden rounded-lg border border-border">
      {title && (
        <div className="border-b border-border bg-muted px-3 py-1.5">
          <span className="text-sm font-medium text-muted-foreground">{title}</span>
        </div>
      )}
      <div className="[&_.shadow-sm]:shadow-none [&_>div]:rounded-none">
        <Renderer component={dataComponent} data={data} />
      </div>
    </div>
  )
}

// Sparkles icon (used in empty state)
const SparklesIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .962 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.582a.5.5 0 0 1 0 .962L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.962 0L9.937 15.5z"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
  </svg>
)
