import type { MantaRequest } from "@manta/cli"

export async function GET(req: MantaRequest) {
  const productService = req.scope.resolve<any>('productService')
  const product = await productService.findById(req.params.id)
  if (!product) {
    return Response.json({ type: 'NOT_FOUND', message: 'Product not found' }, { status: 404 })
  }
  return Response.json({ product })
}
