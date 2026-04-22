import nodemailer from 'nodemailer';

interface OrderEmailData {
  orderId: string;
  customerName: string;
  total: number;
  items: { name: string; quantity: number; price: number }[];
}

export async function sendOrderConfirmation(data: OrderEmailData): Promise<void> {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env;

  // Skip if email not configured
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return;

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT ?? 587),
    secure: false,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });

  const itemsList = data.items
    .map(i => `<tr><td>${i.name}</td><td>${i.quantity}</td><td>${(i.price * i.quantity).toLocaleString()} RWF</td></tr>`)
    .join('');

  await transporter.sendMail({
    from: SMTP_FROM ?? 'Simba Supermarket <noreply@simba.rw>',
    to: SMTP_USER, // send to admin for now
    subject: `Order Confirmed — #${data.orderId}`,
    html: `
      <div style="font-family:sans-serif;max-width:500px;margin:0 auto">
        <div style="background:#0F172A;padding:24px;border-radius:12px 12px 0 0">
          <h1 style="color:#EAB308;margin:0;font-size:24px">SIMBA</h1>
          <p style="color:rgba(255,255,255,0.6);margin:4px 0 0">Order Confirmation</p>
        </div>
        <div style="background:#f9f9f9;padding:24px;border-radius:0 0 12px 12px">
          <p>Hi <strong>${data.customerName}</strong>,</p>
          <p>Your order <strong>#${data.orderId}</strong> has been placed successfully!</p>
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
          <p style="color:#666">Expected delivery: 45 minutes</p>
          <p style="color:#666">Thank you for shopping with Simba Supermarket!</p>
        </div>
      </div>
    `,
  });
}
