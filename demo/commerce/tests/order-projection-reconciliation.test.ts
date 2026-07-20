import { describe, expect, it } from 'vitest'
import {
  auditOrderProjection,
  reconcileOrderProjectionLinks,
  type OrderProjectionDb,
} from '../src/modules/order/reconcile-order-projection'

describe('order projection reconciliation', () => {
  it('reports missing and duplicate links without storing customer payloads', async () => {
    let auditSql = ''
    const db: OrderProjectionDb = {
      raw: async <T>(sql: string) => {
        auditSql = sql
        return [
          {
            projected_orders: 3,
            missing_cart_order_links: 1,
            missing_order_contact_links: 2,
            duplicate_order_contact_pairs: 1,
            orphan_cart_order_links: 0,
            orphan_order_contact_links: 0,
          },
        ] as T[]
      },
    }

    await expect(auditOrderProjection(db)).resolves.toEqual({
      projected_orders: 3,
      missing_cart_order_links: 1,
      missing_order_contact_links: 2,
      duplicate_order_contact_pairs: 1,
      orphan_cart_order_links: 0,
      orphan_order_contact_links: 0,
    })
    expect(auditSql).toContain('WHERE c.deleted_at IS NULL')
  })

  it('repairs local links idempotently and returns before/after evidence', async () => {
    const calls: string[] = []
    const summaries = [
      {
        projected_orders: 2,
        missing_cart_order_links: 1,
        missing_order_contact_links: 1,
        duplicate_order_contact_pairs: 1,
        orphan_cart_order_links: 0,
        orphan_order_contact_links: 0,
      },
      {
        projected_orders: 2,
        missing_cart_order_links: 0,
        missing_order_contact_links: 0,
        duplicate_order_contact_pairs: 0,
        orphan_cart_order_links: 0,
        orphan_order_contact_links: 0,
      },
    ]
    const db: OrderProjectionDb = {
      raw: async <T>(sql: string) => {
        calls.push(sql)
        if (sql.includes('projected_orders')) return [summaries.shift()] as T[]
        if (sql.includes('inserted_cart_order_links')) {
          return [{ inserted_cart_order_links: 1, inserted_order_contact_links: 1, deleted_duplicate_links: 1 }] as T[]
        }
        throw new Error(`Unexpected SQL: ${sql}`)
      },
    }

    const result = await reconcileOrderProjectionLinks(db, { dryRun: false })

    expect(result).toEqual({
      before: expect.objectContaining({ missing_cart_order_links: 1, missing_order_contact_links: 1 }),
      after: expect.objectContaining({ missing_cart_order_links: 0, missing_order_contact_links: 0 }),
      inserted_cart_order_links: 1,
      inserted_order_contact_links: 1,
      deleted_duplicate_links: 1,
      dry_run: false,
    })
    expect(calls.some((sql) => sql.includes('INSERT INTO cart_order'))).toBe(true)
    expect(calls.some((sql) => sql.includes('INSERT INTO order_contact'))).toBe(true)
  })

  it('keeps reconciliation read-only unless an apply is explicitly requested', async () => {
    const calls: string[] = []
    const db: OrderProjectionDb = {
      raw: async <T>(sql: string) => {
        calls.push(sql)
        return [
          {
            projected_orders: 1,
            missing_cart_order_links: 1,
            missing_order_contact_links: 0,
            duplicate_order_contact_pairs: 0,
            orphan_cart_order_links: 0,
            orphan_order_contact_links: 0,
          },
        ] as T[]
      },
    }

    const result = await reconcileOrderProjectionLinks(db)

    expect(result.dry_run).toBe(true)
    expect(result.after).toEqual(result.before)
    expect(calls).toHaveLength(1)
  })
})
