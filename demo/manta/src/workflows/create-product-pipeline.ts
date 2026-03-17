// Workflow: create-product-pipeline — 5 steps with compensation
// Optimized: inlined inventory, merged UPDATEs, events emitted after workflow (like Medusa)
import { createWorkflow, step } from '@manta/core'
import type { IEventBusPort, ILoggerPort } from '@manta/core'
import type { ProductService } from '../modules/product'
import type { InventoryService } from '../modules/inventory'
import type { FileService } from '../modules/file/service'

export const createProductPipeline = createWorkflow({
  name: 'create-product-pipeline',
  steps: [
    // Step 1: Validate product input
    step({
      name: 'validate-product',
      handler: async ({ input, context }) => {
        const { title, sku, price } = input as { title?: string; sku?: string; price?: number }
        if (!title || !sku || price == null) {
          throw new Error('Missing required fields: title, sku, price')
        }
        if ((price as number) < 0) {
          throw new Error('Price must be non-negative')
        }
        // Check SKU uniqueness
        const productService = context.resolve<ProductService>('productService')
        const existing = await productService.findBySku(sku)
        if (existing) {
          throw new Error(`SKU '${sku}' already exists`)
        }
        return { validated: true }
      },
    }),

    // Step 2: Create product
    step({
      name: 'create-product',
      handler: async ({ input, context }) => {
        const productService = context.resolve<ProductService>('productService')
        const product = await productService.create({
          title: input.title as string,
          description: input.description as string | undefined,
          sku: input.sku as string,
          price: input.price as number,
          status: 'draft',
        })
        return { product }
      },
      compensation: async ({ output, context }) => {
        const productService = context.resolve<ProductService>('productService')
        const product = output.product as { id: string }
        await productService.delete(product.id)
        const logger = context.resolve<ILoggerPort>('ILoggerPort')
        logger.warn(`Compensated: deleted product ${product.id}`)
      },
    }),

    // Step 3: Upload images + generate catalog (no separate DB writes — collected for final UPDATE)
    step({
      name: 'upload-images-and-catalog',
      handler: async ({ input, previousOutput, context }) => {
        const product = (previousOutput['create-product'] as { product: { id: string; title: string; sku: string; price: number } }).product
        const imageUrls: string[] = []

        // Upload images (in-memory, no DB)
        const images = input.images as Array<{ filename: string; content: Buffer }> | undefined
        if (images?.length) {
          const fileService = context.resolve<FileService>('fileService')
          const uploads = await Promise.all(images.map((image) =>
            fileService.write(`products/${product.id}/${image.filename}`, image.content)
          ))
          imageUrls.push(...uploads)
        }

        // Generate catalog entry (in-memory, no DB)
        const fileService = context.resolve<FileService>('fileService')
        const catalogEntry = JSON.stringify({
          id: product.id,
          title: product.title,
          sku: product.sku,
          price: product.price,
          images: imageUrls,
          generated_at: new Date().toISOString(),
        }, null, 2)
        const catalogUrl = await fileService.write(
          `catalog/${product.sku}.json`,
          Buffer.from(catalogEntry),
        )

        return { imageUrls, catalogUrl }
      },
      compensation: async ({ output, context }) => {
        const fileService = context.resolve<FileService>('fileService')
        const imageUrls = output.imageUrls as string[]
        for (const url of imageUrls) {
          const key = url.replace('memory://', '')
          await fileService.delete(key)
        }
        const catalogUrl = output.catalogUrl as string
        if (catalogUrl) {
          const key = catalogUrl.replace('memory://', '')
          await fileService.delete(key)
        }
      },
    }),

    // Step 4: Initialize inventory (inlined — no sub-workflow overhead)
    step({
      name: 'initialize-inventory',
      handler: async ({ input, previousOutput, context }) => {
        const product = (previousOutput['create-product'] as { product: { sku: string } }).product
        const inventoryService = context.resolve<InventoryService>('inventoryService')
        const item = await inventoryService.createStock({
          sku: product.sku,
          quantity: (input.initialStock as number) || 0,
        })
        await inventoryService.setReorderPoint(product.sku, (input.reorderPoint as number) || 10)
        return {
          sku: product.sku,
          quantity: (input.initialStock as number) || 0,
          reorderPoint: (input.reorderPoint as number) || 10,
        }
      },
      compensation: async ({ output, context }) => {
        const inventoryService = context.resolve<InventoryService>('inventoryService')
        const item = await inventoryService.findBySku(output.sku as string)
        if (item) await inventoryService.delete(item.id)
      },
    }),

    // Step 5: Activate product (single UPDATE merging images + catalog + status) + emit events
    step({
      name: 'finalize-and-emit',
      handler: async ({ previousOutput, context }) => {
        const product = (previousOutput['create-product'] as { product: { id: string; sku: string; title: string; price: number } }).product
        const { imageUrls, catalogUrl } = previousOutput['upload-images-and-catalog'] as { imageUrls: string[]; catalogUrl: string }
        const inventory = previousOutput['initialize-inventory'] as { sku: string; quantity: number; reorderPoint: number }

        // Single merged UPDATE: images + catalog + status → 1 query instead of 3
        const productService = context.resolve<ProductService>('productService')
        await productService.activate(product.id, {
          image_urls: imageUrls,
          catalog_file_url: catalogUrl,
        })

        // Emit events fire-and-forget (subscribers are async, like Medusa)
        const eventBus = context.resolve<IEventBusPort>('IEventBusPort')

        await eventBus.emit({
          eventName: 'product.created',
          data: {
            id: product.id,
            sku: product.sku,
            title: product.title,
            price: product.price,
          },
          metadata: { timestamp: Date.now() },
        })

        await eventBus.emit({
          eventName: 'inventory.stocked',
          data: {
            sku: product.sku,
            quantity: inventory.quantity,
            reorderPoint: inventory.reorderPoint,
          },
          metadata: { timestamp: Date.now() },
        })

        return {
          product: { ...product, status: 'active' },
          inventory,
          events: ['product.created', 'inventory.stocked'],
        }
      },
    }),
  ],
})
