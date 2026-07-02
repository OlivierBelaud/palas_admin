import { useCommand, useQuery } from '@mantajs/sdk'
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Progress, Skeleton } from '@mantajs/ui'
import { CalendarDays, Megaphone, PackagePlus, Play, RefreshCw, RotateCcw, Save, Tags, Truck } from 'lucide-react'
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
  palas_rules: PalasRule[]
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

type PalasRuleType = 'order_discount' | 'first_order_discount' | 'gift_threshold' | 'shipping_threshold'

interface PalasRule {
  id: string
  title: string
  rule_type: PalasRuleType
  status: 'draft' | 'active' | 'paused'
  starts_at: string
  ends_at: string | null
  execution_kind: 'shopify_discount' | 'local_cart_rule' | 'shipping_profile'
  sync_status: 'local_only' | 'synced' | 'pending' | 'error'
  shopify_id: string | null
  sync_error: string | null
  market_key: string | null
  currency_code: string | null
  value_type: 'percentage' | 'fixed_amount' | null
  value: number | null
  code: string | null
  threshold: number | null
  gift_product_id: string | null
  gift_title: string | null
  paid_rate: number | null
  source: 'palas'
}

interface MarketingRuleFormState {
  rule_type: PalasRuleType
  title: string
  starts_at: string
  ends_at: string
  market_key: string
  currency_code: string
  value_type: 'percentage' | 'fixed_amount'
  value: string
  code: string
  threshold: string
  gift_title: string
  gift_product_id: string
  paid_rate: string
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

type UpsertMarketingRuleInput = {
  title: string
  rule_type: PalasRuleType
  status: 'active'
  starts_at: string
  ends_at?: string | null
  market_key?: string | null
  currency_code?: string | null
  value_type?: 'percentage' | 'fixed_amount' | null
  value?: number | null
  code?: string | null
  threshold?: number | null
  gift_product_id?: string | null
  gift_title?: string | null
  paid_rate?: number | null
}

export default function MarketingSimulatorPage() {
  const configQuery = useQuery<SimulatorConfig>('marketing-simulator-config', {}, { staleTime: 120_000 })
  const upsertMarketingRule = useCommand<UpsertMarketingRuleInput, PalasRule>('upsertMarketingRule')
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
  const [ruleForm, setRuleForm] = React.useState<MarketingRuleFormState>(() => initialRuleForm('', 'EUR'))
  const [ruleFormError, setRuleFormError] = React.useState<string | null>(null)

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

  React.useEffect(() => {
    if (!config || ruleForm.market_key) return
    const key = defaultMarketKey(config.markets)
    const market = config.markets.find((item) => item.key === key)
    setRuleForm((current) => ({
      ...current,
      market_key: key,
      currency_code: market?.currency_code ?? config.meta.shop_currency_code,
    }))
  }, [config, ruleForm.market_key])

  const submitMarketingRule = async (event: React.FormEvent) => {
    event.preventDefault()
    setRuleFormError(null)
    try {
      const input = toMarketingRuleInput(ruleForm, config?.meta.shop_currency_code ?? currencyCode)
      const result = await upsertMarketingRule.run(input)
      if (result.status === 'succeeded') {
        setRuleForm(initialRuleForm(ruleForm.market_key, ruleForm.currency_code || currencyCode))
        await configQuery.refetch()
        return
      }
      if (result.status !== 'running') setRuleFormError(result.error.message)
    } catch (err) {
      setRuleFormError(err instanceof Error ? err.message : String(err))
    }
  }

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
          <RuleBuilder
            form={ruleForm}
            markets={config?.markets ?? []}
            isSaving={upsertMarketingRule.status === 'running'}
            error={ruleFormError ?? upsertMarketingRule.error?.message ?? null}
            onChange={setRuleForm}
            onSubmit={submitMarketingRule}
          />
          <CampaignToggles
            campaigns={campaigns}
            enabledCampaignIds={enabledCampaignIds}
            onChange={setEnabledCampaignIds}
          />
        </div>

        <div className="flex flex-col gap-4">
          <SurfacePreview result={result} />
          <PalasRuleTable rules={config?.palas_rules ?? []} />
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

function RuleBuilder({
  form,
  markets,
  isSaving,
  error,
  onChange,
  onSubmit,
}: {
  form: MarketingRuleFormState
  markets: SimulatorMarket[]
  isSaving: boolean
  error: string | null
  onChange: React.Dispatch<React.SetStateAction<MarketingRuleFormState>>
  onSubmit: (event: React.FormEvent) => void
}) {
  const selectedMarket = markets.find((market) => market.key === form.market_key)

  return (
    <Card className="border border-border/70 shadow-none">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base font-semibold tracking-normal">
          <Tags className="size-4" />
          Nouvelle regle
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form className="flex flex-col gap-4" onSubmit={onSubmit}>
          {error ? (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-800">{error}</div>
          ) : null}
          <SegmentedControl
            label="Type"
            value={form.rule_type}
            options={[
              { value: 'order_discount', label: 'Remise' },
              { value: 'first_order_discount', label: '1ere commande' },
              { value: 'gift_threshold', label: 'Cadeau' },
              { value: 'shipping_threshold', label: 'Livraison' },
            ]}
            onChange={(value) => onChange((current) => ({ ...current, rule_type: value as PalasRuleType }))}
          />
          <label className="flex flex-col gap-1 text-sm" htmlFor="marketing-rule-title">
            <span className="font-medium">Titre</span>
            <Input
              id="marketing-rule-title"
              value={form.title}
              onChange={(event) => setRuleField(onChange, 'title', event.target.value)}
              placeholder={placeholderForRule(form.rule_type)}
              required
            />
          </label>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm" htmlFor="marketing-rule-starts-at">
              <span className="font-medium">Debut</span>
              <Input
                id="marketing-rule-starts-at"
                type="datetime-local"
                value={form.starts_at}
                onChange={(event) => setRuleField(onChange, 'starts_at', event.target.value)}
                required
              />
            </label>
            <label className="flex flex-col gap-1 text-sm" htmlFor="marketing-rule-ends-at">
              <span className="font-medium">Fin</span>
              <Input
                id="marketing-rule-ends-at"
                type="datetime-local"
                value={form.ends_at}
                onChange={(event) => setRuleField(onChange, 'ends_at', event.target.value)}
              />
            </label>
          </div>

          {form.rule_type === 'order_discount' || form.rule_type === 'first_order_discount' ? (
            <div className="grid gap-3 md:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm" htmlFor="marketing-rule-value-type">
                <span className="font-medium">Type remise</span>
                <select
                  id="marketing-rule-value-type"
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                  value={form.value_type}
                  onChange={(event) =>
                    setRuleField(onChange, 'value_type', event.target.value as MarketingRuleFormState['value_type'])
                  }
                >
                  <option value="percentage">Pourcentage</option>
                  <option value="fixed_amount">Montant fixe</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm" htmlFor="marketing-rule-value">
                <span className="font-medium">{form.value_type === 'percentage' ? 'Pourcentage' : 'Montant'}</span>
                <Input
                  id="marketing-rule-value"
                  type="number"
                  min="0"
                  step={form.value_type === 'percentage' ? '1' : '0.01'}
                  value={form.value}
                  onChange={(event) => setRuleField(onChange, 'value', event.target.value)}
                  required
                />
              </label>
              <label className="flex flex-col gap-1 text-sm md:col-span-2" htmlFor="marketing-rule-code">
                <span className="font-medium">Code public</span>
                <Input
                  id="marketing-rule-code"
                  value={form.code}
                  onChange={(event) => setRuleField(onChange, 'code', event.target.value.toUpperCase())}
                  placeholder="Vide = automatique"
                />
              </label>
            </div>
          ) : null}

          {form.rule_type === 'gift_threshold' ? (
            <div className="grid gap-3 md:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm" htmlFor="marketing-rule-gift-threshold">
                <span className="font-medium">Seuil</span>
                <Input
                  id="marketing-rule-gift-threshold"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.threshold}
                  onChange={(event) => setRuleField(onChange, 'threshold', event.target.value)}
                  required
                />
              </label>
              <label className="flex flex-col gap-1 text-sm" htmlFor="marketing-rule-gift-title">
                <span className="font-medium">Produit offert</span>
                <Input
                  id="marketing-rule-gift-title"
                  value={form.gift_title}
                  onChange={(event) => setRuleField(onChange, 'gift_title', event.target.value)}
                  placeholder="Charm mystere"
                  required
                />
              </label>
            </div>
          ) : null}

          {form.rule_type === 'shipping_threshold' ? (
            <div className="grid gap-3 md:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm md:col-span-2" htmlFor="marketing-rule-market">
                <span className="font-medium">Market</span>
                <select
                  id="marketing-rule-market"
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                  value={form.market_key}
                  onChange={(event) => {
                    const market = markets.find((item) => item.key === event.target.value)
                    onChange((current) => ({
                      ...current,
                      market_key: event.target.value,
                      currency_code: market?.currency_code ?? current.currency_code,
                    }))
                  }}
                  required
                >
                  {markets.map((market) => (
                    <option key={market.key} value={market.key}>
                      {market.name} · {market.currency_code}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm" htmlFor="marketing-rule-shipping-threshold">
                <span className="font-medium">Seuil offert</span>
                <Input
                  id="marketing-rule-shipping-threshold"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.threshold}
                  onChange={(event) => setRuleField(onChange, 'threshold', event.target.value)}
                  required
                />
              </label>
              <label className="flex flex-col gap-1 text-sm" htmlFor="marketing-rule-paid-rate">
                <span className="font-medium">Tarif avant seuil</span>
                <Input
                  id="marketing-rule-paid-rate"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.paid_rate}
                  onChange={(event) => setRuleField(onChange, 'paid_rate', event.target.value)}
                  required
                />
              </label>
              <div className="text-xs text-muted-foreground md:col-span-2">
                Devise: {selectedMarket?.currency_code ?? form.currency_code}
              </div>
            </div>
          ) : null}

          <Button type="submit" size="small" isLoading={isSaving}>
            <Save className="mr-2 size-3.5" />
            Enregistrer
          </Button>
        </form>
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

function PalasRuleTable({ rules }: { rules: PalasRule[] }) {
  return (
    <Card className="border border-border/70 shadow-none">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold tracking-normal">Regles Palas</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {rules.length === 0 ? (
          <div className="px-4 py-6 text-sm text-muted-foreground">
            Aucune regle Palas locale enregistree pour le moment.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-y bg-muted/40 text-left text-xs uppercase tracking-normal text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Regle</th>
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 font-medium">Fenetre</th>
                  <th className="px-4 py-3 font-medium">Execution</th>
                  <th className="px-4 py-3 font-medium">Sync</th>
                </tr>
              </thead>
              <tbody>
                {rules.map((rule) => (
                  <tr key={rule.id} className="border-b align-top last:border-b-0">
                    <td className="px-4 py-3">
                      <div className="font-medium">{rule.title}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{ruleSummary(rule)}</div>
                    </td>
                    <td className="px-4 py-3">{kindLabel(rule.rule_type)}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      <div>{formatDateTime(rule.starts_at)}</div>
                      <div>{rule.ends_at ? formatDateTime(rule.ends_at) : 'Sans fin'}</div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant="outline">{rule.execution_kind}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1">
                        <Badge variant="outline" className={syncBadgeClass(rule.sync_status)}>
                          {rule.sync_status}
                        </Badge>
                        {rule.sync_error ? <span className="text-xs text-red-700">{rule.sync_error}</span> : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
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

  const palasCampaigns = (config?.palas_rules ?? [])
    .filter((rule) => rule.execution_kind !== 'shopify_discount')
    .map((rule, index) => palasRuleToCampaign(rule, index))
    .filter((campaign): campaign is MarketingCampaign => Boolean(campaign))

  return [...palasCampaigns, ...shopifyDiscountCampaigns, shippingCampaign]
}

function palasRuleToCampaign(rule: PalasRule, index: number): MarketingCampaign | null {
  const base = {
    id: `palas-rule-${rule.id}`,
    title: rule.title,
    status: rule.status,
    startsAt: rule.starts_at,
    endsAt: rule.ends_at,
    priority: rule.rule_type === 'shipping_threshold' ? 250 - index : 200 - index,
  } satisfies Omit<MarketingCampaign, 'rules'>

  if (rule.rule_type === 'first_order_discount' && rule.value_type && rule.value != null) {
    return {
      ...base,
      rules: [
        {
          id: `palas-first-order-${rule.id}`,
          kind: 'order_discount',
          label: rule.title,
          enabled: true,
          execution: ['email_copy', 'theme_surface'],
          customerSegments: ['new_customer'],
          exclusiveGroup: 'first_order_discount',
          valueType: rule.value_type,
          value: rule.value,
          target: { type: 'all' },
          code: rule.code,
          combinableWith: ['shipping_threshold'],
        },
      ],
    }
  }

  if (rule.rule_type === 'gift_threshold' && rule.threshold != null && rule.gift_title) {
    return {
      ...base,
      rules: [
        {
          id: `palas-gift-${rule.id}`,
          kind: 'gift_threshold',
          label: rule.title,
          enabled: true,
          execution: ['cart_transform', 'theme_surface', 'email_copy'],
          threshold: rule.threshold,
          giftProductId: rule.gift_product_id ?? `palas-gift-${rule.id}`,
          giftTitle: rule.gift_title,
        },
      ],
    }
  }

  if (rule.rule_type === 'shipping_threshold' && rule.market_key && rule.threshold != null && rule.paid_rate != null) {
    return {
      ...base,
      rules: [
        {
          id: `palas-shipping-${rule.id}`,
          kind: 'shipping_threshold',
          label: rule.title,
          enabled: true,
          execution: ['shipping_profile', 'theme_surface', 'email_copy'],
          markets: [rule.market_key],
          thresholds: {
            [rule.market_key]: {
              amount: rule.threshold,
              paidRate: rule.paid_rate,
              currencyCode: rule.currency_code ?? 'EUR',
              source: 'Palas marketing rule',
            },
          },
        },
      ],
    }
  }

  return null
}

function initialRuleForm(marketKey: string, currencyCode: string): MarketingRuleFormState {
  return {
    rule_type: 'gift_threshold',
    title: '',
    starts_at: defaultDateTimeLocal(),
    ends_at: '',
    market_key: marketKey,
    currency_code: currencyCode,
    value_type: 'percentage',
    value: '15',
    code: '',
    threshold: '150',
    gift_title: '',
    gift_product_id: '',
    paid_rate: '6',
  }
}

function toMarketingRuleInput(form: MarketingRuleFormState, fallbackCurrencyCode: string): UpsertMarketingRuleInput {
  const base = {
    title: form.title,
    rule_type: form.rule_type,
    status: 'active' as const,
    starts_at: localDateTimeToIso(form.starts_at),
    ends_at: form.ends_at ? localDateTimeToIso(form.ends_at) : null,
  }

  if (form.rule_type === 'order_discount' || form.rule_type === 'first_order_discount') {
    return {
      ...base,
      value_type: form.value_type,
      value: readPositiveNumber(form.value, 'Valeur remise'),
      code: form.code || null,
    }
  }

  if (form.rule_type === 'shipping_threshold') {
    return {
      ...base,
      market_key: form.market_key,
      currency_code: form.currency_code || fallbackCurrencyCode,
      threshold: readZeroOrPositiveNumber(form.threshold, 'Seuil livraison'),
      paid_rate: readZeroOrPositiveNumber(form.paid_rate, 'Tarif livraison'),
    }
  }

  return {
    ...base,
    threshold: readZeroOrPositiveNumber(form.threshold, 'Seuil cadeau'),
    gift_title: form.gift_title,
    gift_product_id: form.gift_product_id || null,
  }
}

function setRuleField<Key extends keyof MarketingRuleFormState>(
  setForm: React.Dispatch<React.SetStateAction<MarketingRuleFormState>>,
  key: Key,
  value: MarketingRuleFormState[Key],
) {
  setForm((current) => ({ ...current, [key]: value }))
}

function placeholderForRule(ruleType: PalasRuleType): string {
  if (ruleType === 'order_discount') return 'Summer sale -15%'
  if (ruleType === 'first_order_discount') return 'Nouveaux clients -10%'
  if (ruleType === 'shipping_threshold') return 'Livraison offerte France'
  return 'Charm offert des 150 euros'
}

function ruleSummary(rule: PalasRule): string {
  if (rule.rule_type === 'order_discount' || rule.rule_type === 'first_order_discount') {
    const suffix = rule.value_type === 'percentage' ? '%' : (rule.currency_code ?? '')
    return `${rule.value ?? 0}${suffix}${rule.code ? ` · code ${rule.code}` : ' · automatique'}`
  }
  if (rule.rule_type === 'shipping_threshold') {
    return `${rule.market_key ?? 'market'} · offert des ${rule.threshold ?? 0} ${rule.currency_code ?? ''}`
  }
  return `${rule.gift_title ?? 'Cadeau'} des ${rule.threshold ?? 0}`
}

function syncBadgeClass(status: PalasRule['sync_status']): string {
  if (status === 'synced') return 'border-emerald-200 bg-emerald-50 text-emerald-900'
  if (status === 'error') return 'border-red-200 bg-red-50 text-red-900'
  if (status === 'pending') return 'border-amber-200 bg-amber-50 text-amber-900'
  return ''
}

function readPositiveNumber(value: string, label: string): number {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) throw new MantaError('INVALID_DATA', `${label}: valeur invalide.`)
  return number
}

function readZeroOrPositiveNumber(value: string, label: string): number {
  const number = Number(value)
  if (!Number.isFinite(number) || number < 0) throw new MantaError('INVALID_DATA', `${label}: valeur invalide.`)
  return number
}

function localDateTimeToIso(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw new MantaError('INVALID_DATA', 'Date invalide.')
  return date.toISOString()
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
  if (kind === 'first_order_discount') return '1ere commande'
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
