export async function POST(req: Request & { app?: any }) {
  const db = req.app?.resolve?.('IDatabasePort')
  const pool = db?.getPool?.()
  if (!pool) {
    return new Response(JSON.stringify({ error: 'No DB pool' }), { status: 500 })
  }

  try {
    const pg = pool as { unsafe: (q: string) => Promise<any[]> }

    // Find carts where the cart_token is actually a checkout_token
    // (i.e., another cart exists with that value as checkout_token)
    // These are duplicate entries created before cart_token was sent correctly.
    //
    // Strategy:
    // 1. Find carts whose cart_token matches another cart's checkout_token
    // 2. Move their events to the real cart (the one with the matching checkout_token)
    // 3. Delete the orphan cart

    const orphans = await pg.unsafe(`
      SELECT orphan.id AS orphan_id, orphan.cart_token AS orphan_token,
             real_cart.id AS real_id, real_cart.cart_token AS real_token
      FROM carts orphan
      JOIN carts real_cart ON real_cart.checkout_token = orphan.cart_token
      WHERE orphan.id != real_cart.id
    `)

    if (orphans.length === 0) {
      return new Response(JSON.stringify({ consolidated: 0, events_moved: 0 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    let totalEventsMoved = 0

    for (const row of orphans) {
      // Move events from orphan cart to real cart
      const moved = await pg.unsafe(`
        UPDATE cart_events SET cart_id = '${row.real_id.replace(/'/g, "''")}'
        WHERE cart_id = '${row.orphan_id.replace(/'/g, "''")}'
      `)
      totalEventsMoved += (moved as any).count ?? 0

      // Merge identity: copy email/name from orphan to real if real is missing them
      await pg.unsafe(`
        UPDATE carts SET
          email = COALESCE(carts.email, orphan.email),
          first_name = COALESCE(carts.first_name, orphan.first_name),
          last_name = COALESCE(carts.last_name, orphan.last_name),
          phone = COALESCE(carts.phone, orphan.phone),
          city = COALESCE(carts.city, orphan.city),
          country_code = COALESCE(carts.country_code, orphan.country_code),
          shopify_customer_id = COALESCE(carts.shopify_customer_id, orphan.shopify_customer_id),
          updated_at = NOW()
        FROM carts orphan
        WHERE carts.id = '${row.real_id.replace(/'/g, "''")}'
          AND orphan.id = '${row.orphan_id.replace(/'/g, "''")}'
      `)

      // Delete the orphan cart
      await pg.unsafe(`
        DELETE FROM carts WHERE id = '${row.orphan_id.replace(/'/g, "''")}'
      `)
    }

    console.log(`[cart-tracking] Consolidated ${orphans.length} orphan carts, ${totalEventsMoved} events moved`)

    return new Response(JSON.stringify({
      consolidated: orphans.length,
      events_moved: totalEventsMoved,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('[cart-tracking] Consolidate error:', err)
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500 })
  }
}
