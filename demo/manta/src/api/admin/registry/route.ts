// GET /api/admin/registry — Serves the admin UI registry
// The dashboard fetches this to discover pages, components, and navigation.

import type { MantaRequest } from "@manta/cli"

export async function GET(_req: MantaRequest) {
  return Response.json({
    pages: {
      "products/list": {
        id: "products/list",
        type: "list",
        layout: "single-column",
        route: "/products",
        query: { entity: "product", list: true, pageSize: 15 },
        breadcrumb: { label: "Products" },
        main: ["products-table"],
      },
      "products/detail": {
        id: "products/detail",
        type: "detail",
        layout: "two-column",
        route: "/products/:id",
        query: {
          entity: "product",
          id: { $state: "/route/params/id" },
        },
        breadcrumb: { label: "Products", field: "title" },
        main: ["products-general", "products-metadata"],
        sidebar: ["products-status", "products-dates"],
      },
    },
    components: {
      "products-table": {
        id: "products-table",
        type: "EntityTable",
        props: {
          heading: "Products",
          pageActions: [
            { label: "Create", to: "/products/create", variant: "secondary" },
          ],
          columns: [
            { key: "title", label: "Product" },
            { key: "description", label: "Description" },
            { key: "price", label: "Price", type: "currency" },
            { key: "status", label: "Status", type: "badge" },
            { key: "created_at", label: "Created", type: "date", sortable: true },
          ],
          searchable: true,
          filterable: true,
          pagination: true,
          navigateTo: "/products/:id",
          orderBy: [
            { key: "title", label: "Title" },
            { key: "price", label: "Price" },
            { key: "created_at", label: "Created at" },
          ],
          filters: [
            {
              key: "status",
              label: "Status",
              type: "select",
              options: [
                { label: "Draft", value: "draft" },
                { label: "Published", value: "published" },
                { label: "Archived", value: "archived" },
              ],
            },
          ],
        },
      },
      "products-general": {
        id: "products-general",
        type: "InfoCard",
        props: {
          title: "General",
          titleField: "title",
          statusField: "status",
          fields: [
            { key: "description", label: "Description" },
            { key: "price", label: "Price", display: "currency" },
          ],
          actionGroups: [
            { actions: [{ label: "Edit", icon: "PencilSquare", to: "/products/:id/edit" }] },
            { actions: [{ label: "Delete", icon: "Trash", action: "delete", entity: "products", destructive: true }] },
          ],
        },
      },
      "products-status": {
        id: "products-status",
        type: "InfoCard",
        props: {
          title: "Status",
          fields: [
            { key: "status", label: "Status", display: "badge" },
            { key: "id", label: "Product ID" },
          ],
        },
      },
      "products-metadata": {
        id: "products-metadata",
        type: "JsonCard",
        props: {
          title: "Metadata",
          field: "metadata",
          editable: false,
        },
      },
      "products-dates": {
        id: "products-dates",
        type: "InfoCard",
        props: {
          title: "Dates",
          fields: [
            { key: "created_at", label: "Created", display: "date" },
            { key: "updated_at", label: "Updated", display: "date" },
          ],
        },
      },
    },
    navigation: [
      {
        icon: "Tag",
        label: "Products",
        to: "/products",
        items: [],
      },
    ],
    endpoints: {
      product: "/api/admin/products",
    },
    queryKeys: {
      product: "products",
    },
  })
}
