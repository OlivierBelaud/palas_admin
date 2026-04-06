import type { defineAgent as _defineAgent } from './ai'
import type { defineCommand as _defineCommand } from './command'
import type { defineModel as _defineModel, field as _field } from './dml/model'
import type { defineJob as _defineJob } from './job'
import type { defineLink as _defineLink, many as _many } from './link'
import type { defineService as _defineService } from './service/define'
import type { defineSubscriber as _defineSubscriber } from './subscriber'
import type { defineUserModel as _defineUserModel } from './user/define-user'
import type { defineQuery as _defineQuery } from './query/define-query'
import type { defineQueryGraph as _defineQueryGraph } from './query/define-query-graph'
import type { defineWorkflow as _defineWorkflow } from './workflows/define-workflow'
import type { defineConfig as _defineConfig } from './config/define-config'
import type { definePreset as _definePreset } from './config/presets'
import type { defineMiddleware as _defineMiddleware } from './middleware/define-middleware'

declare global {
  const defineModel: typeof _defineModel
  const defineService: typeof _defineService
  const defineLink: typeof _defineLink
  const defineCommand: typeof _defineCommand
  const defineQuery: typeof _defineQuery
  const defineQueryGraph: typeof _defineQueryGraph
  const defineWorkflow: typeof _defineWorkflow
  const defineAgent: typeof _defineAgent
  const defineJob: typeof _defineJob
  const defineUserModel: typeof _defineUserModel
  const defineConfig: typeof _defineConfig
  const definePreset: typeof _definePreset
  const defineMiddleware: typeof _defineMiddleware
  const field: typeof _field
  const many: typeof _many

  // ── defineSubscriber — callable interface for codegen merging ──────
  // Base overloads come from typeof _defineSubscriber.
  // Codegen adds event-specific overloads via interface merging in generated.d.ts:
  //   interface DefineSubscriberFn {
  //     (event: 'post.created', handler: ...): ...
  //   }
  // Interface merging works (type aliases don't), and explicit string literals
  // in call signatures give IDE autocomplete.
  // biome-ignore lint/suspicious/noEmptyInterface: augmented by codegen with event-specific overloads
  interface DefineSubscriberFn extends CallableFunction {}
  const defineSubscriber: typeof _defineSubscriber & DefineSubscriberFn

  // ── Codegen-augmented interfaces ──────────────────────────────────
  // These are empty by default. The CLI codegen (.manta/types/*.ts)
  // populates them via `declare global { interface XxxRegistry { ... } }`.
  // The @manta/core package re-exports them so user code can reference
  // them without importing from the global scope.

  // biome-ignore lint/suspicious/noEmptyInterface: augmented by codegen
  interface MantaGeneratedEntities {}
  // biome-ignore lint/suspicious/noEmptyInterface: augmented by codegen
  interface MantaGeneratedEntityRegistry {}
  // biome-ignore lint/suspicious/noEmptyInterface: augmented by codegen
  interface MantaGeneratedAppModules {}
  // biome-ignore lint/suspicious/noEmptyInterface: augmented by codegen
  interface MantaGeneratedEventMap {}
  // biome-ignore lint/suspicious/noEmptyInterface: augmented by codegen
  interface MantaGeneratedCommands {}
  // biome-ignore lint/suspicious/noEmptyInterface: augmented by codegen
  interface MantaGeneratedAgents {}
  // biome-ignore lint/suspicious/noEmptyInterface: augmented by codegen
  interface MantaGeneratedQueries {}
  // biome-ignore lint/suspicious/noEmptyInterface: augmented by codegen
  interface MantaGeneratedRegistry {}
}
