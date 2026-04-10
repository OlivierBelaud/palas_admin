// SPEC-039 — @manta/adapter-h3 barrel export

/** @deprecated Use H3AdapterOptions */
export type {
  AuthContext,
  AuthVerifier,
  H3AdapterOptions,
  H3AdapterOptions as NitroAdapterOptions,
  ReadinessProbe,
  RouteOptions,
  SessionVerifier,
} from './adapter'
// Compat aliases — deprecated
/** @deprecated Use H3Adapter */
export { H3Adapter, H3Adapter as NitroAdapter } from './adapter'
export type { MantaH3App, MantaH3AppOptions, RouteHandler } from './app'
export { createMantaH3App } from './app'
export type { MantaHandlerOptions } from './handler'
/** @deprecated Use createMantaH3Handler */
export { createMantaH3Handler, createMantaH3Handler as createMantaHandler } from './handler'
export type { ErrorResponseBody, PipelineContext } from './pipeline'
export { ERROR_STATUS_MAP, extractRequestId, mapErrorToResponse, parseBody, setCorsHeaders } from './pipeline'
