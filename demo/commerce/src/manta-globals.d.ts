import type {
  defineCommand as _defineCommand,
  defineCommandGraph as _defineCommandGraph,
  defineConfig as _defineConfig,
  defineJob as _defineJob,
  defineLink as _defineLink,
  defineMiddleware as _defineMiddleware,
  defineMiddlewares as _defineMiddlewares,
  defineModel as _defineModel,
  defineQuery as _defineQuery,
  defineService as _defineService,
  defineSubscriber as _defineSubscriber,
  defineUserModel as _defineUserModel,
  field as _field,
  MantaError as _MantaError,
  many as _many,
  model as _model,
  // biome-ignore lint/style/noRestrictedImports: local type shim for globals missing from the published package
} from '@mantajs/core'
import type { z as _z } from 'zod'

declare global {
  const defineCommand: typeof _defineCommand
  const defineCommandGraph: typeof _defineCommandGraph
  const defineConfig: typeof _defineConfig
  const defineJob: typeof _defineJob
  const defineLink: typeof _defineLink
  const defineMiddleware: typeof _defineMiddleware
  const defineMiddlewares: typeof _defineMiddlewares
  const defineModel: typeof _defineModel
  const defineQuery: typeof _defineQuery
  const defineService: typeof _defineService
  const defineSubscriber: typeof _defineSubscriber
  const defineUserModel: typeof _defineUserModel
  const field: typeof _field
  const many: typeof _many
  const MantaError: typeof _MantaError
  const model: typeof _model
  const z: typeof _z

  interface MantaGeneratedEntities {}
}
