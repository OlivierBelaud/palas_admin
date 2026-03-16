import Medusa from "@medusajs/js-sdk"

declare const __BACKEND_URL__: string

const MEDUSA_BACKEND_URL =
  typeof __BACKEND_URL__ !== "undefined" ? __BACKEND_URL__ : "/"

export const sdk = new (Medusa as any)({
  baseUrl: MEDUSA_BACKEND_URL,
  auth: {
    type: "session",
  },
}) as InstanceType<typeof Medusa>
