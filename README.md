# Simba Backend API

Express.js + MySQL backend for Simba Supermarket.

## Endpoints

### Auth
- `POST /auth/register` — create account
- `POST /auth/login` — login, returns JWT token
- `GET /auth/me` — get current user (requires Bearer token)

### Orders
- `POST /orders` — place an order
- `GET /orders?userId=xxx` — get orders for a user

### Admin (requires `x-admin-token` header)
- `POST /admin/login` — admin login
- `GET /admin/orders` — all orders
- `PATCH /admin/orders/:id` — update order status
- `GET /admin/stats` — dashboard statistics

## Deploy on Render

1. Push this `backend/` folder as a separate GitHub repo
2. Go to render.com → New Web Service → connect the repo
3. Set environment variables:
   - `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` — from Railway
   - `DB_SSL=true`
   - `ADMIN_PASSWORD=admin123`
   - `JWT_SECRET=any_random_string`
   - `FRONTEND_URL=https://simba-2-ebon.vercel.app`

## Local Development

```bash
npm install
cp .env.example .env
# fill in .env with your local DB credentials
npm run dev
```
