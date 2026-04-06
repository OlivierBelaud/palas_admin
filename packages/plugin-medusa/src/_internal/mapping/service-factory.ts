// Service factory bridge — wraps Manta's createService() to accept Medusa's constructor pattern.
//
// Medusa: class ProductService extends MedusaService({ Product, Variant }) {
//   constructor({ baseRepository, productService, variantService, ... })
// }
//
// Manta: class ProductService extends createService({ Product: ProductModel }) {
//   constructor({ repository, messageAggregator })
// }
//
// This bridge makes createService() return a class that accepts either signature.

import { createService, InMemoryRepository } from '@manta/core'

/**
 * MedusaService-compatible factory.
 * Accepts DML models (same as Medusa), returns a class whose constructor
 * accepts Medusa's Awilix-style dependency object.
 */
// biome-ignore lint/suspicious/noExplicitAny: Medusa models are untyped
export function MedusaServiceBridge(models: Record<string, any>): new (...args: any[]) => any {
  // Create the Manta base service from the models
  const MantaBase = createService(models)

  // Return a wrapper class that adapts the Medusa constructor signature
  // biome-ignore lint/suspicious/noExplicitAny: bridge between two type systems
  class BridgedService extends (MantaBase as any) {
    // biome-ignore lint/suspicious/noExplicitAny: Awilix-style deps
    constructor(deps: Record<string, any> = {}) {
      // Medusa passes { baseRepository, productService, variantService, ... }
      // Manta expects { repository, messageAggregator }
      const repository = deps.baseRepository || deps.repository || new InMemoryRepository()
      const messageAggregator = deps.messageAggregator || null

      super({ repository, messageAggregator })

      // Store the container/deps for Medusa code that accesses this.container_ or this.__container__
      // biome-ignore lint/suspicious/noExplicitAny: Medusa compat
      ;(this as any).__container__ = deps
      // biome-ignore lint/suspicious/noExplicitAny: Medusa compat
      ;(this as any).container_ = deps
    }
  }

  return BridgedService
}
