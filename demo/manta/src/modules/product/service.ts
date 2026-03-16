// ProductService — in-memory implementation for demo scenario

import type { ProductData, CreateProductInput } from './models/product'

export class ProductService {
  private _products = new Map<string, ProductData>()

  async create(data: CreateProductInput): Promise<ProductData> {
    const id = `prod_${crypto.randomUUID().replace(/-/g, '')}`
    const now = new Date()

    const product: ProductData = {
      id,
      title: data.title,
      description: data.description ?? null,
      sku: data.sku,
      price: data.price,
      status: data.status ?? 'draft',
      image_urls: [],
      catalog_file_url: null,
      metadata: {},
      created_at: now,
      updated_at: now,
    }

    this._products.set(id, product)
    return { ...product }
  }

  async findById(id: string): Promise<ProductData | null> {
    return this._products.get(id) ? { ...this._products.get(id)! } : null
  }

  async findBySku(sku: string): Promise<ProductData | null> {
    for (const p of this._products.values()) {
      if (p.sku === sku) return { ...p }
    }
    return null
  }

  async update(id: string, data: Partial<CreateProductInput>): Promise<ProductData> {
    const product = this._products.get(id)
    if (!product) throw new Error(`Product "${id}" not found`)
    if (data.title !== undefined) product.title = data.title
    if (data.description !== undefined) product.description = data.description ?? null
    if (data.price !== undefined) product.price = data.price
    if (data.status !== undefined) product.status = data.status ?? product.status
    product.updated_at = new Date()
    return { ...product }
  }

  async list(): Promise<ProductData[]> {
    return Array.from(this._products.values()).map(p => ({ ...p }))
  }

  async updateImages(id: string, urls: string[]): Promise<void> {
    const product = this._products.get(id)
    if (!product) throw new Error(`Product "${id}" not found`)
    product.image_urls = urls
    product.updated_at = new Date()
  }

  async updateCatalogUrl(id: string, url: string): Promise<void> {
    const product = this._products.get(id)
    if (!product) throw new Error(`Product "${id}" not found`)
    product.catalog_file_url = url
    product.updated_at = new Date()
  }

  async updateStatus(id: string, status: 'draft' | 'active' | 'archived'): Promise<void> {
    const product = this._products.get(id)
    if (!product) throw new Error(`Product "${id}" not found`)
    product.status = status
    product.updated_at = new Date()
  }

  async delete(id: string): Promise<void> {
    this._products.delete(id)
  }

  async deleteDraftsOlderThan(hours: number): Promise<string[]> {
    const cutoff = Date.now() - hours * 60 * 60 * 1000
    const deleted: string[] = []
    for (const [id, product] of this._products) {
      if (product.status === 'draft' && product.created_at.getTime() <= cutoff) {
        this._products.delete(id)
        deleted.push(id)
      }
    }
    return deleted
  }

  async countByStatus(status: string): Promise<number> {
    let count = 0
    for (const p of this._products.values()) {
      if (p.status === status) count++
    }
    return count
  }

  _reset(): void {
    this._products.clear()
  }
}
