import { useCommand, useQuery } from '@mantajs/sdk'
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Skeleton } from '@mantajs/ui'
import { ArrowLeft, Check, Loader2, Save, Search, X } from 'lucide-react'
import * as React from 'react'
import { Link, useNavigate } from 'react-router-dom'

type DiscountMethod = 'code' | 'automatic'
type DiscountTargetType = 'all' | 'collections' | 'products'
type DiscountValueType = 'percentage' | 'amount'

interface ResourceOption {
  id: string
  label: string
  handle: string | null
  meta: string | null
}

interface ResourceSearchData {
  items: ResourceOption[]
  page_info: {
    hasNextPage: boolean
    endCursor: string | null
  }
}

interface DiscountDetail {
  id: string
  method: DiscountMethod
  title: string
  code: string
  starts_at: string
  ends_at: string | null
  value_type: DiscountValueType
  value: number
  target_type: DiscountTargetType
  collection_ids: string[]
  product_ids: string[]
  selected_collections: ResourceOption[]
  selected_products: ResourceOption[]
  applies_once_per_customer: boolean
  usage_limit: number | null
  combines_with_order: boolean
  combines_with_product: boolean
  combines_with_shipping: boolean
}

interface DiscountFormState {
  id?: string
  method: DiscountMethod
  title: string
  code: string
  value_type: DiscountValueType
  value: string
  target_type: DiscountTargetType
  collection_ids: string[]
  product_ids: string[]
  selected_collections: ResourceOption[]
  selected_products: ResourceOption[]
  starts_at: string
  ends_at: string
  applies_once_per_customer: boolean
  usage_limit: string
  combines_with_order: boolean
  combines_with_product: boolean
  combines_with_shipping: boolean
}

type UpsertDiscountInput = {
  id?: string
  method: DiscountMethod
  title: string
  code?: string
  value_type: DiscountValueType
  value: number
  target_type: DiscountTargetType
  collection_ids: string[]
  product_ids: string[]
  starts_at: string
  ends_at?: string | null
  applies_once_per_customer: boolean
  usage_limit?: number | null
  combines_with_order: boolean
  combines_with_product: boolean
  combines_with_shipping: boolean
}

const initialState: DiscountFormState = {
  method: 'automatic',
  title: '',
  code: '',
  value_type: 'percentage',
  value: '15',
  target_type: 'all',
  collection_ids: [],
  product_ids: [],
  selected_collections: [],
  selected_products: [],
  starts_at: toLocalDateTimeValue(new Date().toISOString()),
  ends_at: '',
  applies_once_per_customer: false,
  usage_limit: '',
  combines_with_order: false,
  combines_with_product: false,
  combines_with_shipping: false,
}

