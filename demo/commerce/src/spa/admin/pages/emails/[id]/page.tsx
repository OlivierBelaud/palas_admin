import { useQuery } from '@mantajs/sdk'
import { Badge, Card, CardContent, CardHeader, CardTitle, Skeleton } from '@mantajs/ui'
import { ArrowLeft, ExternalLink, Mail, Package, ShoppingCart, User } from 'lucide-react'
import type React from 'react'
import { Link, useParams } from 'react-router-dom'

interface EmailDetailData {
  message: {
    id: string
    email: string
    message_type: string
    sequence_version: number
    sequence_started_at: string | null
    status: string
    scheduled_for: string
    sent_at: string | null
    provider: string | null
    provider_message_id: string | null
    locale: string | null
    subject: string | null
    skip_reason: string | null
    error_message: string | null
    discount_code: string | null
    preview_note: string
  }
  preview: {
    html: string | null
    text: string | null
    subject: string | null
    source: 'snapshot' | 'reconstructed'
    snapshot_saved_at: string | null
    snapshot_sha256: string | null
    snapshot_error: string | null
  }
  cart: {
    id: string
    email: string | null
    status: string | null
    highest_stage: string | null
    last_action: string | null
    last_action_at: string | null
    total_price: number | null
    currency: string | null
    item_count: number | null
  } | null
  contact: {
    id: string
    email: string
    first_name: string | null
    last_name: string | null
    orders_count: number
    total_spent: number
  } | null
  orders: Array<{
    id: string
    order_number: string | null
    total_price: number
    currency: string | null
    status: string
    placed_at: string | null
  }>
}

