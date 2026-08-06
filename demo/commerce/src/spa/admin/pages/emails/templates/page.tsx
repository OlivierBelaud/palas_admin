import { useQuery } from '@mantajs/sdk'
import { Badge, Card, CardContent, CardHeader, CardTitle, Skeleton } from '@mantajs/ui'
import { Check, Laptop, type MonitorSmartphone, Smartphone } from 'lucide-react'
import type React from 'react'
import { useMemo, useState } from 'react'
import {
  EMAIL_TEMPLATE_CATALOG,
  type EmailTemplateDefinition,
  type EmailTemplatePreviewInput,
  type PreviewControl,
  type RenderedEmailTemplatePreview,
  sameEmailPreviewScenario,
} from '../../../../../emails/catalog-contract'
import { EmailSectionNav } from '../../../components/email-section-nav'

interface PreviewData {
  scenario: EmailTemplatePreviewInput
  preview: RenderedEmailTemplatePreview
}

const initialInput: EmailTemplatePreviewInput = {
  templateId: 'abandoned_cart_1',
  locale: 'fr',
  customerStatus: 'new',
  promotionActive: true,
  itemCount: 2,
  reportStatus: 'ready',
}

export default function EmailTemplatesPage() {
  const [input, setInput] = useState<EmailTemplatePreviewInput>(initialInput)
  const [viewport, setViewport] = useState<'desktop' | 'mobile'>('desktop')
  const queryInput = useMemo<Record<string, unknown>>(() => ({ ...input }), [input])
  const query = useQuery<PreviewData>('email-template-preview', queryInput, { staleTime: 30_000 })
  const data = query.data
  const currentData = data && sameEmailPreviewScenario(data.scenario, input) ? data : null
  const selected =
    EMAIL_TEMPLATE_CATALOG.find((template) => template.id === input.templateId) ?? EMAIL_TEMPLATE_CATALOG[0]

  return (
    <div className="flex flex-col gap-4 pb-8">
      <EmailSectionNav />
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-normal">Templates d’emails</h1>
          <Badge variant="outline">Données fictives</Badge>
        </div>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Prévisualisez le HTML réellement généré par l’application et parcourez chaque branche sans envoyer d’email.
        </p>
      </div>

      {query.isError ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm">
          Impossible de générer l’aperçu : {query.error.message}
        </div>
      ) : null}

      <div className="grid min-w-0 gap-4 xl:grid-cols-[280px_minmax(0,1fr)]">
        <Card className="h-fit border-border/70 shadow-none">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Tous les emails</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1 px-3 pb-3">
            {EMAIL_TEMPLATE_CATALOG.map((template) => (
              <button
                key={template.id}
                aria-pressed={input.templateId === template.id}
                className={`rounded-md px-3 py-2.5 text-left transition-colors ${
                  input.templateId === template.id
                    ? 'bg-primary text-primary-foreground'
                    : 'text-foreground hover:bg-muted'
                }`}
                onClick={() =>
                  setInput((current) =>
                    current.templateId === template.id ? current : { ...current, templateId: template.id },
                  )
                }
                type="button"
              >
                <span className="block text-sm font-medium">{template.name}</span>
                <span
                  className={`mt-0.5 block text-xs ${
                    input.templateId === template.id ? 'text-primary-foreground/75' : 'text-muted-foreground'
                  }`}
                >
                  {familyLabel(template.family)}
                </span>
              </button>
            ))}
          </CardContent>
        </Card>

        <div className="flex min-w-0 flex-col gap-4">
          {currentData ? (
            <>
              <Card className="border-border/70 shadow-none">
                <CardHeader className="pb-3">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <CardTitle>{selected.name}</CardTitle>
                        <Badge variant="outline">{familyLabel(selected.family)}</Badge>
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">{selected.description}</p>
                    </div>
                    <div className="text-left text-xs text-muted-foreground lg:text-right">
                      <div>{selected.timing}</div>
                      <div className="mt-1 font-mono">{selected.source}</div>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  {selected.sharedTemplate ? (
                    <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                      {selected.sharedTemplate}
                    </div>
                  ) : null}
                  <ScenarioControls
                    controls={selected.controls}
                    input={input}
                    onChange={(patch) => setInput((current) => ({ ...current, ...patch }))}
                  />
                  <div className="flex flex-wrap gap-2">
                    {currentData.preview.appliedBranches.map((branch) => (
                      <Badge key={branch} variant="outline">
                        <Check className="mr-1 size-3" />
                        {branch}
                      </Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card className="min-w-0 border-border/70 shadow-none">
                <CardHeader className="gap-3">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div className="min-w-0">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Objet</p>
                      <CardTitle className="mt-1 truncate text-base" title={currentData.preview.subject}>
                        {currentData.preview.subject}
                      </CardTitle>
                    </div>
                    <div className="flex rounded-md border p-1">
                      <ViewportButton
                        active={viewport === 'desktop'}
                        icon={Laptop}
                        label="Desktop"
                        onClick={() => setViewport('desktop')}
                      />
                      <ViewportButton
                        active={viewport === 'mobile'}
                        icon={Smartphone}
                        label="Mobile"
                        onClick={() => setViewport('mobile')}
                      />
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="overflow-hidden bg-muted/40 p-3 sm:p-5">
                  <div
                    className={`mx-auto overflow-hidden rounded-lg border bg-white shadow-sm transition-[max-width] ${
                      viewport === 'mobile' ? 'max-w-[390px]' : 'max-w-[920px]'
                    }`}
                  >
                    <iframe
                      className="h-[760px] w-full bg-white"
                      sandbox=""
                      srcDoc={currentData.preview.html}
                      title={`Aperçu ${selected.name}`}
                    />
                  </div>
                </CardContent>
              </Card>
            </>
          ) : (
            <>
              <Skeleton className="h-64 w-full" />
              <Skeleton className="h-[760px] w-full" />
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function ScenarioControls({
  controls,
  input,
  onChange,
}: {
  controls: PreviewControl[]
  input: EmailTemplatePreviewInput
  onChange: (patch: Partial<EmailTemplatePreviewInput>) => void
}) {
  if (controls.length === 0) {
    return <p className="text-sm text-muted-foreground">Ce template ne comporte pas encore de variante.</p>
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {controls.includes('locale') ? (
        <Control label="Langue">
          <select
            className="h-9 rounded-md border bg-background px-3 text-sm"
            aria-label="Langue"
            onChange={(event) => onChange({ locale: event.target.value as EmailTemplatePreviewInput['locale'] })}
            value={input.locale}
          >
            <option value="fr">Français</option>
            <option value="en">English</option>
          </select>
        </Control>
      ) : null}
      {controls.includes('customerStatus') ? (
        <Control label="Profil client">
          <select
            className="h-9 rounded-md border bg-background px-3 text-sm"
            aria-label="Profil client"
            onChange={(event) =>
              onChange({ customerStatus: event.target.value as EmailTemplatePreviewInput['customerStatus'] })
            }
            value={input.customerStatus}
          >
            <option value="new">Nouveau client</option>
            <option value="returning">Client existant</option>
          </select>
        </Control>
      ) : null}
      {controls.includes('promotionActive') ? (
        <Control label="Campagne promo">
          <button
            aria-label="Campagne promo"
            aria-pressed={input.promotionActive}
            className={`flex h-9 items-center justify-between rounded-md border px-3 text-sm ${
              input.promotionActive ? 'border-emerald-300 bg-emerald-50 text-emerald-900' : 'bg-background'
            }`}
            onClick={() => onChange({ promotionActive: !input.promotionActive })}
            type="button"
          >
            {input.promotionActive ? 'Active · -10%' : 'Inactive'}
            <span
              className={`ml-3 size-2 rounded-full ${input.promotionActive ? 'bg-emerald-500' : 'bg-muted-foreground'}`}
            />
          </button>
        </Control>
      ) : null}
      {controls.includes('itemCount') ? (
        <Control label="Articles au panier">
          <select
            aria-label="Articles au panier"
            className="h-9 rounded-md border bg-background px-3 text-sm"
            onChange={(event) => onChange({ itemCount: Number(event.target.value) })}
            value={input.itemCount}
          >
            <option value="1">1 article</option>
            <option value="2">2 articles</option>
            <option value="3">3 articles</option>
            <option value="4">4 articles</option>
          </select>
        </Control>
      ) : null}
      {controls.includes('reportStatus') ? (
        <Control label="Qualité des données">
          <select
            aria-label="Qualité des données"
            className="h-9 rounded-md border bg-background px-3 text-sm"
            onChange={(event) =>
              onChange({ reportStatus: event.target.value as EmailTemplatePreviewInput['reportStatus'] })
            }
            value={input.reportStatus}
          >
            <option value="ready">Rapport complet</option>
            <option value="partial">Rapport partiel</option>
          </select>
        </Control>
      ) : null}
    </div>
  )
}

function Control({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 text-xs font-medium text-muted-foreground">
      <span>{label}</span>
      {children}
    </div>
  )
}

function ViewportButton({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean
  icon: typeof MonitorSmartphone
  label: string
  onClick: () => void
}) {
  return (
    <button
      aria-pressed={active}
      className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs ${
        active ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground'
      }`}
      onClick={onClick}
      type="button"
    >
      <Icon className="size-3.5" />
      {label}
    </button>
  )
}

function familyLabel(family: EmailTemplateDefinition['family']): string {
  if (family === 'customer') return 'Client'
  if (family === 'admin') return 'Administration'
  return 'Reporting'
}
