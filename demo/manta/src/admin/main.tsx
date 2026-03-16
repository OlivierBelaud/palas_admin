import { createRoot } from "react-dom/client"
import { MantaDashboard } from "@manta/dashboard"
import { CreateProductPage } from "./routes/products/create"
import { TestPanel } from "./routes/products/test-panel"
import "@manta/dashboard-core/index.css"

const apiUrl = window.location.origin

const customRoutes = [
  {
    path: "products/create",
    element: <CreateProductPage />,
  },
  {
    path: "test",
    element: <TestPanel />,
  },
]

createRoot(document.getElementById("root")!).render(
  <MantaDashboard
    apiUrl={apiUrl}
    basename="/admin"
    customRoutes={customRoutes}
  />
)
