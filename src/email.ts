import nodemailer from 'nodemailer';

interface OrderEmailData {
  orderId: string;
  customerName: string;
  customerEmail?: string | null;
  total: number;
  items: { name: string; quantity: number; price: number }[];
}

interface PasswordResetEmailData {
  customerName: string;
  email: string;
  resetLink: string;
}

function getTransporter() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;

  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return null;

  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT ?? 587),
    secure: false,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
}

function getFromAddress() {
  return process.env.SMTP_FROM ?? 'Simba Supermarket <noreply@simba.rw>';
}

export async function sendOrderConfirmation(data: OrderEmailData): Promise<void> {
  const transporter = getTransporter();
  if (!transporter || !data.customerEmail) return;

  const itemsList = data.items
    .map((item) => `<tr><td>${item.name}</td><td>${item.quantity}</td><td>${(item.price * item.quantity).toLocaleString()} RWF</td></tr>`)
    .join('');

  await transporter.sendMail({
    from: getFromAddress(),
    to: data.customerEmail,
    subject: `Order Confirmed - #${data.orderId}`,
    html: `
      <div style="font-family:sans-serif;max-width:500px;margin:0 auto">
        <div style="background:#0F172A;padding:24px;border-radius:12px 12px 0 0">
          <h1 style="color:#EAB308;margin:0;font-size:24px">SIMBA</h1>
          <p style="color:rgba(255,255,255,0.6);margin:4px 0 0">Order Confirmation</p>
        </div>
        <div style="background:#f9f9f9;padding:24px;border-radius:0 0 12px 12px">
          <p>Hi <strong>${data.customerName}</strong>,</p>
          <p>Your order <strong>#${data.orderId}</strong> has been placed successfully.</p>
          <table style="width:100%;border-collapse:collapse;margin:16px 0">
            <thead>
              <tr style="background:#eee">
                <th style="padding:8px;text-align:left">Product</th>
                <th style="padding:8px;text-align:left">Qty</th>
                <th style="padding:8px;text-align:left">Price</th>
              </tr>
            </thead>
            <tbody>${itemsList}</tbody>
          </table>
          <p style="font-size:18px;font-weight:bold">Total: ${data.total.toLocaleString()} RWF</p>
          <p style="color:#666">Your branch will prepare your order for pickup.</p>
          <p style="color:#666">Thank you for shopping with Simba Supermarket.</p>
        </div>
      </div>
    `,
  });
}

export async function sendPasswordResetEmail(data: PasswordResetEmailData): Promise<boolean> {
  const transporter = getTransporter();
  if (!transporter) return false;

  await transporter.sendMail({
    from: getFromAddress(),
    to: data.email,
    subject: 'Reset your Simba password',
    html: `
      <div style="font-family:sans-serif;max-width:500px;margin:0 auto">
        <div style="background:#0F172A;padding:24px;border-radius:12px 12px 0 0">
          <h1 style="color:#EAB308;margin:0;font-size:24px">SIMBA</h1>
          <p style="color:rgba(255,255,255,0.6);margin:4px 0 0">Password Reset</p>
        </div>
        <div style="background:#f9f9f9;padding:24px;border-radius:0 0 12px 12px">
          <p>Hi <strong>${data.customerName}</strong>,</p>
          <p>We received a request to reset your Simba password.</p>
          <p style="margin:24px 0">
            <a href="${data.resetLink}" style="background:#0F172A;color:#fff;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:700;display:inline-block">
              Reset Password
            </a>
          </p>
          <p style="color:#666">If the button does not work, copy and paste this link into your browser:</p>
          <p style="word-break:break-all;color:#444">${data.resetLink}</p>
          <p style="color:#666">This link expires in 1 hour.</p>
        </div>
      </div>
    `,
  });

  return true;
}

