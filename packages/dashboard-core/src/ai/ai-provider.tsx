import { createContext, type PropsWithChildren, useCallback, useContext, useEffect, useState } from 'react'

const STORAGE_KEY_OPEN = 'manta-ai-panel-open'
const STORAGE_KEY_WIDTH = 'manta-ai-panel-width'
const STORAGE_KEY_MESSAGES = 'manta-ai-chat-messages'

const DEFAULT_WIDTH = 500
const MIN_WIDTH = 360
const MAX_WIDTH = 900

function readStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return fallback
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

function writeStorage(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // quota exceeded or private browsing — ignore
  }
}

export interface StoredMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
}

interface AiContextValue {
  isOpen: boolean
  isFullscreen: boolean
  panelWidth: number
  toggle: () => void
  close: () => void
  setFullscreen: (value: boolean) => void
  setPanelWidth: (width: number) => void
  storedMessages: StoredMessage[]
  setStoredMessages: (messages: StoredMessage[]) => void
  clearConversation: () => void
  conversationKey: number
}

const AiContext = createContext<AiContextValue | null>(null)

export const useAi = () => {
  const ctx = useContext(AiContext)
  if (!ctx) throw new Error('useAi must be used within AiProvider')
  return ctx
}

export { MAX_WIDTH, MIN_WIDTH }

export const AiProvider = ({ children }: PropsWithChildren) => {
  const [isOpen, setIsOpen] = useState(() => readStorage(STORAGE_KEY_OPEN, false))
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [panelWidth, setPanelWidthState] = useState(() => readStorage(STORAGE_KEY_WIDTH, DEFAULT_WIDTH))
  const [storedMessages, setStoredMessagesState] = useState<StoredMessage[]>(() =>
    readStorage(STORAGE_KEY_MESSAGES, []),
  )
  const [conversationKey, setConversationKey] = useState(0)

  // Persist open state
  useEffect(() => {
    writeStorage(STORAGE_KEY_OPEN, isOpen)
  }, [isOpen])

  // Persist width
  const setPanelWidth = useCallback((width: number) => {
    const clamped = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, width))
    setPanelWidthState(clamped)
    writeStorage(STORAGE_KEY_WIDTH, clamped)
  }, [])

  // Persist messages
  const setStoredMessages = useCallback((messages: StoredMessage[]) => {
    setStoredMessagesState(messages)
    writeStorage(STORAGE_KEY_MESSAGES, messages)
  }, [])

  // Clear conversation (reset chat) — bumps key to remount AiChat
  const clearConversation = useCallback(() => {
    setStoredMessagesState([])
    writeStorage(STORAGE_KEY_MESSAGES, [])
    setConversationKey((k) => k + 1)
  }, [])

  const toggle = useCallback(() => {
    setIsOpen((prev) => {
      if (prev && isFullscreen) {
        setIsFullscreen(false)
      }
      return !prev
    })
  }, [isFullscreen])

  const close = useCallback(() => {
    setIsOpen(false)
    setIsFullscreen(false)
  }, [])

  // Escape closes fullscreen, or panel if not fullscreen
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isFullscreen) {
          setIsFullscreen(false)
        } else if (isOpen) {
          setIsOpen(false)
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, isFullscreen])

  return (
    <AiContext.Provider
      value={{
        isOpen,
        isFullscreen,
        panelWidth,
        toggle,
        close,
        setFullscreen: setIsFullscreen,
        setPanelWidth,
        storedMessages,
        setStoredMessages,
        clearConversation,
        conversationKey,
      }}
    >
      {children}
    </AiContext.Provider>
  )
}
