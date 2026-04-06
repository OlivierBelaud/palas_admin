import { createRoot } from 'react-dom/client'
import { MantaDashboard } from '@manta/dashboard'
import { CreateProductPage } from './routes/products/create'
import { TestPanel } from './routes/products/test-panel'
import { CronsPage } from './routes/crons/page'
import '@manta/dashboard-core/index.css'

function SettingsPage() {
  return (
    <div className="flex flex-col gap-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">Application settings will be available here.</p>
      </div>
      <div className="rounded-lg border bg-card p-6 text-card-foreground">
        <p className="text-sm text-muted-foreground">No settings configured yet.</p>
      </div>
    </div>
  )
}

const apiUrl = window.location.origin

const customRoutes = [
  {
    path: 'products/create',
    element: <CreateProductPage />,
  },
  {
    path: 'test',
    element: <TestPanel />,
  },
  {
    path: 'crons',
    element: <CronsPage />,
  },
  {
    path: 'settings',
    element: <SettingsPage />,
  },
]

createRoot(document.getElementById('root')!).render(
  <MantaDashboard
    apiUrl={apiUrl}
    basename="/admin"
    customRoutes={customRoutes}
  />,
)