export function ShopifyDiscountForm({ discountId }: { discountId?: string }) {
  const navigate = useNavigate()
  const detailQuery = useQuery<DiscountDetail>(
    'discount-detail',
    { id: discountId ?? '' },
    { enabled: Boolean(discountId), staleTime: 30_000 },
  )
  const { run, status, error } = useCommand<UpsertDiscountInput, { id: string; method: DiscountMethod }>(
    'upsertShopifyDiscount',
  )
  const [form, setForm] = React.useState<DiscountFormState>(initialState)
  const [localError, setLocalError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!detailQuery.data) return
    setForm(fromDetail(detailQuery.data))
  }, [detailQuery.data])

  const isLoading = Boolean(discountId) && detailQuery.isLoading
  const isSaving = status === 'running'

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setLocalError(null)
    try {
      const input = toCommandInput(form)
      const result = await run(input)
      if (result.status === 'succeeded') {
        navigate('/discounts')
      } else if (result.status !== 'running') {
        setLocalError(result.error.message)
      }
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err))
    }
  }

  if (isLoading) return <LoadingState />
  if (detailQuery.isError) return <ErrorBox message={detailQuery.error.message} />

  return (
    <form className="flex max-w-5xl flex-col gap-4 pb-8" onSubmit={submit}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <Link
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
            to="/discounts"
          >
            <ArrowLeft className="size-4" />
            Discounts boutique
          </Link>
          <h1 className="mt-3 text-2xl font-semibold tracking-normal">
            {discountId ? 'Editer un discount' : 'Créer un discount'}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Remise basique Shopify: code ou automatique, toute la boutique, collections ou produits.
          </p>
        </div>
        <Button type="submit" size="small" isLoading={isSaving}>
          <Save className="mr-2 h-3.5 w-3.5" />
          Enregistrer
        </Button>
      </div>

      {localError || error ? <ErrorBox message={localError ?? error?.message ?? 'Erreur inconnue'} /> : null}

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-4">
          <Card className="border border-border/70 shadow-none">
            <CardHeader>
              <CardTitle className="text-base font-semibold tracking-normal">Discount</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <Field label="Titre">
                <Input
                  value={form.title}
                  onChange={(event) => setFormValue(setForm, 'title', event.target.value)}
                  placeholder="Summer sale -15%"
                  required
                />
              </Field>

              <SegmentedControl
                label="Méthode"
                value={form.method}
                options={[
                  ['automatic', 'Automatique'],
                  ['code', 'Code promo'],
                ]}
                onChange={(value) => setMethod(setForm, value as DiscountMethod, Boolean(discountId))}
              />

              {form.method === 'code' ? (
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="Code">
                    <Input
                      value={form.code}
                      onChange={(event) => setFormValue(setForm, 'code', event.target.value.toUpperCase())}
                      placeholder="PALAS15"
                      required
                    />
                  </Field>
                  <Field label="Limite d'utilisation">
                    <Input
                      value={form.usage_limit}
                      onChange={(event) => setFormValue(setForm, 'usage_limit', event.target.value)}
                      placeholder="Sans limite"
                      type="number"
                      min="1"
                    />
                  </Field>
                </div>
              ) : null}

              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Type de remise">
                  <select
                    className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                    value={form.value_type}
                    onChange={(event) => setFormValue(setForm, 'value_type', event.target.value as DiscountValueType)}
                  >
                    <option value="percentage">Pourcentage</option>
                    <option value="amount">Montant fixe</option>
                  </select>
                </Field>
                <Field label={form.value_type === 'percentage' ? 'Pourcentage' : 'Montant'}>
                  <Input
                    value={form.value}
                    onChange={(event) => setFormValue(setForm, 'value', event.target.value)}
                    type="number"
                    min="0"
                    step={form.value_type === 'percentage' ? '1' : '0.01'}
                    required
                  />
                </Field>
              </div>
            </CardContent>
          </Card>

          <Card className="border border-border/70 shadow-none">
            <CardHeader>
              <CardTitle className="text-base font-semibold tracking-normal">Cible</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <SegmentedControl
                label="Appliquer sur"
                value={form.target_type}
                options={[
                  ['all', 'Toute la boutique'],
                  ['collections', 'Collections'],
                  ['products', 'Produits'],
                ]}
                onChange={(value) => setFormValue(setForm, 'target_type', value as DiscountTargetType)}
              />

              {form.target_type === 'collections' ? (
                <ResourceCombobox
                  key="collections"
                  label="Collections"
                  placeholder="Chercher une collection..."
                  resource="collections"
                  values={form.collection_ids}
                  selected={form.selected_collections}
                  onChange={(values, selected) => {
                    setFormValue(setForm, 'collection_ids', values)
                    setFormValue(setForm, 'selected_collections', selected)
                  }}
                />
              ) : null}

              {form.target_type === 'products' ? (
                <ResourceCombobox
                  key="products"
                  label="Produits"
                  placeholder="Chercher un produit..."
                  resource="products"
                  values={form.product_ids}
                  selected={form.selected_products}
                  onChange={(values, selected) => {
                    setFormValue(setForm, 'product_ids', values)
                    setFormValue(setForm, 'selected_products', selected)
                  }}
                />
              ) : null}
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card className="border border-border/70 shadow-none">
            <CardHeader>
              <CardTitle className="text-base font-semibold tracking-normal">Planning</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <Field label="Début">
                <Input
                  value={form.starts_at}
                  onChange={(event) => setFormValue(setForm, 'starts_at', event.target.value)}
                  type="datetime-local"
                  required
                />
              </Field>
              <Field label="Fin">
                <Input
                  value={form.ends_at}
                  onChange={(event) => setFormValue(setForm, 'ends_at', event.target.value)}
                  type="datetime-local"
                />
              </Field>
            </CardContent>
          </Card>

          <Card className="border border-border/70 shadow-none">
            <CardHeader>
              <CardTitle className="text-base font-semibold tracking-normal">Règles</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              {form.method === 'code' ? (
                <Checkbox
                  checked={form.applies_once_per_customer}
                  label="Une utilisation par client"
                  onChange={(checked) => setFormValue(setForm, 'applies_once_per_customer', checked)}
                />
              ) : null}
              <Checkbox
                checked={form.combines_with_order}
                label="Cumulable avec order discounts"
                onChange={(checked) => setFormValue(setForm, 'combines_with_order', checked)}
              />
              <Checkbox
                checked={form.combines_with_product}
                label="Cumulable avec product discounts"
                onChange={(checked) => setFormValue(setForm, 'combines_with_product', checked)}
              />
              <Checkbox
                checked={form.combines_with_shipping}
                label="Cumulable avec shipping discounts"
                onChange={(checked) => setFormValue(setForm, 'combines_with_shipping', checked)}
              />
            </CardContent>
          </Card>

          <Card className="border border-border/70 shadow-none">
            <CardContent className="space-y-3 p-4 text-sm">
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">{form.method === 'code' ? 'Code' : 'Automatique'}</Badge>
                <Badge variant="outline">{targetLabel(form.target_type)}</Badge>
              </div>
              <p className="text-muted-foreground">
                Ce formulaire écrit directement dans Shopify Admin API. Les discounts complexes restent en lecture seule
                pour l'instant.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </form>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-2 text-sm font-medium">
      <span>{label}</span>
      {children}
    </div>
  )
}

