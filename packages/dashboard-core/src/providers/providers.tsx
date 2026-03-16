import { Toaster, TooltipProvider } from "@medusajs/ui"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { PropsWithChildren } from "react"
import { HelmetProvider } from "react-helmet-async"
import { ExtensionAPI, ExtensionProvider } from "./extension-provider"
import { ThemeProvider } from "./theme-provider"
import { AiProvider } from "../ai"

type ProvidersProps = PropsWithChildren<{
  api: ExtensionAPI
  queryClient: QueryClient
}>

export const Providers = ({ api, queryClient, children }: ProvidersProps) => {
  return (
    <TooltipProvider>
      <ExtensionProvider api={api}>
        <HelmetProvider>
          <QueryClientProvider client={queryClient}>
            <AiProvider>
              <ThemeProvider>
                {children}
                <Toaster />
              </ThemeProvider>
            </AiProvider>
          </QueryClientProvider>
        </HelmetProvider>
      </ExtensionProvider>
    </TooltipProvider>
  )
}
