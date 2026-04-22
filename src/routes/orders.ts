import { Router, Request, Response } from 'express';
import { query } from '../db';
import { sendOrderConfirmation } from '../email';

const router = Router();

// POST /orders — place a new order
router.post('/', async (req: Request, res: Response) => {
  const conn = await (await import('../db')).getPool().getConnection();
  try {
    const {
      id, userId, customerName, customerPhone, deliveryAddress,
      deliverySlot, paymentMethod, items,
      subtotal, deliveryFee, discount, total, promoCode,
    } = req.body;

    if (!id || !items?.length || !total) {
      return res.status(400).json({ ok: false, error: 'Missing required fields' });
    }

    // Insert order
    await conn.execute(
      `INSERT INTO orders
        (id, user_id, customer_name, customer_phone, delivery_address,
         delivery_slot, payment_method, subtotal, delivery_fee, discount,
         total, promo_code, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'processing')`,
      [
        id, userId ?? null,
        customerName ?? '', customerPhone ?? '', deliveryAddress ?? '',
        deliverySlot ?? 'asap', paymentMethod ?? 'mtn',
        subtotal ?? 0, deliveryFee ?? 1000, discount ?? 0,
        total, promoCode ?? null,
      ]
    );

    // Insert items
    for (const item of items) {
      await conn.execute(
        `INSERT INTO order_items
          (order_id, product_id, name, price, quantity, unit, image, category)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id, item.id, item.name, item.price, item.quantity,
          item.unit ?? 'Pcs',
          (item.image ?? '').slice(0, 499),
          item.category ?? '',
        ]
      );
    }

    // Add loyalty points to user if logged in
    if (userId) {
      const points = Math.floor(total / 100);
      await conn.execute(
        'UPDATE users SET loyalty_points = loyalty_points + ? WHERE id = ?',
        [points, userId]
      );
    }

    // Send confirmation email (non-blocking)
    if (customerPhone) {
      sendOrderConfirmation({
        orderId: id,
        customerName: customerName ?? 'Customer',
        total,
        items,
      }).catch(() => {}); // don't fail if email fails
    }

    return res.json({ ok: true, id });
  } catch (err: any) {
    console.error('[POST /orders]', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  } finally {
    conn.release();
  }
});

// GET /orders?userId=xxx — get orders for a user
router.get('/', async (req: Request, res: Response) => {
  try {
    const { userId } = req.query;

    const orders = await query<any>(
      `SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC`,
      [userId]
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

    return res.json({ ok: true, orders: result });
  } catch (err: any) {
    console.error('[GET /orders]', err.message);
    return res.status(500).json({ ok: false, orders: [] });
  }
});

export default router;
