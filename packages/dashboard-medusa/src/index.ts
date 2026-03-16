import React from "react"
import {
  DashboardApp,
  LocalStorageOverrideStore,
  UserMenu,
} from "@manta/dashboard-core"
import type { DashboardAppProps } from "@manta/dashboard-core"
import { MedusaDataSource } from "./medusa-data-source"
import { MedusaAuthAdapter } from "./medusa-auth-adapter"
import { pages } from "./pages/index"
import { components } from "./components/index"
import { medusaNavigation, medusaIconMap } from "./medusa-navigation"
import { formRoutes } from "./shell/form-routes"
import { MedusaHeader } from "./medusa-header"

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
      userMenuSlot={
        <UserMenu
          docsUrl="https://docs.medusajs.com"
          changelogUrl="https://medusajs.com/changelog/"
        />
      }
      iconMap={medusaIconMap}
      loginProps={{
        subtitle: "Sign in to your Medusa Store",
        defaultRedirect: "/orders",
      }}
      basename={basename}
    />
  )
}

export default MedusaDashboard

// Re-export core for convenience
export { MedusaDataSource } from "./medusa-data-source"
export { MedusaAuthAdapter } from "./medusa-auth-adapter"
export { pages } from "./pages/index"
export { components } from "./components/index"
export { medusaNavigation, medusaIconMap } from "./medusa-navigation"
export { formRoutes } from "./shell/form-routes"
export { entityEndpointMap, entityQueryKeyMap } from "./entity-maps"
