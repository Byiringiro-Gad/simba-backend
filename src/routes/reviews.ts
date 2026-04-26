import { Router, Request, Response } from 'express';
import { query } from '../db';

const router = Router();

// POST /reviews — submit a branch review after pickup
router.post('/', async (req: Request, res: Response) => {
  try {
    const { branchId, branchName, userId, userName, orderId, rating, comment } = req.body;

    if (!branchId || !orderId || !rating) {
      return res.status(400).json({ ok: false, error: 'branchId, orderId and rating are required' });
    }

    if (rating < 1 || rating > 5) {
      return res.status(400).json({ ok: false, error: 'Rating must be between 1 and 5' });
    }

    // One review per order
    await query(
      `INSERT INTO branch_reviews (branch_id, branch_name, user_id, user_name, order_id, rating, comment)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (order_id) DO UPDATE SET
         rating = EXCLUDED.rating,
         comment = EXCLUDED.comment`,
      [
        branchId,
        branchName ?? branchId,
        userId ?? null,
        userName ?? 'Anonymous',
        orderId,
        rating,
        comment ?? null,
      ]
    );

    return res.json({ ok: true });
  } catch (err: any) {
    console.error('[POST /reviews]', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /reviews/:branchId — get reviews + average rating for a branch
router.get('/:branchId', async (req: Request, res: Response) => {
  try {
    const { branchId } = req.params;

    const reviews = await query<any>(
      `SELECT id, user_name, rating, comment, created_at
       FROM branch_reviews
       WHERE branch_id = ?
       ORDER BY created_at DESC
       LIMIT 20`,
      [branchId]
    );

    const [stats] = await query<any>(
      `SELECT
         COUNT(*) AS total,
         ROUND(AVG(rating), 1) AS avg_rating
       FROM branch_reviews
       WHERE branch_id = ?`,
      [branchId]
    );

    return res.json({
      ok: true,
      reviews,
      total: stats?.total ?? 0,
      avgRating: stats?.avg_rating ?? null,
    });
  } catch (err: any) {
    console.error('[GET /reviews/:branchId]', err.message);
    return res.status(500).json({ ok: false, reviews: [], total: 0, avgRating: null });
  }
});

// GET /reviews — get average ratings for ALL branches at once
router.get('/', async (_req: Request, res: Response) => {
  try {
    const rows = await query<any>(
      `SELECT
         branch_id,
         COUNT(*) AS total,
         ROUND(AVG(rating), 1) AS avg_rating
       FROM branch_reviews
       GROUP BY branch_id`
    );

    const ratings: Record<string, { total: number; avgRating: number }> = {};
    for (const row of rows) {
      ratings[row.branch_id] = { total: row.total, avgRating: row.avg_rating };
    }

    return res.json({ ok: true, ratings });
  } catch (err: any) {
    console.error('[GET /reviews]', err.message);
    return res.status(500).json({ ok: false, ratings: {} });
  }
});

export default router;
