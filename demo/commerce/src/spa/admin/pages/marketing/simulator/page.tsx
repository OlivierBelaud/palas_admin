import { useQuery } from '@mantajs/sdk'
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Progress, Skeleton } from '@mantajs/ui'
import { CalendarDays, Megaphone, PackagePlus, Play, RefreshCw, RotateCcw, Truck } from 'lucide-react'
import * as React from 'react'
import {
  type CustomerSegment,
  evaluateMarketingExperience,
  type MarketCode,
  type MarketingCampaign,
  type MarketingCartLine,
  type MarketingProduct,
  type ShippingThresholdRule,
} from '../../../../../modules/marketing-experience/engine'

interface SimulatorMarket {
  key: string
  id: string
  name: string
  handle: string
  status: string
  currency_code: string
  currency_name: string
  countries: Array<{ code: string; name: string; currency_code: string }>
}

interface SimulatorShippingThreshold {
  market_key: string
  market_name: string
  currency_code: string
  threshold: number
  paid_rate: number
  zone_name: string
  method_name: string
  free_method_id: string
  paid_method_id: string | null
  source: string
}

interface SimulatorConfig {
  meta: {
    generated_at: string
    shop_currency_code: string
  }
  markets: SimulatorMarket[]
  shipping_thresholds: SimulatorShippingThreshold[]
  shopify_discounts: SimulatorDiscount[]
}

interface SimulatorDiscount {
  id: string
  title: string
  type: string
  status: string
  starts_at: string | null
  ends_at: string | null
  summary: string
  value_type: 'percentage' | 'fixed_amount'
  value: number
  currency_code: string | null
  code: string | null
  source: 'shopify'
}

const PRODUCTS: MarketingProduct[] = [
  {
    id: 'necklace-alta-marea',
    title: 'Collier Alta Marea',
    price: 145,
    category: 'jewelry',
    collectionIds: ['jewelry'],
  },
  { id: 'necklace-no-jardim', title: 'Collier No Jardim', price: 165, category: 'jewelry', collectionIds: ['jewelry'] },
  { id: 'charm-soleil', title: 'Charm Soleil', price: 42, category: 'charm', collectionIds: ['charms'] },
  { id: 'charm-mystere', title: 'Charm mystere', price: 39, category: 'charm', collectionIds: ['charms'] },
  { id: 'tote-bag-palas', title: 'Tote bag Palas', price: 24, category: 'accessory', collectionIds: ['accessories'] },
]

const CUSTOMER_OPTIONS: Array<{ value: CustomerSegment; label: string }> = [
  { value: 'anonymous', label: 'Anonyme' },
  { value: 'new_customer', label: 'Nouveau client' },
  { value: 'returning_customer', label: 'Client existant' },
  { value: 'vip', label: 'VIP' },
]