function SegmentedControl({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: Array<[string, string]>
  onChange: (value: string) => void
}) {
  return (
    <div className="grid gap-2">
      <div className="text-sm font-medium">{label}</div>
      <div className="flex flex-wrap gap-2">
        {options.map(([optionValue, optionLabel]) => (
          <button
            key={optionValue}
            type="button"
            onClick={() => onChange(optionValue)}
            className={`inline-flex h-9 items-center rounded-md border px-3 text-sm transition-colors ${
              value === optionValue
                ? 'border-foreground bg-foreground text-background'
                : 'border-input bg-background hover:bg-accent'
            }`}
          >
            {optionLabel}
          </button>
        ))}
      </div>
    </div>
  )
}

function ResourceCombobox({
  label,
  placeholder,
  resource,
  values,
  selected,
  onChange,
}: {
  label: string
  placeholder: string
  resource: 'collections' | 'products'
  values: string[]
  selected: ResourceOption[]
  onChange: (values: string[], selected: ResourceOption[]) => void
}) {
  const [search, setSearch] = React.useState('')
  const [after, setAfter] = React.useState<string | null>(null)
  const debouncedSearch = useDebouncedValue(search, 250)
  const query = useQuery<ResourceSearchData>(
    'discount-resource-search',
    { resource, search: debouncedSearch, after, limit: 25 },
    { staleTime: 30_000 },
  )
  const [options, setOptions] = React.useState<ResourceOption[]>([])

  React.useEffect(() => {
    if (!query.data) return
    setOptions((previous) => mergeOptions(after ? previous : [], query.data.items))
  }, [after, query.data])

  const selectedMap = React.useMemo(() => new Map(selected.map((item) => [item.id, item])), [selected])
  const pageInfo = query.data?.page_info
  const canLoadMore = Boolean(pageInfo?.hasNextPage && pageInfo.endCursor && !query.isFetching)

  const toggle = (option: ResourceOption) => {
    if (values.includes(option.id)) {
      const nextSelected = selected.filter((item) => item.id !== option.id)
      onChange(
        values.filter((id) => id !== option.id),
        nextSelected,
      )
      return
    }
    const nextSelected = mergeOptions(selected, [option])
    onChange([...values, option.id], nextSelected)
  }

  const remove = (id: string) => {
    onChange(
      values.filter((value) => value !== id),
      selected.filter((item) => item.id !== id),
    )
  }

  return (
    <Field label={label}>
      <div className="rounded-md border border-input bg-background">
        <div className="relative border-b">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="border-0 pl-9 shadow-none focus-visible:ring-0"
            onChange={(event) => {
              setAfter(null)
              setOptions([])
              setSearch(event.target.value)
            }}
            placeholder={placeholder}
            value={search}
          />
        </div>

        {selected.length > 0 ? (
          <div className="flex flex-wrap gap-2 border-b p-3">
            {selected.map((option) => (
              <button
                key={option.id}
                className="inline-flex max-w-full items-center gap-2 rounded-md border bg-muted px-2 py-1 text-xs"
                onClick={() => remove(option.id)}
                type="button"
              >
                <span className="truncate">{option.label}</span>
                {option.meta ? <span className="shrink-0 text-muted-foreground">{option.meta}</span> : null}
                <X className="size-3 shrink-0" />
              </button>
            ))}
          </div>
        ) : null}

        <div
          className="max-h-72 overflow-y-auto"
          onScroll={(event) => {
            const element = event.currentTarget
            const isNearBottom = element.scrollTop + element.clientHeight >= element.scrollHeight - 48
            if (isNearBottom && canLoadMore) setAfter(pageInfo?.endCursor ?? null)
          }}
        >
          {options.map((option) => {
            const isSelected = selectedMap.has(option.id)
            return (
              <button
                className="flex w-full items-center justify-between gap-3 border-b px-3 py-2 text-left text-sm last:border-b-0 hover:bg-accent"
                key={option.id}
                onClick={() => toggle(option)}
                type="button"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{option.label}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {[option.handle ? `/${option.handle}` : null, option.meta].filter(Boolean).join(' · ')}
                  </span>
                </span>
                {isSelected ? <Check className="size-4 shrink-0" /> : null}
              </button>
            )
          })}
          {query.isFetching ? (
            <div className="flex items-center gap-2 px-3 py-3 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Chargement
            </div>
          ) : null}
          {!query.isFetching && options.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-muted-foreground">Aucun résultat.</div>
          ) : null}
        </div>
      </div>
      <span className="text-xs font-normal text-muted-foreground">
        {values.length} sélectionné(s). Fais défiler pour charger la suite.
      </span>
    </Field>
  )
}

