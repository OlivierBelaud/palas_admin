import { useDashboardContext } from '@mantajs/dashboard'
import { Check, ImageIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ShopifyCollectionMedia } from '../catalog-content'

const ENDPOINT = '/api/admin/catalog-content'

export function CollectionImagePicker({
  collectionId,
  selectedUrl,
  onSelect,
}: {
  collectionId: string | null
  selectedUrl: string | null
  onSelect: (media: ShopifyCollectionMedia) => void
}) {
  const { dataSource } = useDashboardContext()
  const [media, setMedia] = useState<ShopifyCollectionMedia[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!collectionId) {
      setMedia([])
      return
    }
    let active = true
    setLoading(true)
    setError(null)
    void dataSource
      .fetch(`${ENDPOINT}?collection_id=${encodeURIComponent(collectionId)}`)
      .then((body) => {
        if (!active) return
        const result = body as { data?: { media?: ShopifyCollectionMedia[] } }
        const choices = result.data?.media || []
        setMedia(choices)
        if (!selectedUrl && choices[0]) onSelect(choices[0])
      })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : 'Images indisponibles')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [collectionId, dataSource, selectedUrl])

  if (!collectionId) {
    return <p className="text-sm text-muted-foreground">Choisissez d’abord une collection.</p>
  }
  if (loading) {
    return <p className="text-sm text-muted-foreground">Chargement de toutes les images…</p>
  }
  if (error) {
    return <p className="text-sm text-destructive">{error}</p>
  }
  if (!media.length) {
    return <p className="text-sm text-muted-foreground">Cette collection ne contient aucune image.</p>
  }

  return (
    <div className="grid gap-2">
      <div className="text-sm font-medium">Image affichée</div>
      <div className="grid max-h-[520px] grid-cols-3 gap-2 overflow-y-auto rounded-md border bg-muted/20 p-2 sm:grid-cols-4 lg:grid-cols-6">
        {media.map((image) => {
          const selected = image.url === selectedUrl
          return (
            <button
              aria-label={`Choisir ${image.label}`}
              className={`group relative aspect-square overflow-hidden rounded border-2 bg-muted ${
                selected ? 'border-primary ring-2 ring-primary/20' : 'border-transparent hover:border-muted-foreground/40'
              }`}
              key={image.key}
              onClick={() => onSelect(image)}
              title={image.label}
              type="button"
            >
              <img alt={image.altText || image.label} className="size-full object-cover" loading="lazy" src={image.url} />
              <span className="absolute inset-x-0 bottom-0 truncate bg-black/65 px-1.5 py-1 text-left text-[10px] text-white">
                {image.source === 'collection' ? 'Collection' : image.label}
              </span>
              {selected ? (
                <span className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  <Check size={13} />
                </span>
              ) : null}
            </button>
          )
        })}
      </div>
      <p className="flex items-center gap-1 text-xs text-muted-foreground">
        <ImageIcon size={13} /> {media.length} image{media.length > 1 ? 's' : ''} disponible{media.length > 1 ? 's' : ''}
      </p>
    </div>
  )
}
