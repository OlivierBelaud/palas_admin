import { createContext, type PropsWithChildren, useContext, useEffect, useState } from 'react'
import { useSidebar } from './sidebar-provider'

type SearchContextValue = {
  open: boolean
  onOpenChange: (open: boolean) => void
  toggleSearch: () => void
}

const SearchContext = createContext<SearchContextValue | null>(null)

export const useSearch = () => {
  const context = useContext(SearchContext)
  if (!context) {
    throw new Error('useSearch must be used within a SearchProvider')
  }
  return context
}

export const SearchProvider = ({ children }: PropsWithChildren) => {
  const [open, setOpen] = useState(false)
  const { mobile, toggle } = useSidebar()

  const toggleSearch = () => {
    const update = !open
    if (update && mobile) {
      toggle('mobile')
    }
    setOpen(update)
  }

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((prev) => !prev)
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  return (
    <SearchContext.Provider
      value={{
        open,
        onOpenChange: setOpen,
        toggleSearch,
      }}
    >
      {children}
    </SearchContext.Provider>
  )
}
