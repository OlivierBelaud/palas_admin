import { useQuery } from '@mantajs/sdk'
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Skeleton } from '@mantajs/ui'
import { Edit3, Plus, RefreshCw, Search } from 'lucide-react'
import * as React from 'react'
import { Link } from 'react-router-dom'

type DiscountGroup = 'shop' | 'individual'

interface DiscountRow {
  id: string
  shopify_id: string
  title: string
  type: string
  method: 'automatic' | 'code' | 'app' | 'unknown'
  group: DiscountGroup
  status: string
  is_active: boolean
  starts_at: string | null
  ends_at: string | null
  updated_at: string | null
  usage_count: number
  usage_limit: number | null
  applies_once_per_customer: boolean
  codes_count: number | null
  sample_codes: string[]
  discount_classes: string[]
  combines_with: string[]
  summary: string
  classification_reason: string
}

interface DiscountListData {
  meta: {
    generated_at: string
    total: number
    active: number
    shop: number
    individual: number
  }
  shop: DiscountRow[]
  individual: DiscountRow[]
}

type StatusFilter = 'all' | 'active' | 'scheduled' | 'expired'
type DiscountViewMode = 'shop' | 'individual'

export default function DiscountsPage() {
  return <DiscountsView mode="shop" />
}

export function DiscountsView({ mode }: { mode: DiscountViewMode }) {
  const [search, setSearch] = React.useState('')
  const [status, setStatus] = React.useState<StatusFilter>('all')
  const query = useQuery<DiscountListData>('discount-list', { limit: 500 }, { staleTime: 60_000 })
  const data = query.data

  const selectedRows = React.useMemo(
    () => filterRows(mode === 'shop' ? (data?.shop ?? []) : (data?.individual ?? []), search, status),
    [data?.individual, data?.shop, mode, search, status],
  )
  const copy = viewCopy(mode)

  return (
    <div className="flex flex-col gap-4 pb-8">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-normal">{copy.heading}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{copy.intro}</p>
          {data ? (
            <div className="mt-2 flex flex-wrap gap-2 text-sm">
              <Badge variant="outline">{data.meta.total} discounts</Badge>
              <Badge variant="outline">{data.meta.active} actifs</Badge>
              <Badge variant="outline">{data.meta.shop} boutique</Badge>
              <Badge variant="outline">{data.meta.individual} individual</Badge>
              <span className="text-muted-foreground">Mis à jour {formatDateTime(data.meta.generated_at)}</span>
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {mode === 'shop' ? (
            <Button asChild size="small">
              <Link to="/discounts/create">
                <Plus className="mr-2 h-3.5 w-3.5" />
                Créer un discount
              </Link>
            </Button>
          ) : null}
          <Button variant="outline" size="small" onClick={() => query.refetch()} isLoading={query.isFetching}>
            <RefreshCw className="mr-2 h-3.5 w-3.5" />
            Rafraîchir
          </Button>
        </div>
      </div>

      <Card className="border border-border/70 shadow-none">
        <CardContent className="flex flex-col gap-3 p-4 md:flex-row md:items-center">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Chercher par titre, code, résumé, type..."
              className="pl-9"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {(['all', 'active', 'scheduled', 'expired'] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setStatus(value)}
                className={`inline-flex h-9 items-center rounded-md border px-3 text-sm transition-colors ${
                  status === value
                    ? 'border-foreground bg-foreground text-background'
                    : 'border-input bg-background hover:bg-accent'
                }`}
              >
                {statusLabel(value)}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {query.isLoading ? <LoadingState /> : null}
      {query.isError ? <ErrorState message={query.error.message} /> : null}
      {data ? <DiscountTable title={copy.tableTitle} description={copy.tableDescription} rows={selectedRows} /> : null}
    </div>
  )
}

function DiscountTable({ title, description, rows }: { title: string; description: string; rows: DiscountRow[] }) {
  return (
    <Card className="border border-border/70 shadow-none">
      <CardHeader className="pb-3">
        <div className="flex flex-col gap-1 md:flex-row md:items-start md:justify-between">
          <div>
            <CardTitle className="text-base font-semibold tracking-normal">{title}</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          </div>
          <Badge variant="outline">{rows.length}</Badge>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1040px] text-sm">
            <thead className="border-y bg-muted/40 text-left text-xs uppercase tracking-normal text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Discount</th>
                <th className="px-4 py-3 font-medium">Statut</th>
                <th className="px-4 py-3 font-medium">Méthode</th>
                <th className="px-4 py-3 font-medium">Codes</th>
                <th className="px-4 py-3 font-medium">Usage</th>
                <th className="px-4 py-3 font-medium">Fenêtre</th>
                <th className="px-4 py-3 font-medium">Cumul</th>
                <th className="px-4 py-3 font-medium">Classement</th>
                <th className="px-4 py-3 font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td className="px-4 py-8 text-center text-muted-foreground" colSpan={9}>
                    Aucun discount dans cette vue.
                  </td>
                </tr>
              ) : (
                rows.map((row) => <DiscountTableRow key={row.id} row={row} />)
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}

function DiscountTableRow({ row }: { row: DiscountRow }) {
  return (
    <tr className="border-b align-top last:border-b-0">
      <td className="max-w-[360px] px-4 py-3">
        <div className="font-medium text-foreground">{row.title}</div>
        <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{row.summary || row.type}</div>
        <div className="mt-2 flex flex-wrap gap-1">
          {row.discount_classes.map((name) => (
            <Badge key={name} variant="outline" className="text-[11px]">
              {name}
            </Badge>
          ))}
        </div>
      </td>
      <td className="px-4 py-3">
        <StatusBadge row={row} />
      </td>
      <td className="px-4 py-3">
        <Badge variant="outline">{methodLabel(row.method)}</Badge>
        <div className="mt-1 text-xs text-muted-foreground">{typeLabel(row.type)}</div>
      </td>
      <td className="max-w-[180px] px-4 py-3">
        <div>{row.codes_count === null ? '-' : formatNumber(row.codes_count)}</div>
        {row.sample_codes.length > 0 ? (
          <div className="mt-1 flex flex-wrap gap-1">
            {row.sample_codes.slice(0, 3).map((code) => (
              <code key={code} className="rounded bg-muted px-1.5 py-0.5 text-[11px]">
                {code}
              </code>
            ))}
          </div>
        ) : null}
      </td>
      <td className="px-4 py-3">
        <div>{formatNumber(row.usage_count)} utilisations</div>
        <div className="mt-1 text-xs text-muted-foreground">
          {row.usage_limit ? `limite ${formatNumber(row.usage_limit)}` : 'sans limite'}
          {row.applies_once_per_customer ? ' · 1/client' : ''}
        </div>
      </td>
      <td className="min-w-[170px] px-4 py-3 text-xs">
        <div>Début {row.starts_at ? formatDateTime(row.starts_at) : '-'}</div>
        <div className="mt-1 text-muted-foreground">Fin {row.ends_at ? formatDateTime(row.ends_at) : 'aucune'}</div>
      </td>
      <td className="px-4 py-3">
        {row.combines_with.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {row.combines_with.map((value) => (
              <Badge key={value} variant="outline" className="text-[11px]">
                {value}
              </Badge>
            ))}
          </div>
        ) : (
          <span className="text-muted-foreground">-</span>
        )}
      </td>
      <td className="max-w-[180px] px-4 py-3 text-xs text-muted-foreground">{row.classification_reason}</td>
      <td className="px-4 py-3">
        {isEditable(row) ? (
          <Button asChild variant="outline" size="small">
            <Link to={`/discounts/${encodeURIComponent(row.id)}/edit`}>
              <Edit3 className="mr-2 h-3.5 w-3.5" />
              Editer
            </Link>
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground">Lecture seule</span>
        )}
      </td>
    </tr>
  )
}

function StatusBadge({ row }: { row: DiscountRow }) {
  const cls = row.status === 'ACTIVE' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : statusClass(row.status)
  return <span className={`inline-flex rounded-md border px-2 py-1 text-xs font-medium ${cls}`}>{row.status}</span>
}

function LoadingState() {
  return (
    <div className="grid gap-4">
      <Skeleton className="h-48 rounded-md" />
      <Skeleton className="h-48 rounded-md" />
    </div>
  )
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
      Impossible de charger les discounts Shopify: {message}
    </div>
  )
}

function filterRows(rows: DiscountRow[], search: string, status: StatusFilter): DiscountRow[] {
  const needle = search.trim().toLowerCase()
  return rows.filter((row) => {
    if (status === 'active' && !row.is_active) return false
    if (status === 'scheduled' && row.status !== 'SCHEDULED') return false
    if (status === 'expired' && row.status !== 'EXPIRED') return false
    if (!needle) return true
    return [row.title, row.type, row.status, row.summary, row.classification_reason, ...row.sample_codes]
      .join(' ')
      .toLowerCase()
      .includes(needle)
  })
}

function statusLabel(status: StatusFilter): string {
  if (status === 'active') return 'Actifs'
  if (status === 'scheduled') return 'Planifiés'
  if (status === 'expired') return 'Expirés'
  return 'Tous'
}

function viewCopy(mode: DiscountViewMode): {
  heading: string
  intro: string
  tableTitle: string
  tableDescription: string
} {
  if (mode === 'individual') {
    return {
      heading: 'Individual discounts',
      intro: 'Coupons lifecycle, welcome, Klaviyo, abandoned cart ou codes one-shot rattachés à un client.',
      tableTitle: 'Individual discounts',
      tableDescription: 'Promos individuelles et pools de coupons qui ne décrivent pas une opération boutique globale.',
    }
  }
  return {
    heading: 'Discounts boutique',
    intro: 'Promos globales, automatiques ou codes publics qui décrivent une opération commerciale Palas.',
    tableTitle: 'Discounts boutique',
    tableDescription: 'Vue live Shopify Admin API, classée pour préparer le moteur promotionnel Palas.',
  }
}

function statusClass(status: string): string {
  if (status === 'SCHEDULED') return 'border-blue-200 bg-blue-50 text-blue-800'
  if (status === 'EXPIRED') return 'border-slate-200 bg-slate-50 text-slate-700'
  return 'border-amber-200 bg-amber-50 text-amber-800'
}

function methodLabel(method: DiscountRow['method']): string {
  if (method === 'automatic') return 'Automatique'
  if (method === 'code') return 'Code'
  if (method === 'app') return 'App'
  return 'Inconnu'
}

function typeLabel(type: string): string {
  return type.replace(/^Discount/, '').replace(/([a-z])([A-Z])/g, '$1 $2')
}

function isEditable(row: DiscountRow): boolean {
  return row.type === 'DiscountCodeBasic' || row.type === 'DiscountAutomaticBasic'
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('fr-FR').format(value)
}
