import { Router, Request, Response } from 'express';
import { query } from '../db';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET ?? 'simba_secret';

// ── Auth middleware ───────────────────────────────────────────────────────────
function branchAuth(req: Request, res: Response, next: Function) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) {
    return res.status(401).json({ ok: false, error: 'No token' });
  }
  try {
    const decoded = jwt.verify(auth.slice(7), JWT_SECRET) as any;
    (req as any).staff = decoded;
    return next();
  } catch {
    return res.status(401).json({ ok: false, error: 'Invalid token' });
  }
}

// POST /branch/login
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ ok: false, error: 'Username and password required' });
    }

    const staff = await query<any>(
      'SELECT * FROM branch_staff WHERE username = ?',
      [username.toLowerCase().trim()]
    );

    if (staff.length === 0) {
      return res.status(401).json({ ok: false, error: 'No account found' });
    }

    const s = staff[0];
    const valid = await bcrypt.compare(password, s.password_hash);
    if (!valid) {
      return res.status(401).json({ ok: false, error: 'Incorrect password' });
    }

    const token = jwt.sign(
      { id: s.id, name: s.name, username: s.username, branchId: s.branch_id, branchName: s.branch_name, role: s.role },
      JWT_SECRET,
      { expiresIn: '12h' }
    );

    return res.json({
      ok: true,
      token,
      staff: { id: s.id, name: s.name, username: s.username, branchId: s.branch_id, branchName: s.branch_name, role: s.role },
    });
  } catch (err: any) {
    console.error('[POST /branch/login]', err.message);
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
});

// GET /branch/orders — get orders for this branch (manager sees all, staff sees assigned)
router.get('/orders', branchAuth, async (req: Request, res: Response) => {
  try {
    const staff = (req as any).staff;
    let orders: any[];

    if (staff.role === 'manager') {
      orders = await query<any>(
        `SELECT o.*, u.email AS user_email
         FROM orders o
         LEFT JOIN users u ON u.id = o.user_id
         WHERE o.pickup_branch = ?
         ORDER BY o.created_at DESC`,
        [staff.branchName]
      );
    } else {
      // Staff sees only orders assigned to them
      orders = await query<any>(
        `SELECT o.*, u.email AS user_email
         FROM orders o
         LEFT JOIN users u ON u.id = o.user_id
         WHERE o.pickup_branch = ? AND o.assigned_to = ?
         ORDER BY o.created_at DESC`,
        [staff.branchName, staff.id]
      );
    }

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

    return res.json({ ok: true, orders: result });
  } catch (err: any) {
    console.error('[GET /branch/orders]', err.message);
    return res.status(500).json({ ok: false, orders: [] });
  }
});

// GET /branch/staff-list — manager gets list of staff in their branch
router.get('/staff-list', branchAuth, async (req: Request, res: Response) => {
  try {
    const staff = (req as any).staff;
    if (staff.role !== 'manager') {
      return res.status(403).json({ ok: false, error: 'Manager only' });
    }

    const staffList = await query<any>(
      `SELECT id, name, username, role FROM branch_staff WHERE branch_id = ? AND role = 'staff'`,
      [staff.branchId]
    );

    return res.json({ ok: true, staff: staffList });
  } catch (err: any) {
    console.error('[GET /branch/staff-list]', err.message);
    return res.status(500).json({ ok: false, staff: [] });
  }
});

// PATCH /branch/orders/:id/assign — manager assigns order to staff
router.patch('/orders/:id/assign', branchAuth, async (req: Request, res: Response) => {
  try {
    const manager = (req as any).staff;
    if (manager.role !== 'manager') {
      return res.status(403).json({ ok: false, error: 'Manager only' });
    }

    const { staffId, staffName } = req.body;
    const { id } = req.params;

    await query(
      `UPDATE orders SET assigned_to = ?, assigned_name = ?, branch_status = 'preparing', updated_at = NOW() WHERE id = ?`,
      [staffId, staffName, id]
    );

    return res.json({ ok: true });
  } catch (err: any) {
    console.error('[PATCH /branch/orders/:id/assign]', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// PATCH /branch/orders/:id/status — staff updates branch_status
router.patch('/orders/:id/status', branchAuth, async (req: Request, res: Response) => {
  try {
    const { branchStatus } = req.body;
    const { id } = req.params;

    const validStatuses = ['pending', 'preparing', 'ready', 'picked_up'];
    if (!validStatuses.includes(branchStatus)) {
      return res.status(400).json({ ok: false, error: 'Invalid status' });
    }

    // If picked_up, also update main order status to delivered
    if (branchStatus === 'picked_up') {
      await query(
        `UPDATE orders SET branch_status = ?, status = 'delivered', updated_at = NOW() WHERE id = ?`,
        [branchStatus, id]
      );
    } else {
      await query(
        `UPDATE orders SET branch_status = ?, updated_at = NOW() WHERE id = ?`,
        [branchStatus, id]
      );
    }

    return res.json({ ok: true });
  } catch (err: any) {
    console.error('[PATCH /branch/orders/:id/status]', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /branch/me — get current staff info from token
router.get('/me', branchAuth, (req: Request, res: Response) => {
  return res.json({ ok: true, staff: (req as any).staff });
});

export default router;
