import { Toaster, TooltipProvider } from '@manta/ui'
import { type QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { PropsWithChildren } from 'react'
import { HelmetProvider } from 'react-helmet-async'
import { AiProvider } from '../ai'
import { type ExtensionAPI, ExtensionProvider } from './extension-provider'
import { ThemeProvider } from './theme-provider'

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
