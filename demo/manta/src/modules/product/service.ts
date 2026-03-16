// ProductService — Drizzle ORM implementation

import { eq, sql, and, isNull, lt } from "drizzle-orm"
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js"
import { products } from "@manta/core/db"
import type { ProductData, CreateProductInput } from './models/product'

export class ProductService {
  private db: PostgresJsDatabase

  constructor(db: PostgresJsDatabase) {
    this.db = db
  }

  async create(data: CreateProductInput): Promise<ProductData> {
    const id = `prod_${crypto.randomUUID().replace(/-/g, '')}`
    const now = new Date()
    const status = data.status ?? 'draft'

    const [row] = await this.db.insert(products).values({
      id,
      title: data.title,
      description: data.description ?? null,
      sku: data.sku,
      price: data.price,
      status,
      image_urls: [],
      catalog_file_url: null,
      metadata: {},
      created_at: now,
      updated_at: now,
    }).returning()

    return toProductData(row)
  }

  async findById(id: string): Promise<ProductData | null> {
    const [row] = await this.db.select().from(products).where(eq(products.id, id))
    return row ? toProductData(row) : null
  }

  async findBySku(sku: string): Promise<ProductData | null> {
    const [row] = await this.db.select().from(products).where(eq(products.sku, sku))
    return row ? toProductData(row) : null
  }

  async update(id: string, data: Partial<CreateProductInput>): Promise<ProductData> {
    const sets: Record<string, unknown> = {}

    if (data.title !== undefined) sets.title = data.title
    if (data.description !== undefined) sets.description = data.description ?? null
    if (data.price !== undefined) sets.price = data.price
    if (data.status !== undefined) sets.status = data.status

    if (Object.keys(sets).length === 0) {
      const existing = await this.findById(id)
      if (!existing) throw new Error(`Product "${id}" not found`)
      return existing
    }

    const [row] = await this.db.update(products)
      .set({ ...sets, updated_at: new Date() })
      .where(eq(products.id, id))
      .returning()

    if (!row) throw new Error(`Product "${id}" not found`)
    return toProductData(row)
  }

  async list(): Promise<ProductData[]> {
    const rows = await this.db.select().from(products)
      .where(isNull(products.deleted_at))
      .orderBy(sql`${products.created_at} DESC`)
    return rows.map(toProductData)
  }

  async updateImages(id: string, urls: string[]): Promise<void> {
    const result = await this.db.update(products)
      .set({ image_urls: urls, updated_at: new Date() })
      .where(eq(products.id, id))
      .returning({ id: products.id })
    if (result.length === 0) throw new Error(`Product "${id}" not found`)
  }

  async updateCatalogUrl(id: string, url: string): Promise<void> {
    const result = await this.db.update(products)
      .set({ catalog_file_url: url, updated_at: new Date() })
      .where(eq(products.id, id))
      .returning({ id: products.id })
    if (result.length === 0) throw new Error(`Product "${id}" not found`)
  }

  async updateStatus(id: string, status: 'draft' | 'active' | 'archived'): Promise<void> {
    const result = await this.db.update(products)
      .set({ status, updated_at: new Date() })
      .where(eq(products.id, id))
      .returning({ id: products.id })
    if (result.length === 0) throw new Error(`Product "${id}" not found`)
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(products).where(eq(products.id, id))
  }

  async deleteDraftsOlderThan(hours: number): Promise<string[]> {
    const cutoff = sql`NOW() - ${`${hours} hours`}::interval`
    const rows = await this.db.delete(products)
      .where(and(
        eq(products.status, 'draft'),
        lt(products.created_at, cutoff)
      ))
      .returning({ id: products.id })
    return rows.map(r => r.id)
  }

  async countByStatus(status: string): Promise<number> {
    const [row] = await this.db.select({ count: sql<number>`count(*)::int` })
      .from(products)
      .where(eq(products.status, status as typeof products.status.enumValues[number]))
    return row.count
  }

  async _reset(): Promise<void> {
    await this.db.delete(products)
  }
}

function toProductData(row: typeof products.$inferSelect): ProductData {
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? null,
    sku: row.sku ?? '',
    price: row.price,
    status: row.status as ProductData['status'],
    image_urls: row.image_urls ?? [],
    catalog_file_url: row.catalog_file_url ?? null,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}
