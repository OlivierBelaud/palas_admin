// Workflow: create-product-pipeline — 6 steps with compensation
import { createWorkflow, step, type WorkflowManager } from '@manta/core'
import type { IEventBusPort, ILoggerPort } from '@manta/core'
import type { ProductService } from '../modules/product'
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

    // Step 3: Upload images
    step({
      name: 'upload-images',
      handler: async ({ input, previousOutput, context }) => {
        const product = (previousOutput['create-product'] as { product: { id: string } }).product
        const imageUrls: string[] = []

        const images = input.images as Array<{ filename: string; content: Buffer }> | undefined
        if (images?.length) {
          const fileService = context.resolve<FileService>('fileService')
          for (const image of images) {
            const url = await fileService.write(
              `products/${product.id}/${image.filename}`,
              image.content,
            )
            imageUrls.push(url)
          }
          const productService = context.resolve<ProductService>('productService')
          await productService.updateImages(product.id, imageUrls)
        }

        return { imageUrls }
      },
      compensation: async ({ output, context }) => {
        const fileService = context.resolve<FileService>('fileService')
        const imageUrls = output.imageUrls as string[]
        for (const url of imageUrls) {
          // Extract key from memory://key format
          const key = url.replace('memory://', '')
          await fileService.delete(key)
        }
      },
    }),

    // Step 4: Sub-workflow — initialize inventory
    step({
      name: 'initialize-inventory',
      handler: async ({ input, previousOutput, context }) => {
        const product = (previousOutput['create-product'] as { product: { sku: string } }).product
        const wm = context.resolve<WorkflowManager>('workflowManager')
        const result = await wm.run('initialize-inventory', {
          input: {
            sku: product.sku,
            initialQuantity: (input.initialStock as number) || 0,
            reorderPoint: (input.reorderPoint as number) || 10,
          },
        })
        return result
      },
    }),

    // Step 5: Generate catalog entry (simulated long task)
    step({
      name: 'generate-catalog-entry',
      handler: async ({ previousOutput, context }) => {
        const product = (previousOutput['create-product'] as { product: { id: string; title: string; sku: string; price: number } }).product
        const imageUrls = (previousOutput['upload-images'] as { imageUrls: string[] }).imageUrls

        // Simulate a long task
        await new Promise(resolve => setTimeout(resolve, 100))

        const catalogEntry = JSON.stringify({
          id: product.id,
          title: product.title,
          sku: product.sku,
          price: product.price,
          images: imageUrls,
          generated_at: new Date().toISOString(),
        }, null, 2)

        const fileService = context.resolve<FileService>('fileService')
        const catalogUrl = await fileService.write(
          `catalog/${product.sku}.json`,
          Buffer.from(catalogEntry),
        )

        const productService = context.resolve<ProductService>('productService')
        await productService.updateCatalogUrl(product.id, catalogUrl)

        return { catalogUrl }
      },
      compensation: async ({ output, context }) => {
        const fileService = context.resolve<FileService>('fileService')
        const url = output.catalogUrl as string
        const key = url.replace('memory://', '')
        await fileService.delete(key)
      },
    }),

    // Step 6: Emit events and activate product
    step({
      name: 'emit-events',
      handler: async ({ previousOutput, context }) => {
        const product = (previousOutput['create-product'] as { product: { id: string; sku: string; title: string; price: number } }).product
        const inventory = previousOutput['initialize-inventory'] as { sku: string; quantity: number; reorderPoint: number }
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

        // Activate the product
        const productService = context.resolve<ProductService>('productService')
        await productService.updateStatus(product.id, 'active')

        return {
          product: { ...product, status: 'active' },
          inventory,
          events: ['product.created', 'inventory.stocked'],
        }
      },
    }),
  ],
})
