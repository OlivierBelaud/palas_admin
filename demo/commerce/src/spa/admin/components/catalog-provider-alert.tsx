import { Alert } from '@mantajs/ui'

export function CatalogProviderAlert({
  label,
  provider,
}: {
  label: string
  provider: { ok: boolean; error: string | null }
}) {
  if (provider.ok) return null
  return (
    <Alert variant="destructive">
      {label}, mais Shopify est indisponible : {provider.error ?? 'erreur inconnue'}
    </Alert>
  )
}
