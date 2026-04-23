import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { migrate } from './migrate';
import authRoutes from './routes/auth';
import ordersRoutes from './routes/orders';
import adminRoutes from './routes/admin';
import branchRoutes from './routes/branch';
import inventoryRoutes from './routes/inventory';
import reviewsRoutes from './routes/reviews';

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT ?? 4000);

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors({
  origin: [
    process.env.FRONTEND_URL ?? 'https://simba2gad.vercel.app',
    'http://localhost:3000',
  ],
  credentials: true,
}));
app.use(express.json({ limit: '2mb' }));

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/', (_req: Request, res: Response) => {
  res.json({ ok: true, service: 'Simba Backend API', version: '1.0.0' });
});

app.get('/health', (_req: Request, res: Response) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/auth', authRoutes);
app.use('/orders', ordersRoutes);
app.use('/admin', adminRoutes);
app.use('/branch', branchRoutes);
app.use('/inventory', inventoryRoutes);
app.use('/reviews', reviewsRoutes);

// ── Start ─────────────────────────────────────────────────────────────────────
async function start() {
  try {
    await migrate();
    app.listen(PORT, () => {
      console.log(`✅ Simba Backend running on port ${PORT}`);
    });
  } catch (err) {
    console.error('❌ Failed to start:', err);
    process.exit(1);
  }
}

start();
