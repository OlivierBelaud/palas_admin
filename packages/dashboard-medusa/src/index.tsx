import { DashboardApp, LocalStorageOverrideStore, UserMenu } from '@manta/dashboard-core'
import React from 'react'
import { components } from './components/index'
import { MedusaAuthAdapter } from './medusa-auth-adapter'
import { MedusaDataSource } from './medusa-data-source'
import { MedusaHeader } from './medusa-header'
import { medusaIconMap, medusaNavigation } from './medusa-navigation'
import { pages } from './pages/index'
import { formRoutes } from './shell/form-routes'

export interface MedusaDashboardProps {
  /** Medusa backend URL (defaults to "/") */
  apiUrl?: string
  /** Base path for the router */
  basename?: string
}

export function MedusaDashboard({ apiUrl, basename }: MedusaDashboardProps) {
  const dataSource = React.useMemo(() => new MedusaDataSource({ baseUrl: apiUrl }), [apiUrl])
  const authAdapter = React.useMemo(() => new MedusaAuthAdapter({ baseUrl: apiUrl }), [apiUrl])
  const overrideStore = React.useMemo(() => new LocalStorageOverrideStore(), [])

  return (
    <DashboardApp
      dataSource={dataSource}
      authAdapter={authAdapter}
      overrideStore={overrideStore}
      defaults={{ pages, components }}
      navigation={medusaNavigation}
      formRoutes={formRoutes}
      headerSlot={<MedusaHeader />}
      userMenuSlot={<UserMenu docsUrl="https://docs.medusajs.com" changelogUrl="https://medusajs.com/changelog/" />}
      iconMap={medusaIconMap}
      loginProps={{
        subtitle: 'Sign in to your Medusa Store',
        defaultRedirect: '/orders',
      }}
      basename={basename}
    />
  )
}

export default MedusaDashboard

export { components } from './components/index'
export { entityEndpointMap, entityQueryKeyMap } from './entity-maps'
export { MedusaAuthAdapter } from './medusa-auth-adapter'
// Re-export core for convenience
export { MedusaDataSource } from './medusa-data-source'
export { medusaIconMap, medusaNavigation } from './medusa-navigation'
export { pages } from './pages/index'
export { formRoutes } from './shell/form-routes'
