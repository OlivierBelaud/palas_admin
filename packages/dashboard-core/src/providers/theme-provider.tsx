import {
  createContext,
  PropsWithChildren,
  useContext,
  useEffect,
  useState,
} from "react"

type ThemeOption = "light" | "dark" | "system"
type ThemeValue = "light" | "dark"

type ThemeContextValue = {
  theme: ThemeOption
  setTheme: (theme: ThemeOption) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export const useTheme = () => {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider")
  }
  return context
}

const THEME_KEY = "medusa_admin_theme"

function getDefaultValue(): ThemeOption {
  const persisted = localStorage?.getItem(THEME_KEY) as ThemeOption
  if (persisted) {
    return persisted
  }
  return "system"
}

function getThemeValue(selected: ThemeOption): ThemeValue {
  if (selected === "system") {
    if (typeof window !== "undefined") {
      return window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
    }
    return "light"
  }
  return selected
}

export const ThemeProvider = ({ children }: PropsWithChildren) => {
  const [state, setState] = useState<ThemeOption>(getDefaultValue())
  const [value, setValue] = useState<ThemeValue>(getThemeValue(state))

  const setTheme = (theme: ThemeOption) => {
    localStorage.setItem(THEME_KEY, theme)
    const themeValue = getThemeValue(theme)
    setState(theme)
    setValue(themeValue)
  }

  useEffect(() => {
    const html = document.querySelector("html")
    if (html) {
      const css = document.createElement("style")
      css.appendChild(
        document.createTextNode(
          `* {
            -webkit-transition: none !important;
            -moz-transition: none !important;
            -o-transition: none !important;
            -ms-transition: none !important;
            transition: none !important;
          }`
        )
      )
      document.head.appendChild(css)

      html.classList.remove(value === "light" ? "dark" : "light")
      html.classList.add(value)
      html.style.colorScheme = value

      window.getComputedStyle(css).opacity
      document.head.removeChild(css)
    }
  }, [value])

  return (
    <ThemeContext.Provider value={{ theme: state, setTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}