function Checkbox({
  checked,
  label,
  onChange,
}: {
  checked: boolean
  label: string
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input
        checked={checked}
        className="size-4 rounded border-input"
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
      />
      <span>{label}</span>
    </label>
  )
}

function LoadingState() {
  return (
    <div className="grid max-w-5xl gap-4">
      <Skeleton className="h-28 rounded-md" />
      <Skeleton className="h-96 rounded-md" />
    </div>
  )
}

function ErrorBox({ message }: { message: string }) {
  return <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">{message}</div>
}

function setFormValue<K extends keyof DiscountFormState>(
  setForm: React.Dispatch<React.SetStateAction<DiscountFormState>>,
  key: K,
  value: DiscountFormState[K],
) {
  setForm((previous) => ({ ...previous, [key]: value }))
}

function setMethod(
  setForm: React.Dispatch<React.SetStateAction<DiscountFormState>>,
  method: DiscountMethod,
  isEditing: boolean,
) {
  setForm((previous) => ({
    ...previous,
    method,
    applies_once_per_customer: method === 'code' && !isEditing ? true : previous.applies_once_per_customer,
  }))
}

function fromDetail(detail: DiscountDetail): DiscountFormState {
  return {
    id: detail.id,
    method: detail.method,
    title: detail.title,
    code: detail.code,
    value_type: detail.value_type,
    value: String(detail.value),
    target_type: detail.target_type,
    collection_ids: detail.collection_ids,
    product_ids: detail.product_ids,
    selected_collections: detail.selected_collections,
    selected_products: detail.selected_products,
    starts_at: toLocalDateTimeValue(detail.starts_at),
    ends_at: detail.ends_at ? toLocalDateTimeValue(detail.ends_at) : '',
    applies_once_per_customer: detail.applies_once_per_customer,
    usage_limit: detail.usage_limit ? String(detail.usage_limit) : '',
    combines_with_order: detail.combines_with_order,
    combines_with_product: detail.combines_with_product,
    combines_with_shipping: detail.combines_with_shipping,
  }
}

function toCommandInput(form: DiscountFormState): UpsertDiscountInput {
  return {
    id: form.id,
    method: form.method,
    title: form.title,
    code: form.code || undefined,
    value_type: form.value_type,
    value: Number(form.value),
    target_type: form.target_type,
    collection_ids: form.target_type === 'collections' ? form.collection_ids : [],
    product_ids: form.target_type === 'products' ? form.product_ids : [],
    starts_at: fromLocalDateTimeValue(form.starts_at),
    ends_at: form.ends_at ? fromLocalDateTimeValue(form.ends_at) : null,
    applies_once_per_customer: form.applies_once_per_customer,
    usage_limit: form.usage_limit ? Number(form.usage_limit) : null,
    combines_with_order: form.combines_with_order,
    combines_with_product: form.combines_with_product,
    combines_with_shipping: form.combines_with_shipping,
  }
}

function targetLabel(value: DiscountTargetType) {
  if (value === 'collections') return 'Collections'
  if (value === 'products') return 'Produits'
  return 'Toute la boutique'
}

function toLocalDateTimeValue(value: string): string {
  const date = new Date(value)
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

function fromLocalDateTimeValue(value: string): string {
  return new Date(value).toISOString()
}

function useDebouncedValue(value: string, delayMs: number): string {
  const [debounced, setDebounced] = React.useState(value)
  React.useEffect(() => {
    const timeout = window.setTimeout(() => setDebounced(value), delayMs)
    return () => window.clearTimeout(timeout)
  }, [delayMs, value])
  return debounced
}

function mergeOptions(previous: ResourceOption[], next: ResourceOption[]): ResourceOption[] {
  const byId = new Map(previous.map((option) => [option.id, option]))
  for (const option of next) byId.set(option.id, option)
  return [...byId.values()]
}
