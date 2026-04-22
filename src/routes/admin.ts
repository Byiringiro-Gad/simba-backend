import { Router, Request, Response, NextFunction } from 'express';
import { query } from '../db';

const router = Router();

// Middleware — verify admin credentials via Basic Auth or header
function adminAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.headers['x-admin-token'];
  const expected = process.env.ADMIN_PASSWORD ?? 'admin123';
  if (token !== expected) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }
  return next();
}

// POST /admin/login
router.post('/login', (req: Request, res: Response) => {
  const { username, password } = req.body;
  const validUser = process.env.ADMIN_USERNAME ?? 'admin';
  const validPass = process.env.ADMIN_PASSWORD ?? 'admin123';

  if (username === validUser && password === validPass) {
    return res.json({ ok: true, token: validPass });
  }
  return res.status(401).json({ ok: false, error: 'Invalid credentials' });
});

// GET /admin/orders — all orders
router.get('/orders', adminAuth, async (_req: Request, res: Response) => {
  try {
    const orders = await query<any>(
      `SELECT o.*, u.email AS user_email
       FROM orders o
       LEFT JOIN users u ON u.id = o.user_id
       ORDER BY o.created_at DESC`
    );

    const result = await Promise.all(
      orders.map(async (o: any) => {
        const items = await query(
          `SELECT product_id AS id, name, price, quantity, unit, image, category
           FROM order_items WHERE order_id = ?`,
          [o.id]
        );
        return { ...o, items, date: o.created_at };
      })
    );

    return res.json(result);
  } catch (err: any) {
    console.error('[GET /admin/orders]', err.message);
    return res.json([]);
  }
});

// PATCH /admin/orders/:id — update status
router.patch('/orders/:id', adminAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!['processing', 'delivered', 'cancelled'].includes(status)) {
      return res.status(400).json({ ok: false, error: 'Invalid status' });
    }

    await query(
      'UPDATE orders SET status = ?, updated_at = NOW() WHERE id = ?',
      [status, id]
    );

    return res.json({ ok: true });
  } catch (err: any) {
    console.error('[PATCH /admin/orders/:id]', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /admin/stats — dashboard stats
router.get('/stats', adminAuth, async (_req: Request, res: Response) => {
  try {
    const [totals] = await query<any>(`
      SELECT
        COUNT(*) AS total_orders,
        SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) AS processing,
        SUM(CASE WHEN status = 'delivered'  THEN 1 ELSE 0 END) AS delivered,
        SUM(CASE WHEN status = 'cancelled'  THEN 1 ELSE 0 END) AS cancelled,
        SUM(CASE WHEN status != 'cancelled' THEN total ELSE 0 END) AS revenue,
        SUM(CASE WHEN DATE(created_at) = CURDATE() THEN 1 ELSE 0 END) AS today
      FROM orders
    `);

    const [userCount] = await query<any>('SELECT COUNT(*) AS total FROM users');

    return res.json({
      ok: true,
      stats: { ...totals, total_users: userCount.total },
    });
  } catch (err: any) {
    console.error('[GET /admin/stats]', err.message);
    return res.status(500).json({ ok: false });
  }
});

export default router;
