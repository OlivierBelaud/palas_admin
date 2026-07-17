import { useDashboardContext } from '@mantajs/dashboard'
import { Button, Input } from '@mantajs/ui'
import { Check, ImageIcon, Search, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import {
  shopifyImageThumbnail,
  shouldLoadCollectionMedia,
  type ShopifyCollectionMedia,
} from '../catalog-content'

const ENDPOINT = '/api/admin/catalog-content'
const PAGE_SIZE = 60

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
  const [open, setOpen] = useState(false)
  const [media, setMedia] = useState<ShopifyCollectionMedia[]>([])
  const [loadedCollectionId, setLoadedCollectionId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [productId, setProductId] = useState('')
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)

  useEffect(() => {
    if (!collectionId || !shouldLoadCollectionMedia(open, collectionId, loadedCollectionId)) return
    let active = true
    setLoading(true)
    setError(null)
    setMedia([])
    void dataSource
      .fetch(`${ENDPOINT}?collection_id=${encodeURIComponent(collectionId)}`)
      .then((body) => {
        if (!active) return
        const result = body as { data?: { media?: ShopifyCollectionMedia[] } }
        setMedia(result.data?.media || [])
        setLoadedCollectionId(collectionId)
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
  }, [collectionId, dataSource, loadedCollectionId, open])

  useEffect(() => {
    if (!open) return
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [open])

  useEffect(() => {
    setLoadedCollectionId(null)
    setMedia([])
    setProductId('')
    setQuery('')
  }, [collectionId])

  const products = useMemo(() => {
    const byId = new Map<string, string>()
    for (const image of media) {
      if (image.productId && image.productTitle) byId.set(image.productId, image.productTitle)
    }
    return [...byId.entries()].sort((a, b) => a[1].localeCompare(b[1], 'fr'))
  }, [media])

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('fr')
    return media.filter((image) => {
      if (productId && image.productId !== productId) return false
      return !normalizedQuery || image.productTitle?.toLocaleLowerCase('fr').includes(normalizedQuery)
    })
  }, [media, productId, query])

  const visible = filtered.slice(0, visibleCount)

  function close() {
    setOpen(false)
    setQuery('')
    setProductId('')
    setVisibleCount(PAGE_SIZE)
  }

  return (
    <>
      <Button disabled={!collectionId} onClick={() => setOpen(true)} type="button" variant="outline">
        <ImageIcon size={15} /> Changer l’image
      </Button>
      {open ? (
        <div
          aria-modal="true"
          className="fixed inset-0 z-[100] flex justify-end bg-black/35"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) close()
          }}
          role="dialog"
        >
          <section className="flex h-full w-full max-w-4xl flex-col bg-background shadow-2xl">
            <header className="flex items-start justify-between gap-4 border-b p-5">
              <div>
                <h2 className="text-lg font-semibold">Choisir une image</h2>
                <p className="text-sm text-muted-foreground">
                  Image de collection et toutes les images des produits.
                </p>
              </div>
              <button aria-label="Fermer" className="rounded p-2 hover:bg-muted" onClick={close} type="button">
                <X size={20} />
              </button>
            </header>
            <div className="grid gap-3 border-b p-4 sm:grid-cols-2">
              <label className="relative">
                <Search className="absolute left-3 top-3 text-muted-foreground" size={16} />
                <Input
                  className="pl-9"
                  onChange={(event) => {
                    setQuery(event.target.value)
                    setVisibleCount(PAGE_SIZE)
                  }}
                  placeholder="Rechercher un produit…"
                  value={query}
                />
              </label>
              <select
                className="h-10 rounded-md border bg-background px-3 text-sm"
                onChange={(event) => {
                  setProductId(event.target.value)
                  setVisibleCount(PAGE_SIZE)
                }}
                value={productId}
              >
                <option value="">Tous les produits</option>
                {products.map(([id, title]) => (
                  <option key={id} value={id}>
                    {title}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              {loading ? <p className="py-16 text-center text-sm text-muted-foreground">Chargement des médias…</p> : null}
              {error ? <p className="py-16 text-center text-sm text-destructive">{error}</p> : null}
              {!loading && !error ? (
                <>
                  <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
                    {visible.map((image) => {
                      const selected = image.url === selectedUrl
                      return (
                        <button
                          aria-label={`Choisir ${image.label}`}
                          className={`group relative aspect-square overflow-hidden rounded border-2 bg-muted ${
                            selected
                              ? 'border-primary ring-2 ring-primary/20'
                              : 'border-transparent hover:border-muted-foreground/40'
                          }`}
                          key={image.key}
                          onClick={() => {
                            onSelect(image)
                            close()
                          }}
                          title={image.label}
                          type="button"
                        >
                          <img
                            alt={image.altText || image.label}
                            className="size-full object-cover"
                            decoding="async"
                            height="120"
                            loading="lazy"
                            src={shopifyImageThumbnail(image.url, 120)}
                            width="120"
                          />
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
                  {!visible.length ? (
                    <p className="py-16 text-center text-sm text-muted-foreground">Aucune image pour ce filtre.</p>
                  ) : null}
                  {visible.length < filtered.length ? (
                    <div className="flex justify-center py-6">
                      <Button onClick={() => setVisibleCount((count) => count + PAGE_SIZE)} type="button" variant="outline">
                        Afficher {Math.min(PAGE_SIZE, filtered.length - visible.length)} images de plus
                      </Button>
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>
            <footer className="border-t px-5 py-3 text-xs text-muted-foreground">
              {filtered.length} image{filtered.length > 1 ? 's' : ''}. Miniatures optimisées à 120 × 120 px.
            </footer>
          </section>
        </div>
      ) : null}
    </>
  )
}