export default function EmailDetailPage() {
  const params = useParams()
  const id = params.id ?? ''
  const query = useQuery<EmailDetailData>('email-detail', { id }, { enabled: Boolean(id) })
  const data = query.data

  if (query.isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-10 w-56" />
        <Skeleton className="h-[640px] w-full" />
      </div>
    )
  }

  if (query.isError) {
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm">{query.error.message}</div>
    )
  }

  if (!data) return null

  return (
    <div className="flex flex-col gap-4 pb-8">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <Link
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
            to="/emails"
          >
            <ArrowLeft className="size-4" />
            Emails
          </Link>
          <h1 className="mt-2 text-2xl font-semibold tracking-normal">{data.message.subject ?? 'Email Palas'}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Badge variant="outline">{messageLabel(data.message.message_type)}</Badge>
            <Badge variant="outline">S{data.message.sequence_version}</Badge>
            <Badge
              variant={
                data.message.status === 'sent' ? 'green' : data.message.status === 'failed' ? 'orange' : 'outline'
              }
            >
              {humanize(data.message.status)}
            </Badge>
            <Badge variant={data.preview.source === 'snapshot' ? 'green' : 'outline'}>
              {data.preview.source === 'snapshot' ? 'Snapshot exact' : 'Reconstitution'}
            </Badge>
            <span>{data.message.email}</span>
          </div>
        </div>
        {data.cart ? (
          <Link
            className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
            to={`/paniers/${data.cart.id}`}
          >
            Voir le panier
            <ExternalLink className="size-4" />
          </Link>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="min-w-0 border border-border/70 shadow-none">
          <CardHeader>
            <CardTitle>Aperçu email</CardTitle>
            <p className="text-sm text-muted-foreground">{data.message.preview_note}</p>
          </CardHeader>
          <CardContent>
            {data.preview.html ? (
              <iframe
                className="h-[760px] w-full rounded-md border bg-white"
                sandbox=""
                srcDoc={data.preview.html}
                title="Aperçu email"
              />
            ) : (
              <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
                Aucun aperçu HTML disponible pour cet email.
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4">
          <SideCard icon={Mail} title="Envoi">
            <Field label="Destinataire" value={data.message.email} />
            <Field label="Séquence" value={`S${data.message.sequence_version}`} />
            <Field
              label="Début séquence"
              value={data.message.sequence_started_at ? formatDateTime(data.message.sequence_started_at) : '-'}
            />
            <Field label="Prévu" value={formatDateTime(data.message.scheduled_for)} />
            <Field label="Envoyé" value={data.message.sent_at ? formatDateTime(data.message.sent_at) : '-'} />
            <Field label="Provider" value={data.message.provider ?? '-'} />
            <Field label="Message ID" value={data.message.provider_message_id ?? '-'} />
            <Field label="Code promo" value={data.message.discount_code ?? '-'} />
            <Field
              label="Snapshot"
              value={
                data.preview.source === 'snapshot'
                  ? data.preview.snapshot_saved_at
                    ? formatDateTime(data.preview.snapshot_saved_at)
                    : 'archive'
                  : 'reconstitution'
              }
            />
            <Field
              label="Hash"
              value={data.preview.snapshot_sha256 ? data.preview.snapshot_sha256.slice(0, 12) : '-'}
            />
            <Field label="Snapshot err" value={data.preview.snapshot_error ?? '-'} />
            <Field
              label="Erreur / skip"
              value={humanize(data.message.skip_reason ?? data.message.error_message ?? '-')}
            />
          </SideCard>

          <SideCard icon={User} title="Customer">
            {data.contact ? (
              <>
                <Field label="Email" value={data.contact.email} />
                <Field
                  label="Nom"
                  value={[data.contact.first_name, data.contact.last_name].filter(Boolean).join(' ') || '-'}
                />
                <Field label="Commandes" value={String(data.contact.orders_count ?? 0)} />
                <Field label="CA" value={formatMoney(data.contact.total_spent, 'EUR')} />
                <Link className="text-sm text-primary hover:underline" to={`/clients/${data.contact.id}`}>
                  Ouvrir la fiche client
                </Link>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Aucun contact consolidé trouvé.</p>
            )}
          </SideCard>

          <SideCard icon={ShoppingCart} title="Panier">
            {data.cart ? (
              <>
                <Field label="Statut" value={humanize(data.cart.status ?? '-')} />
                <Field label="Stage" value={humanize(data.cart.highest_stage ?? '-')} />
                <Field label="Dernière action" value={humanize(data.cart.last_action ?? '-')} />
                <Field
                  label="Dernière activité"
                  value={data.cart.last_action_at ? formatDateTime(data.cart.last_action_at) : '-'}
                />
                <Field label="Articles" value={String(data.cart.item_count ?? 0)} />
                <Field label="Total" value={formatMoney(data.cart.total_price ?? 0, data.cart.currency ?? 'EUR')} />
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Panier introuvable.</p>
            )}
          </SideCard>

          <SideCard icon={Package} title="Dernières commandes">
            {data.orders.length === 0 ? <p className="text-sm text-muted-foreground">Aucune commande liée.</p> : null}
            {data.orders.map((order) => (
              <div key={order.id} className="border-b py-2 text-sm last:border-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{order.order_number ?? order.id}</span>
                  <Badge variant="outline">{humanize(order.status)}</Badge>
                </div>
                <div className="mt-1 text-muted-foreground">
                  {order.placed_at ? formatDateTime(order.placed_at) : '-'} ·{' '}
                  {formatMoney(order.total_price, order.currency ?? 'EUR')}
                </div>
              </div>
            ))}
          </SideCard>
        </div>
      </div>
    </div>
  )
}

function SideCard({ icon: Icon, title, children }: { icon: typeof Mail; title: string; children: React.ReactNode }) {
  return (
    <Card className="border border-border/70 shadow-none">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Icon className="size-4 text-muted-foreground" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">{children}</CardContent>
    </Card>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate" title={value}>
        {value}
      </span>
    </div>
  )
}

function messageLabel(value: string): string {
  const labels: Record<string, string> = {
    abandoned_cart_1: 'Email 1',
    abandoned_cart_2: 'Email 2',
    abandoned_cart_3: 'Email 3',
    payment_help_1: 'Payment help',
    klaviyo_abandoned: 'Klaviyo',
  }
  return labels[value] ?? humanize(value)
}

function humanize(value: string): string {
  if (!value || value === '-') return '-'
  return value.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function formatMoney(value: number, currency: string): string {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value)
}
