/**
 * Minimal i18n initialization for Medusa form routes.
 *
 * The form routes imported from the Medusa source use react-i18next's
 * useTranslation() hook. This module initializes i18next with the English
 * translations from the Medusa source so those hooks resolve correctly.
 *
 * The translations are loaded from the Medusa source via the @medusa-i18n
 * Vite alias (configured in demo/medusa-config.ts).
 */
import i18next from "i18next"
import LanguageDetector from "i18next-browser-languagedetector"
import { initReactI18next } from "react-i18next"

// English translations from Medusa source
// This import resolves via the @medusa-i18n Vite alias
import en from "@medusa-i18n/en.json"

const resources = {
  en: { translation: en },
}

if (!i18next.isInitialized) {
  i18next
    .use(
      new LanguageDetector(null, {
        lookupCookie: "lng",
        lookupLocalStorage: "lng",
      })
    )
    .use(initReactI18next)
    .init({
      fallbackLng: "en",
      fallbackNS: "translation",
      interpolation: {
        escapeValue: false,
      },
      resources,
      supportedLngs: ["en"],
    })
}

export { i18next }
