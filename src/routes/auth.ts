import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import { query } from '../db';
import { sendPasswordResetEmail } from '../email';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET ?? 'simba_secret';

function buildResetLink(token: string) {
  const frontendUrl = process.env.FRONTEND_URL ?? 'https://simba2gad.vercel.app';
  return `${frontendUrl.replace(/\/$/, '')}/reset-password?token=${encodeURIComponent(token)}`;
}

async function ensureResetSchema() {
  await query(`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id         SERIAL       PRIMARY KEY,
      user_id    VARCHAR(36)  NOT NULL,
      token      VARCHAR(255) NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ  NOT NULL,
      used_at    TIMESTAMPTZ  DEFAULT NULL,
      created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `);
}

router.post('/register', async (req: Request, res: Response) => {
  try {
    const { name, email, phone, password, referralCode } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ ok: false, error: 'Name, email and password are required' });
    }

    const existing = await query('SELECT id FROM users WHERE email = ?', [email.toLowerCase().trim()]);
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

router.post('/forgot-password', async (req: Request, res: Response) => {
  try {
    const email = String(req.body?.email ?? '').toLowerCase().trim();
    if (!email) {
      return res.status(400).json({ ok: false, error: 'Email is required' });
    }

    await ensureResetSchema();

    const users = await query<any>('SELECT id, name, email FROM users WHERE email = ?', [email]);
    if (users.length === 0) {
      return res.json({ ok: true, message: 'If that email exists, a reset link has been prepared.' });
    }

    const user = users[0];
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    await query('UPDATE password_reset_tokens SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL', [user.id]);
    await query(
      `INSERT INTO password_reset_tokens (user_id, token, expires_at)
       VALUES (?, ?, ?)`,
      [user.id, token, expiresAt]
    );

    const resetLink = buildResetLink(token);
    const emailSent = await sendPasswordResetEmail({
      customerName: user.name,
      email: user.email,
      resetLink,
    });

    return res.json({
      ok: true,
      message: emailSent
        ? 'Reset link sent. Check your inbox.'
        : 'Reset link generated. Use the link below.',
      resetLink: emailSent ? undefined : resetLink,
    });
  } catch (err: any) {
    console.error('[POST /auth/forgot-password]', err.message);
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
});

router.post('/reset-password', async (req: Request, res: Response) => {
  try {
    const token = String(req.body?.token ?? '').trim();
    const password = String(req.body?.password ?? '');

    if (!token || !password || password.length < 6) {
      return res.status(400).json({ ok: false, error: 'Valid token and password are required' });
    }

    await ensureResetSchema();

    const rows = await query<any>(
      `SELECT * FROM password_reset_tokens
       WHERE token = ? AND used_at IS NULL AND expires_at > NOW()
       ORDER BY id DESC LIMIT 1`,
      [token]
    );

    if (rows.length === 0) {
      return res.status(400).json({ ok: false, error: 'Reset link is invalid or expired' });
    }

    const resetToken = rows[0];
    const passwordHash = await bcrypt.hash(password, 10);

    await query('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, resetToken.user_id]);
    await query('UPDATE password_reset_tokens SET used_at = NOW() WHERE id = ?', [resetToken.id]);

    return res.json({ ok: true, message: 'Password reset successful. You can sign in now.' });
  } catch (err: any) {
    console.error('[POST /auth/reset-password]', err.message);
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
});

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

