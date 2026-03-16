// Product model — DML definition per DEMO_SCENARIO_SPEC
import { model } from '@manta/core'

export const Product = model.define('Product', {
  id: model.id(),
  title: model.text(),
  description: model.text(),
  sku: model.text(),
  price: model.number(),
  status: model.enum(['draft', 'active', 'archived']),
  image_urls: model.json(),
  catalog_file_url: model.text(),
  metadata: model.json(),
  created_at: model.dateTime(),
  updated_at: model.dateTime(),
})

// Runtime types for use in services
export interface ProductData {
  id: string
  title: string
  description?: string | null
  sku: string
  price: number
  status: 'draft' | 'active' | 'archived'
  image_urls: string[]
  catalog_file_url?: string | null
  metadata: Record<string, unknown>
  created_at: Date
  updated_at: Date
}

export interface CreateProductInput {
  title: string
  description?: string | null
  sku: string
  price: number
  status?: 'draft' | 'active' | 'archived'
}
