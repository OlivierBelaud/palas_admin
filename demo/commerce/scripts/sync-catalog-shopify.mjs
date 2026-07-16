import postgres from 'postgres'
import { syncCatalogToShopify } from '../vercel-fast-functions/catalog-shopify-sync.mjs'

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required')

const sql = postgres(process.env.DATABASE_URL, { max: 1 })
try {
  const results = await syncCatalogToShopify(sql)
  const products = results.reduce((total, result) => total + result.products, 0)
  console.log(JSON.stringify({ collections: results.length, collectionProductLinks: products }))
} finally {
  await sql.end()
}
