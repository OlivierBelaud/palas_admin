import type { MantaRequest } from "@manta/cli"
import type { ProductService } from "~src/modules/product/service"
import type { ILoggerPort } from "@manta/core"

export async function GET(req: MantaRequest) {
  const productService = req.scope.resolve<ProductService>('productService')
  const url = new URL(req.url)

  // Parse query params
  const q = url.searchParams.get('q') || ''
  const limit = parseInt(url.searchParams.get('limit') || '15', 10)
  const offset = parseInt(url.searchParams.get('offset') || '0', 10)
  const order = url.searchParams.get('order') || ''

  // Parse array filters: status[]=draft&status[]=archived
  const statusFilter = url.searchParams.getAll('status[]')

  let products = await productService.list()

  // Search filter (title + description)
  if (q) {
    const lower = q.toLowerCase()
    products = products.filter((p: any) =>
      p.title?.toLowerCase().includes(lower) ||
      p.description?.toLowerCase().includes(lower)
    )
  }

  // Status filter
  if (statusFilter.length > 0) {
    products = products.filter((p: any) => statusFilter.includes(p.status))
  }

  // Sort — supports both "-field" (prefix) and "field:direction" formats
  if (order) {
    let field: string
    let desc: boolean
    if (order.startsWith('-')) {
      field = order.slice(1)
      desc = true
    } else if (order.includes(':')) {
      const [f, d] = order.split(':')
      field = f
      desc = d === 'desc'
    } else {
      field = order
      desc = false
    }

    products.sort((a: any, b: any) => {
      let va = a[field] ?? ''
      let vb = b[field] ?? ''
      // Numeric comparison for price-like fields
      if (typeof va === 'number' && typeof vb === 'number') {
        return desc ? vb - va : va - vb
      }
      // Date comparison
      if (field.endsWith('_at') || field === 'created_at' || field === 'updated_at') {
        va = new Date(va).getTime()
        vb = new Date(vb).getTime()
        return desc ? vb - va : va - vb
      }
      // String comparison
      va = String(va).toLowerCase()
      vb = String(vb).toLowerCase()
      if (va < vb) return desc ? 1 : -1
      if (va > vb) return desc ? -1 : 1
      return 0
    })
  }

  const count = products.length

  // Paginate
  products = products.slice(offset, offset + limit)

  return Response.json({ products, count, limit, offset })
}

export async function POST(req: MantaRequest) {
  const logger = req.scope.resolve<ILoggerPort>('ILoggerPort')
  const body = req.validatedBody as Record<string, unknown>

  // If body has a sku → run the full create-product-pipeline workflow
  if (body.sku) {
    logger.info(`[POST /api/admin/products] Running create-product-pipeline workflow for SKU: ${body.sku}`)

    const wm = req.scope.resolve<any>('workflowManager')
    const input = {
      title: body.title,
      description: body.description,
      sku: body.sku,
      price: body.price,
      images: body.images || [],
      initialStock: body.initialStock ?? 0,
      reorderPoint: body.reorderPoint ?? 10,
    }

    logger.info(`[POST /api/admin/products] Workflow input: ${JSON.stringify(input)}`)

    try {
      const result = await wm.run('create-product-pipeline', { input, checkpointMode: 'batched' })
      logger.info(`[POST /api/admin/products] Workflow completed successfully`)
      logger.info(`[POST /api/admin/products]   Events emitted: ${JSON.stringify(result.events)}`)
      logger.info(`[POST /api/admin/products]   Product: id=${result.product?.id}, status=${result.product?.status}`)
      logger.info(`[POST /api/admin/products]   Inventory: sku=${result.inventory?.sku}, qty=${result.inventory?.quantity}, reorder=${result.inventory?.reorderPoint}`)
      return Response.json({ product: result.product, inventory: result.inventory, events: result.events }, { status: 201 })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      logger.error(`[POST /api/admin/products] Workflow FAILED: ${message}`)
      return Response.json({ type: 'INVALID_DATA', message }, { status: 400 })
    }
  }

  // Simple creation (no workflow) — for products without SKU
  logger.info(`[POST /api/admin/products] Simple creation (no SKU): "${body.title}"`)
  const productService = req.scope.resolve<ProductService>('productService')
  const product = await productService.create(body as any)
  logger.info(`[POST /api/admin/products] Created: ${product.id}`)
  return Response.json({ product }, { status: 201 })
}
