import { Router, Request, Response } from 'express';
import { query, getPool } from '../db';
import jwt from 'jsonwebtoken';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET ?? 'simba_secret';

// Auth middleware (optional — public GET, protected PATCH)
function branchAuth(req: Request, res: Response, next: Function) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) {
    return res.status(401).json({ ok: false, error: 'No token' });
  }
  try {
    (req as any).staff = jwt.verify(auth.slice(7), JWT_SECRET);
    return next();
  } catch {
    return res.status(401).json({ ok: false, error: 'Invalid token' });
  }
}

// GET /inventory/:branchId — get all inventory for a branch
router.get('/:branchId', async (req: Request, res: Response) => {
  try {
    const { branchId } = req.params;

    let rows = await query<any>(
      `SELECT product_id, stock_count, is_available
       FROM branch_inventory
       WHERE branch_id = ?`,
      [branchId]
    );

    // Auto-seed if this branch has no inventory yet
    if (rows.length === 0) {
      // Get all product IDs from order_items to seed (use a fixed set of common IDs)
      // Seed with deterministic stock for all known product IDs
      try {
        const products = await query<any>('SELECT DISTINCT product_id FROM order_items LIMIT 500');
        if (products.length > 0) {
          const conn = await getPool().getConnection();
          try {
            for (const p of products) {
              const stock = 10 + (p.product_id % 50);
              await conn.execute(
                `INSERT IGNORE INTO branch_inventory (branch_id, product_id, stock_count, is_available) VALUES (?, ?, ?, 1)`,
                [branchId, p.product_id, stock]
              );
            }
          } finally {
            conn.release();
          }
          // Re-fetch after seeding
          rows = await query<any>(
            `SELECT product_id, stock_count, is_available FROM branch_inventory WHERE branch_id = ?`,
            [branchId]
          );
        }
      } catch { /* silent — return empty inventory */ }
    }

    const inventory: Record<number, { stockCount: number; isAvailable: boolean }> = {};
    for (const row of rows) {
      inventory[row.product_id] = {
        stockCount: row.stock_count,
        isAvailable: row.is_available === 1,
      };
    }

    return res.json({ ok: true, inventory });
  } catch (err: any) {
    console.error('[GET /inventory/:branchId]', err.message);
    return res.status(500).json({ ok: false, inventory: {} });
  }
});

// PATCH /inventory/:branchId/:productId — staff updates stock
router.patch('/:branchId/:productId', branchAuth, async (req: Request, res: Response) => {
  try {
    const { branchId, productId } = req.params;
    const { stockCount, isAvailable } = req.body;

    // Upsert
    await query(
      `INSERT INTO branch_inventory (branch_id, product_id, stock_count, is_available)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         stock_count  = VALUES(stock_count),
         is_available = VALUES(is_available),
         updated_at   = NOW()`,
      [branchId, Number(productId), stockCount ?? 0, isAvailable ? 1 : 0]
    );

    return res.json({ ok: true });
  } catch (err: any) {
    console.error('[PATCH /inventory]', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /inventory/:branchId/seed — seed default stock for all products
// Called once per branch to initialize inventory
router.post('/:branchId/seed', async (req: Request, res: Response) => {
  try {
    const { branchId } = req.params;
    const { productIds } = req.body; // array of product IDs

    if (!Array.isArray(productIds) || productIds.length === 0) {
      return res.status(400).json({ ok: false, error: 'productIds array required' });
    }

    const conn = await getPool().getConnection();
    try {
      for (const pid of productIds) {
        // Deterministic stock: 10-60 based on product ID
        const stock = 10 + (pid % 50);
        await conn.execute(
          `INSERT IGNORE INTO branch_inventory (branch_id, product_id, stock_count, is_available)
           VALUES (?, ?, ?, 1)`,
          [branchId, pid, stock]
        );
      }
    } finally {
      conn.release();
    }

    return res.json({ ok: true, seeded: productIds.length });
  } catch (err: any) {
    console.error('[POST /inventory/seed]', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// Internal function — decrease stock when order placed
export async function decreaseStock(branchId: string, items: Array<{ id: number; quantity: number }>) {
  for (const item of items) {
    try {
      await query(
        `UPDATE branch_inventory
         SET stock_count = GREATEST(0, stock_count - ?),
             is_available = CASE WHEN stock_count - ? <= 0 THEN 0 ELSE is_available END,
             updated_at = NOW()
         WHERE branch_id = ? AND product_id = ?`,
        [item.quantity, item.quantity, branchId, item.id]
      );
    } catch (err: any) {
      console.warn(`[decreaseStock] ${err.message}`);
    }
  }
}

export default router;
