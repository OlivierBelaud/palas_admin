import { useDashboardContext } from '@mantajs/dashboard'
import { Alert, Button, Input } from '@mantajs/ui'
import { ArrowDown, ArrowUp, GripVertical, Plus, Save, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { CollectionImagePicker } from '../../../components/collection-image-picker'
import { shopifyImageThumbnail } from '../../../catalog-content'
import type {
  CatalogContentData,
  HomepageTile,
  ShopifyCollectionChoice,
} from '../../../catalog-content'

const ENDPOINT = '/api/admin/catalog-content'

type TileDraft = Omit<HomepageTile, 'id' | 'position'> & { id?: string; position?: number }

function emptyTile(collection?: ShopifyCollectionChoice): TileDraft {
  return {
    shopify_collection_id: collection?.id || '',
    label_fr: '',
    label_en: '',
    image_source: 'collection',
    shopify_product_id: null,
    image_url: collection?.image?.url || null,
  }
}

function TileEditor({
  initial,
  collections,
  busy,
  onSave,
  onDelete,
}: {
  initial: TileDraft
  collections: ShopifyCollectionChoice[]
  busy: boolean
  onSave: (tile: TileDraft) => Promise<void>
  onDelete?: () => Promise<void>
}) {
  const [tile, setTile] = useState(initial)
  const collection = useMemo(
    () => collections.find((candidate) => candidate.id === tile.shopify_collection_id),
    [collections, tile.shopify_collection_id],
  )
  const preview = tile.image_url || collection?.image?.url || null

  function selectCollection(collectionId: string) {
    const next = collections.find((candidate) => candidate.id === collectionId)
    setTile((current) => ({
      ...current,
      shopify_collection_id: collectionId,
      image_source: 'collection',
      shopify_product_id: null,
      image_url: next?.image?.url || null,
    }))
  }

  return (
    <article className="grid gap-4 rounded-md border bg-card p-4 lg:grid-cols-[180px_minmax(0,1fr)]">
      <div className="aspect-[4/5] overflow-hidden rounded bg-muted">
        {preview ? <img alt="" className="size-full object-cover" src={shopifyImageThumbnail(preview, 320)} /> : null}
      </div>
      <div className="grid content-start gap-4">
        <label className="grid gap-1 text-sm font-medium">
          Collection Shopify
          <select
            className="h-10 rounded-md border bg-background px-3 text-sm"
            onChange={(event) => selectCollection(event.target.value)}
            value={tile.shopify_collection_id}
          >
            <option value="">Choisir une collection…</option>
            {collections.map((choice) => (
              <option key={choice.id} value={choice.id}>
                {choice.title}
              </option>
            ))}
          </select>
        </label>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="grid gap-1 text-sm font-medium">
            Intitulé français
            <Input
              onChange={(event) => setTile((current) => ({ ...current, label_fr: event.target.value }))}
              placeholder={collection?.title || 'Ex. Nouveautés'}
              value={tile.label_fr || ''}
            />
          </label>
          <label className="grid gap-1 text-sm font-medium">
            Intitulé anglais
            <Input
              onChange={(event) => setTile((current) => ({ ...current, label_en: event.target.value }))}
              placeholder={collection?.title || 'Ex. New in'}
              value={tile.label_en || ''}
            />
          </label>
        </div>
        <CollectionImagePicker
          collectionId={tile.shopify_collection_id || null}
          onSelect={(image) =>
            setTile((current) => ({
              ...current,
              image_source: image.source,
              shopify_product_id: image.productId,
              image_url: image.url,
            }))
          }
          selectedUrl={preview}
        />
        <p className="text-xs text-muted-foreground">
          Sans intitulé personnalisé, le nom Shopify de la collection sera utilisé.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={!tile.shopify_collection_id}
            isLoading={busy}
            onClick={() => onSave({ ...tile, image_url: preview || null })}
            type="button"
          >
            <Save size={15} /> Enregistrer
          </Button>
          {onDelete ? (
            <Button disabled={busy} onClick={onDelete} type="button" variant="outline">
              <Trash2 size={15} /> Supprimer
            </Button>
          ) : null}
        </div>
      </div>
    </article>
  )
}

export default function CatalogueHomepagePage() {
  const { dataSource } = useDashboardContext()
  const [data, setData] = useState<CatalogContentData | null>(null)
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const body = (await dataSource.fetch(ENDPOINT)) as { data?: CatalogContentData }
      if (!body.data) throw new Error('Réponse vide')
      setData(body.data)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Impossible de charger la homepage')
    }
  }, [dataSource])

  useEffect(() => {
    void load()
  }, [load])

  const mutate = useCallback(
    async (input: Record<string, unknown>) => {
      setBusy(true)
      setError(null)
      try {
        const body = (await dataSource.mutate(ENDPOINT, 'POST', input)) as { data?: CatalogContentData }
        if (body.data) setData(body.data)
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'Modification impossible')
      } finally {
        setBusy(false)
      }
    },
    [dataSource],
  )

  async function move(index: number, direction: -1 | 1) {
    if (!data) return
    const next = [...data.homepage]
    const target = index + direction
    if (!next[target]) return
    ;[next[index], next[target]] = [next[target], next[index]]
    setData({ ...data, homepage: next })
    await mutate({ action: 'reorder_homepage', ids: next.map((tile) => tile.id) })
  }

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Catalogue / Homepage</p>
          <h1 className="text-2xl font-semibold tracking-tight">Composition de la homepage</h1>
          <p className="text-sm text-muted-foreground">
            Collections catalogue et éditoriales, libellés traduits et image représentative.
          </p>
        </div>
        <Button onClick={() => setAdding(true)} type="button">
          <Plus size={16} /> Ajouter un bloc
        </Button>
      </header>

      {error ? <Alert variant="destructive">{error}</Alert> : null}
      {!data ? <div className="rounded-md border bg-card p-8 text-center">Chargement…</div> : null}

      {adding && data ? (
        <TileEditor
          busy={busy}
          collections={data.collections}
          initial={emptyTile(data.collections[0])}
          onSave={async (tile) => {
            await mutate({ action: 'save_homepage_tile', ...tile })
            setAdding(false)
          }}
        />
      ) : null}

      <div className="grid gap-4">
        {data?.homepage.map((tile, index) => (
          <div className="grid grid-cols-[36px_minmax(0,1fr)] gap-2" key={tile.id}>
            <div className="flex flex-col items-center gap-1 pt-4 text-muted-foreground">
              <GripVertical size={18} />
              <button
                aria-label="Monter"
                disabled={index === 0 || busy}
                onClick={() => move(index, -1)}
                type="button"
              >
                <ArrowUp size={17} />
              </button>
              <button
                aria-label="Descendre"
                disabled={index === (data?.homepage.length || 0) - 1 || busy}
                onClick={() => move(index, 1)}
                type="button"
              >
                <ArrowDown size={17} />
              </button>
            </div>
            <TileEditor
              busy={busy}
              collections={data.collections}
              initial={tile}
              onDelete={() => mutate({ action: 'delete_homepage_tile', id: tile.id })}
              onSave={(draft) => mutate({ action: 'save_homepage_tile', ...draft, id: tile.id })}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
