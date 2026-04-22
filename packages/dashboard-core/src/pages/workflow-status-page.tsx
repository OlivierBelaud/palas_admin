// Workflow Status Page — /_runs/:runId
// Thin wrapper that extracts runId from the route and renders <WorkflowStatus>.
// Registered under the admin shell in app.tsx (protected by the same auth rule).

import { Link, useParams } from 'react-router-dom'
import { WorkflowStatus } from '../components/WorkflowStatus'

export function WorkflowStatusPage() {
  const params = useParams<{ runId: string }>()
  const runId = params.runId ?? ''

  if (!runId) {
    return (
      <div className="flex flex-col gap-y-2">
        <p className="text-sm text-destructive">runId manquant dans l'URL.</p>
        <Link to=".." className="text-sm underline">
          Retour
        </Link>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-[1.75rem] font-bold tracking-tight">Exécution</h1>
        <Link
          to=".."
          className="text-sm text-muted-foreground underline decoration-dotted underline-offset-4 hover:text-foreground"
        >
          Retour
        </Link>
      </div>
      <WorkflowStatus runId={runId} />
    </div>
  )
}
