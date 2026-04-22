import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../db';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET ?? 'simba_secret';

// POST /auth/register
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { name, email, phone, password, referralCode } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ ok: false, error: 'Name, email and password are required' });
    }

    // Check existing
    const existing = await query('SELECT id FROM users WHERE email = ?', [email.toLowerCase()]);
    if (existing.length > 0) {
      return res.status(409).json({ ok: false, error: 'Email already registered' });
    }

    const id = uuidv4();
    const hash = await bcrypt.hash(password, 10);
    const code = `SIMBA${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

    await query(
      `INSERT INTO users (id, name, email, phone, password_hash, referral_code)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, name.trim(), email.toLowerCase().trim(), phone ?? null, hash, code]
    );

    // Apply referral bonus if valid code provided
    if (referralCode) {
      await query(
        `UPDATE users SET loyalty_points = loyalty_points + 50
         WHERE referral_code = ?`,
        [referralCode.toUpperCase()]
      );
    }

    return res.json({ ok: true, message: 'Account created. Please sign in.' });
  } catch (err: any) {
    console.error('[POST /auth/register]', err.message);
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
});

// POST /auth/login
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ ok: false, error: 'Email and password required' });
    }

    const users = await query<any>(
      'SELECT * FROM users WHERE email = ?',
      [email.toLowerCase().trim()]
    );

    if (users.length === 0) {
      return res.status(401).json({ ok: false, error: 'No account found with this email' });
    }

    const user = users[0];
    const valid = await bcrypt.compare(password, user.password_hash);

    if (!valid) {
      return res.status(401).json({ ok: false, error: 'Incorrect password' });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, name: user.name },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    return res.json({
      ok: true,
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        referralCode: user.referral_code,
        loyaltyPoints: user.loyalty_points,
      },
    });
  } catch (err: any) {
    console.error('[POST /auth/login]', err.message);
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
});

// GET /auth/me — get current user from token
router.get('/me', async (req: Request, res: Response) => {
  try {
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) {
      return res.status(401).json({ ok: false, error: 'No token' });
    }

    const token = auth.slice(7);
    const decoded = jwt.verify(token, JWT_SECRET) as any;

    const users = await query<any>('SELECT * FROM users WHERE id = ?', [decoded.id]);
    if (users.length === 0) {
      return res.status(404).json({ ok: false, error: 'User not found' });
    }

    const user = users[0];
    return res.json({
      ok: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        referralCode: user.referral_code,
        loyaltyPoints: user.loyalty_points,
      },
    });
  } catch {
    return res.status(401).json({ ok: false, error: 'Invalid token' });
  }
});

export default router;
