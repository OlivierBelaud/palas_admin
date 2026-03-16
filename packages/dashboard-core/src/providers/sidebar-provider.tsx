import {
  createContext,
  PropsWithChildren,
  useContext,
  useEffect,
  useState,
} from "react"
import { useLocation } from "react-router-dom"

type SidebarContextValue = {
  desktop: boolean
  mobile: boolean
  toggle: (view: "desktop" | "mobile") => void
}

const SidebarContext = createContext<SidebarContextValue | null>(null)

export const useSidebar = () => {
  const context = useContext(SidebarContext)
  if (!context) {
    throw new Error("useSidebar must be used within a SidebarProvider")
  }
  return context
}

export const SidebarProvider = ({ children }: PropsWithChildren) => {
  const [desktop, setDesktop] = useState(true)
  const [mobile, setMobile] = useState(false)

  const { pathname } = useLocation()

  const toggle = (view: "desktop" | "mobile") => {
    if (view === "desktop") {
      setDesktop(!desktop)
    } else {
      setMobile(!mobile)
    }
  }

  useEffect(() => {
    setMobile(false)
  }, [pathname])

  return (
    <SidebarContext.Provider value={{ desktop, mobile, toggle }}>
      {children}
    </SidebarContext.Provider>
  )
}
