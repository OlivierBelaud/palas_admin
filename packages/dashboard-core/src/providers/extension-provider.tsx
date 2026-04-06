import { type ComponentType, createContext, type PropsWithChildren, useContext } from 'react'

export type MenuItem = {
  label: string
  to: string
  icon?: ComponentType
  items?: { label: string; to: string }[]
  nested?: string
}

export type ExtensionAPI = {
  getWidgets: (zone: string) => ComponentType[]
  getMenu: (zone: string) => MenuItem[]
}

const ExtensionContext = createContext<ExtensionAPI | null>(null)

export const useExtension = (): ExtensionAPI => {
  const context = useContext(ExtensionContext)
  if (!context) {
    return {
      getWidgets: () => [],
      getMenu: () => [],
    }
  }
  return context
}

type ExtensionProviderProps = PropsWithChildren<{
  api: ExtensionAPI
}>

export const ExtensionProvider = ({ api, children }: ExtensionProviderProps) => {
  return <ExtensionContext.Provider value={api}>{children}</ExtensionContext.Provider>
}
