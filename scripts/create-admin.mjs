#!/usr/bin/env node
// Create an admin user directly in the database — zero framework dependency.
// Usage: DATABASE_URL="postgresql://..." node scripts/create-admin.mjs email password
//
// Like Medusa's `medusa user` — just raw SQL, works with any PostgreSQL.

import { randomBytes, scryptSync } from 'node:crypto'
import postgres from 'postgres'

const email = process.argv[2] || process.env.MANTA_ADMIN_EMAIL
const password = process.argv[3] || process.env.MANTA_ADMIN_PASSWORD
const dbUrl = process.env.DATABASE_URL

if (!email || !password) {
  console.error('Usage: DATABASE_URL="..." node scripts/create-admin.mjs <email> <password>')
  console.error('   or: DATABASE_URL="..." MANTA_ADMIN_EMAIL=x MANTA_ADMIN_PASSWORD=y node scripts/create-admin.mjs')
  process.exit(1)
}
if (!dbUrl) {
  console.error('DATABASE_URL is required')
  process.exit(1)
}

const isNeon = dbUrl.includes('neon.tech') || dbUrl.includes('neon.')
const sql = postgres(dbUrl, { ssl: isNeon ? 'require' : undefined, max: 1 })

try {
  // Check if already exists
  const existing = await sql`SELECT id FROM provider_identities WHERE entity_id = ${email} AND provider = 'emailpass' LIMIT 1`
  if (existing.length > 0) {
    console.log(`User ${email} already exists — nothing to do`)
    await sql.end()
    process.exit(0)
  }

  // Hash password (scrypt, same as framework)
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 64).toString('hex')
  const hashedPassword = `${salt}:${hash}`

  const uuid = () => randomBytes(16).toString('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5')

  // Create auth_identity
  const authId = uuid()
  await sql`INSERT INTO auth_identities (id, app_metadata) VALUES (${authId}, ${{ user_type: 'admin' }})`
  console.log(`auth_identity created: ${authId}`)

  // Create provider_identity
  const providerId = uuid()
  await sql`INSERT INTO provider_identities (id, entity_id, provider, auth_identity_id, user_metadata, provider_metadata)
    VALUES (${providerId}, ${email}, 'emailpass', ${authId}, ${{ email }}, ${{ password: hashedPassword }})`
  console.log(`provider_identity created: ${providerId}`)

  // Create admin_user
  const userId = uuid()
  try {
    await sql`INSERT INTO admin_user (id, email, first_name, last_name) VALUES (${userId}, ${email}, 'Admin', 'User')`
    console.log(`admin_user created: ${userId}`)
  } catch (err) {
    console.warn(`admin_user insert skipped: ${err.message}`)
  }

  console.log(`\nDone! Login with: ${email}`)
} catch (err) {
  console.error('FAILED:', err.message)
  process.exit(1)
} finally {
  await sql.end()
}
