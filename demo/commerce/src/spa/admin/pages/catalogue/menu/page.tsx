import { useDashboardContext } from '@mantajs/dashboard'
import { Alert, Button, Input } from '@mantajs/ui'
import { Plus, Save, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { shopifyImageThumbnail, type CatalogContentData, type CatalogMenuItem } from '../../../catalog-content'
import { CollectionImagePicker } from '../../../components/collection-image-picker'
import { CatalogProviderAlert } from '../../../components/catalog-provider-alert'

const ENDPOINT = '/api/admin/catalog-content'

type MenuDraft = Omit<CatalogMenuItem, 'id' | 'position'> & { id?: string; position?: number }

function editorDraft(item?: CatalogMenuItem): MenuDraft {
  return item
    ? { ...item }
    : {
        parent_id: null,
        shopify_collection_id: null,
        label_fr: '',
        label_en: '',
        url: '',
        image_url: null,
        shopify_product_id: null,
      }
}

export default function CatalogueMenuPage() {
  const { dataSource } = useDashboardContext()
  const [data, setData] = useState<CatalogContentData | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<MenuDraft>(editorDraft())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const body = (await dataSource.fetch(ENDPOINT)) as { data?: CatalogContentData }
      if (!body.data) throw new Error('Réponse vide')
      setData(body.data)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Impossible de charger le menu')
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

  const roots = data?.menu.filter((item) => !item.parent_id) || []

  function select(item?: CatalogMenuItem) {
    setSelectedId(item?.id || null)
    setDraft(editorDraft(item))
  }

  function renderItem(item: CatalogMenuItem, depth = 0) {
    const children = data?.menu.filter((candidate) => candidate.parent_id === item.id) || []
    return (
      <div key={item.id}>
        <button
          className={`flex w-full items-center justify-between rounded px-3 py-2 text-left text-sm ${
            selectedId === item.id ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
          }`}
          onClick={() => select(item)}
          style={{ paddingLeft: `${12 + depth * 20}px` }}
          type="button"
        >
          <span>{item.label_fr}</span>
          <span className="text-xs opacity-60">{children.length || ''}</span>
        </button>
        {children.map((child) => renderItem(child, depth + 1))}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Catalogue / Menu</p>
          <h1 className="text-2xl font-semibold tracking-tight">Navigation du storefront</h1>
          <p className="text-sm text-muted-foreground">
            Préparez les entrées, traductions et niveaux du futur menu sans modifier Shopify.
          </p>
        </div>
        <Button onClick={() => select()} type="button">
          <Plus size={16} /> Ajouter une entrée
        </Button>
      </header>

      {error ? <Alert variant="destructive">{error}</Alert> : null}
      {data ? <CatalogProviderAlert label="Menu local disponible" provider={data.provider} /> : null}

      <div className="grid min-h-[560px] gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="rounded-md border bg-card p-3">
          <div className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Structure du menu
          </div>
          {roots.map((item) => renderItem(item))}
          {!data?.menu.length ? <p className="p-3 text-sm text-muted-foreground">Menu vide.</p> : null}
        </aside>

        <section className="rounded-md border bg-card p-5">
          <h2 className="mb-5 text-lg font-semibold">
            {selectedId ? 'Modifier l’entrée' : 'Nouvelle entrée'}
          </h2>
          <div className="grid max-w-2xl gap-4">
            <label className="grid gap-1 text-sm font-medium">
              Collection Shopify facultative
              <select
                className="h-10 rounded-md border bg-background px-3 text-sm"
                onChange={(event) => {
                  const collectionId = event.target.value || null
                  const next = data?.collections.find((candidate) => candidate.id === collectionId)
                  setDraft((current) => ({
                    ...current,
                    shopify_collection_id: collectionId,
                    label_fr: current.label_fr || next?.title || '',
                    label_en: current.label_en || next?.title || '',
                    url: next ? `/collections/${next.handle}` : current.url,
                    image_url: next?.image?.url || null,
                    shopify_product_id: null,
                  }))
                }}
                value={draft.shopify_collection_id || ''}
              >
                <option value="">Entrée libre</option>
                {data?.collections.map((choice) => (
                  <option key={choice.id} value={choice.id}>
                    {choice.title}
                  </option>
                ))}
              </select>
            </label>
            {draft.image_url ? (
              <img
                alt=""
                className="h-36 w-28 rounded object-cover"
                src={shopifyImageThumbnail(draft.image_url, 320)}
              />
            ) : null}
            <CollectionImagePicker
              collectionId={draft.shopify_collection_id}
              onSelect={(image) =>
                setDraft((current) => ({
                  ...current,
                  image_url: image.url,
                  shopify_product_id: image.productId,
                }))
              }
              selectedUrl={draft.image_url}
            />
            <div className="grid gap-3 md:grid-cols-2">
              <label className="grid gap-1 text-sm font-medium">
                Libellé français
                <Input
                  onChange={(event) => setDraft((current) => ({ ...current, label_fr: event.target.value }))}
                  value={draft.label_fr}
                />
              </label>
              <label className="grid gap-1 text-sm font-medium">
                Libellé anglais
                <Input
                  onChange={(event) => setDraft((current) => ({ ...current, label_en: event.target.value }))}
                  value={draft.label_en || ''}
                />
              </label>
            </div>
            <label className="grid gap-1 text-sm font-medium">
              Sous-entrée de
              <select
                className="h-10 rounded-md border bg-background px-3 text-sm"
                onChange={(event) =>
                  setDraft((current) => ({ ...current, parent_id: event.target.value || null }))
                }
                value={draft.parent_id || ''}
              >
                <option value="">Premier niveau</option>
                {data?.menu
                  .filter((item) => item.id !== selectedId && !item.parent_id)
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label_fr}
                    </option>
                  ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm font-medium">
              URL
              <Input
                onChange={(event) => setDraft((current) => ({ ...current, url: event.target.value }))}
                placeholder="/collections/new"
                value={draft.url || ''}
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={!draft.label_fr.trim()}
                isLoading={busy}
                onClick={async () => {
                  await mutate({ action: 'save_menu_item', ...draft, id: selectedId })
                  select()
                }}
                type="button"
              >
                <Save size={15} /> Enregistrer
              </Button>
              {selectedId ? (
                <Button
                  disabled={busy}
                  onClick={async () => {
                    await mutate({ action: 'delete_menu_item', id: selectedId })
                    select()
                  }}
                  type="button"
                  variant="outline"
                >
                  <Trash2 size={15} /> Supprimer
                </Button>
              ) : null}
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