export default function MarketingSimulatorPage() {
  const configQuery = useQuery<SimulatorConfig>('marketing-simulator-config', {}, { staleTime: 120_000 })
  const config = configQuery.data
  const [now, setNow] = React.useState(defaultDateTimeLocal)
  const [market, setMarket] = React.useState<MarketCode>('')
  const [customerSegment, setCustomerSegment] = React.useState<CustomerSegment>('new_customer')
  const [cart, setCart] = React.useState<MarketingCartLine[]>([
    { productId: 'necklace-alta-marea', quantity: 1 },
    { productId: 'charm-soleil', quantity: 1 },
  ])
  const campaigns = React.useMemo(() => buildCampaigns(config), [config])
  const [enabledCampaignIds, setEnabledCampaignIds] = React.useState<string[]>([])

  React.useEffect(() => {
    if (!config || market) return
    setMarket(defaultMarketKey(config.markets))
  }, [config, market])

  React.useEffect(() => {
    if (enabledCampaignIds.length > 0 || campaigns.length === 0) return
    setEnabledCampaignIds(campaigns.map((campaign) => campaign.id))
  }, [campaigns, enabledCampaignIds.length])

  const selectedMarket = config?.markets.find((item) => item.key === market) ?? null
  const selectedShippingThreshold = config?.shipping_thresholds.find((item) => item.market_key === market) ?? null
  const currencyCode =
    selectedShippingThreshold?.currency_code ??
    selectedMarket?.currency_code ??
    config?.meta.shop_currency_code ??
    'EUR'
  const activeCampaigns = React.useMemo(
    () =>
      campaigns.map((campaign) => ({
        ...campaign,
        status: enabledCampaignIds.includes(campaign.id) ? campaign.status : ('paused' as const),
      })),
    [campaigns, enabledCampaignIds],
  )
  const result = React.useMemo(
    () =>
      evaluateMarketingExperience({
        now: new Date(now).toISOString(),
        market,
        currencyCode,
        customerSegment,
        cart,
        campaigns: activeCampaigns,
        products: PRODUCTS,
      }),
    [activeCampaigns, cart, currencyCode, customerSegment, market, now],
  )

  if (configQuery.isLoading) return <LoadingState />
  if (configQuery.isError) return <ErrorState message={configQuery.error.message} />

  return (
    <div className="flex flex-col gap-4 pb-8">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-normal">Marketing simulator</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Dry-run des discounts, markets et seuils de livraison lus depuis Shopify.
          </p>
          {config ? (
            <div className="mt-2 text-xs text-muted-foreground">
              Shopify sync {formatDateTime(config.meta.generated_at)}
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="small"
            type="button"
            onClick={() => configQuery.refetch()}
            isLoading={configQuery.isFetching}
          >
            <RefreshCw className="mr-2 size-3.5" />
            Refresh Shopify
          </Button>
          <Button
            variant="outline"
            size="small"
            type="button"
            onClick={() => resetScenario(setNow, setMarket, setCustomerSegment, setCart, config?.markets ?? [])}
          >
            <RotateCcw className="mr-2 size-3.5" />
            Reset scenario
          </Button>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          <ScenarioCard
            now={now}
            market={market}
            markets={config?.markets ?? []}
            customerSegment={customerSegment}
            shippingThreshold={selectedShippingThreshold}
            onNowChange={setNow}
            onMarketChange={setMarket}
            onCustomerSegmentChange={setCustomerSegment}
          />
          <CartBuilder cart={cart} currencyCode={currencyCode} onCartChange={setCart} />
          <CampaignToggles
            campaigns={campaigns}
            enabledCampaignIds={enabledCampaignIds}
            onChange={setEnabledCampaignIds}
          />
        </div>

        <div className="flex flex-col gap-4">
          <SurfacePreview result={result} />
          <DecisionGrid result={result} />
        </div>
      </div>
    </div>
  )
}

function ScenarioCard({
  now,
  market,
  markets,
  customerSegment,
  shippingThreshold,
  onNowChange,
  onMarketChange,
  onCustomerSegmentChange,
}: {
  now: string
  market: MarketCode
  markets: SimulatorMarket[]
  customerSegment: CustomerSegment
  shippingThreshold: SimulatorShippingThreshold | null
  onNowChange: (value: string) => void
  onMarketChange: (value: MarketCode) => void
  onCustomerSegmentChange: (value: CustomerSegment) => void
}) {
  return (
    <Card className="border border-border/70 shadow-none">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base font-semibold tracking-normal">
          <CalendarDays className="size-4" />
          Scenario
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm" htmlFor="marketing-simulator-now">
          <span className="font-medium">Date de simulation</span>
          <Input
            id="marketing-simulator-now"
            type="datetime-local"
            value={now}
            onChange={(event) => onNowChange(event.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm" htmlFor="marketing-simulator-market">
          <span className="font-medium">Market Shopify</span>
          <select
            id="marketing-simulator-market"
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            value={market}
            onChange={(event) => onMarketChange(event.target.value)}
          >
            {markets.map((market) => (
              <option key={market.key} value={market.key}>
                {market.name} · {market.currency_code}
              </option>
            ))}
          </select>
        </label>
        {shippingThreshold ? (
          <div className="rounded-md border bg-muted/40 p-3 text-xs">
            <div className="font-medium">{shippingThreshold.source}</div>
            <div className="mt-1 text-muted-foreground">
              {formatMoney(shippingThreshold.paid_rate, shippingThreshold.currency_code)} puis offert des{' '}
              {formatMoney(shippingThreshold.threshold, shippingThreshold.currency_code)}
            </div>
          </div>
        ) : (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            Aucun seuil livraison Shopify trouve pour ce market.
          </div>
        )}
        <SegmentedControl
          label="Client"
          value={customerSegment}
          options={CUSTOMER_OPTIONS}
          onChange={(value) => onCustomerSegmentChange(value as CustomerSegment)}
        />
      </CardContent>
    </Card>
  )
}

function CartBuilder({
  cart,
  currencyCode,
  onCartChange,
}: {
  cart: MarketingCartLine[]
  currencyCode: string
  onCartChange: (cart: MarketingCartLine[]) => void
}) {
  const productMap = React.useMemo(() => new Map(PRODUCTS.map((product) => [product.id, product])), [])
  const subtotal = cart.reduce((sum, line) => sum + (productMap.get(line.productId)?.price ?? 0) * line.quantity, 0)

  return (
    <Card className="border border-border/70 shadow-none">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base font-semibold tracking-normal">
          <PackagePlus className="size-4" />
          Panier simule
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="grid gap-2">
          {PRODUCTS.map((product) => {
            const line = cart.find((item) => item.productId === product.id)
            return (
              <div key={product.id} className="flex items-center justify-between gap-3 rounded-md border p-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{product.title}</div>
                  <div className="text-xs text-muted-foreground">{formatMoney(product.price, currencyCode)}</div>
                </div>
                <div className="flex h-8 items-center rounded-md border">
                  <button
                    type="button"
                    className="h-8 w-8 text-sm"
                    onClick={() => updateQuantity(cart, product.id, (line?.quantity ?? 0) - 1, onCartChange)}
                  >
                    -
                  </button>
                  <span className="w-8 text-center text-sm">{line?.quantity ?? 0}</span>
                  <button
                    type="button"
                    className="h-8 w-8 text-sm"
                    onClick={() => updateQuantity(cart, product.id, (line?.quantity ?? 0) + 1, onCartChange)}
                  >
                    +
                  </button>
                </div>
              </div>
            )
          })}
        </div>
        <div className="flex items-center justify-between border-t pt-3 text-sm">
          <span className="text-muted-foreground">Subtotal</span>
          <span className="font-semibold">{formatMoney(subtotal, currencyCode)}</span>
        </div>
      </CardContent>
    </Card>
  )
}

function CampaignToggles({
  campaigns,
  enabledCampaignIds,
  onChange,
}: {
  campaigns: MarketingCampaign[]
  enabledCampaignIds: string[]
  onChange: (ids: string[]) => void
}) {
  return (
    <Card className="border border-border/70 shadow-none">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base font-semibold tracking-normal">
          <Play className="size-4" />
          Regles actives
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {campaigns.map((campaign) => {
          const enabled = enabledCampaignIds.includes(campaign.id)
          return (
            <button
              key={campaign.id}
              type="button"
              onClick={() =>
                onChange(
                  enabled
                    ? enabledCampaignIds.filter((id) => id !== campaign.id)
                    : [...enabledCampaignIds, campaign.id],
                )
              }
              className={`rounded-md border p-3 text-left text-sm transition-colors ${
                enabled
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-950'
                  : 'border-input bg-background text-muted-foreground'
              }`}
            >
              <div className="font-medium">{campaign.title}</div>
              <div className="mt-1 text-xs">{campaign.rules.map((rule) => rule.label).join(' · ')}</div>
            </button>
          )
        })}
      </CardContent>
    </Card>
  )
}

function SurfacePreview({ result }: { result: ReturnType<typeof evaluateMarketingExperience> }) {
  const next = result.progress.next
  const progressMax = result.progress.milestones.at(-1)?.amount ?? Math.max(result.subtotal, 1)
  const progressValue = Math.min(100, (result.progress.current / progressMax) * 100)

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="border border-border/70 shadow-none">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base font-semibold tracking-normal">
            <Megaphone className="size-4" />
            Announcement bar
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-md bg-foreground px-4 py-3 text-center text-sm font-medium text-background">
            {result.announcements[0] ?? 'Livraison offerte selon votre pays'}
          </div>
        </CardContent>
      </Card>

      <Card className="border border-border/70 shadow-none">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base font-semibold tracking-normal">
            <Truck className="size-4" />
            Progress cart
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="text-sm font-medium">
            {next
              ? `Encore ${formatMoney(next.remaining, result.currencyCode)} pour ${next.label.toLowerCase()}`
              : 'Tous les avantages panier sont debloques'}
          </div>
          <Progress value={progressValue} className="h-2" />
          <div className="flex flex-wrap gap-2">
            {result.progress.milestones.map((milestone) => (
              <Badge
                key={milestone.id}
                variant="outline"
                className={milestone.reached ? 'border-emerald-200 bg-emerald-50' : ''}
              >
                {milestone.label} · {formatMoney(milestone.amount, result.currencyCode)}
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function DecisionGrid({ result }: { result: ReturnType<typeof evaluateMarketingExperience> }) {
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <Card className="border border-border/70 shadow-none">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold tracking-normal">Decision engine</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="border-y bg-muted/40 text-left text-xs uppercase tracking-normal text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Regle</th>
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 font-medium">Impact</th>
                  <th className="px-4 py-3 font-medium">Execution</th>
                </tr>
              </thead>
              <tbody>
                {result.appliedRules.map((rule) => (
                  <tr key={`${rule.campaignId}-${rule.ruleId}`} className="border-b align-top last:border-b-0">
                    <td className="px-4 py-3">
                      <div className="font-medium">{rule.label}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{rule.campaignTitle}</div>
                    </td>
                    <td className="px-4 py-3">{kindLabel(rule.kind)}</td>
                    <td className="px-4 py-3">{rule.impact}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {rule.execution.map((channel) => (
                          <Badge key={channel} variant="outline" className="text-[11px]">
                            {channel}
                          </Badge>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-4">
        <SummaryCard result={result} />
        <PlanCard result={result} />
      </div>
    </div>
  )
}

function SummaryCard({ result }: { result: ReturnType<typeof evaluateMarketingExperience> }) {
  return (
    <Card className="border border-border/70 shadow-none">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold tracking-normal">Panier calcule</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2 text-sm">
        <SummaryRow label="Subtotal" value={formatMoney(result.subtotal, result.currencyCode)} />
        <SummaryRow label="Discounts" value={`-${formatMoney(result.discountTotal, result.currencyCode)}`} />
        <SummaryRow label="Livraison estimee" value={formatMoney(result.estimatedShipping, result.currencyCode)} />
        <SummaryRow label="Total avant taxes" value={formatMoney(result.totalBeforeTax, result.currencyCode)} strong />
      </CardContent>
    </Card>
  )
}

function PlanCard({ result }: { result: ReturnType<typeof evaluateMarketingExperience> }) {
  return (
    <Card className="border border-border/70 shadow-none">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold tracking-normal">Plan backend</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2 text-xs">
        {result.shopifyPlan.map((step) => (
          <div key={`${step.sourceRuleId}-${step.channel}`} className="rounded-md bg-muted p-2">
            <div className="font-medium">{step.channel}</div>
            <div className="mt-1 text-muted-foreground">{step.action}</div>
          </div>
        ))}
        {result.warnings.map((warning) => (
          <div key={warning} className="rounded-md border border-amber-200 bg-amber-50 p-2 text-amber-900">
            {warning}
          </div>
        ))}
      </CardContent>
    </Card>
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
  options: Array<{ value: string; label: string }>
  onChange: (value: string) => void
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm font-medium">{label}</span>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={`inline-flex h-9 items-center rounded-md border px-3 text-sm transition-colors ${
              value === option.value
                ? 'border-foreground bg-foreground text-background'
                : 'border-input bg-background hover:bg-accent'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function SummaryRow({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex items-center justify-between ${strong ? 'border-t pt-2 font-semibold' : ''}`}>
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  )
}

function updateQuantity(
  cart: MarketingCartLine[],
  productId: string,
  quantity: number,
  onCartChange: (cart: MarketingCartLine[]) => void,
) {
  if (quantity <= 0) {
    onCartChange(cart.filter((line) => line.productId !== productId))
    return
  }
  const exists = cart.some((line) => line.productId === productId)
  if (!exists) {
    onCartChange([...cart, { productId, quantity }])
    return
  }
  onCartChange(cart.map((line) => (line.productId === productId ? { ...line, quantity } : line)))
}

function resetScenario(
  setNow: (value: string) => void,
  setMarket: (value: MarketCode) => void,
  setCustomerSegment: (value: CustomerSegment) => void,
  setCart: (value: MarketingCartLine[]) => void,
  markets: SimulatorMarket[],
) {
  setNow(defaultDateTimeLocal())
  setMarket(defaultMarketKey(markets))
  setCustomerSegment('new_customer')
  setCart([
    { productId: 'necklace-alta-marea', quantity: 1 },
    { productId: 'charm-soleil', quantity: 1 },
  ])
}

function buildCampaigns(config: SimulatorConfig | undefined): MarketingCampaign[] {
  const thresholds = Object.fromEntries(
    (config?.shipping_thresholds ?? []).map((threshold) => [
      threshold.market_key,
      {
        amount: threshold.threshold,
        paidRate: threshold.paid_rate,
        currencyCode: threshold.currency_code,
        source: threshold.source,
      },
    ]),
  ) as ShippingThresholdRule['thresholds']

  const shippingCampaign: MarketingCampaign = {
    id: 'shopify-shipping',
    title: 'Livraison Shopify par market',
    status: 'active',
    startsAt: '2020-01-01T00:00:00.000Z',
    endsAt: null,
    priority: 10,
    rules: [
      {
        id: 'shopify-shipping-thresholds',
        kind: 'shipping_threshold',
        label: 'Seuils livraison Shopify',
        enabled: true,
        execution: ['shipping_profile', 'theme_surface', 'email_copy'],
        thresholds,
      },
    ],
  }

  const shopifyDiscountCampaigns = (config?.shopify_discounts ?? [])
    .filter((discount) => discount.status === 'ACTIVE' || discount.status === 'SCHEDULED')
    .map((discount, index): MarketingCampaign => {
      const startsAt = discount.starts_at ?? '2020-01-01T00:00:00.000Z'
      return {
        id: `shopify-discount-${discount.id}`,
        title: discount.title,
        status: 'active',
        startsAt,
        endsAt: discount.ends_at,
        priority: 100 - index,
        rules: [
          {
            id: `shopify-discount-rule-${discount.id}`,
            kind: 'order_discount',
            label: discount.title,
            enabled: true,
            execution: ['shopify_discount', 'theme_surface', 'email_copy'],
            valueType: discount.value_type === 'fixed_amount' ? 'fixed_amount' : 'percentage',
            value: discount.value,
            target: { type: 'all' },
            code: discount.code,
            combinableWith: ['shipping_threshold'],
          },
        ],
      }
    })

  return [...shopifyDiscountCampaigns, shippingCampaign]
}

function defaultMarketKey(markets: SimulatorMarket[]): string {
  return markets.find((market) => market.handle === 'fr')?.key ?? markets[0]?.key ?? ''
}

function defaultDateTimeLocal(): string {
  const date = new Date()
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset())
  return date.toISOString().slice(0, 16)
}

function kindLabel(kind: string): string {
  if (kind === 'order_discount') return 'Discount'
  if (kind === 'shipping_threshold') return 'Livraison'
  if (kind === 'gift_threshold') return 'Cadeau seuil'
  if (kind === 'gift_with_purchase') return 'Cadeau achat'
  if (kind === 'announcement') return 'Annonce'
  return kind
}

function LoadingState() {
  return (
    <div className="grid gap-4">
      <Skeleton className="h-24 rounded-md" />
      <Skeleton className="h-96 rounded-md" />
    </div>
  )
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
      Impossible de charger les donnees Shopify du simulateur: {message}
    </div>
  )
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

function formatMoney(value: number, currencyCode: string): string {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: currencyCode }).format(value)
}
