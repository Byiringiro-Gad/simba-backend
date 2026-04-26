import { getPool, query } from './db';

export async function migrate() {
  const conn = await getPool().getConnection();
  try {
    // Users
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id             VARCHAR(36)  PRIMARY KEY,
        name           VARCHAR(100) NOT NULL,
        email          VARCHAR(150) NOT NULL UNIQUE,
        phone          VARCHAR(20)  DEFAULT NULL,
        password_hash  VARCHAR(255) NOT NULL DEFAULT '',
        referral_code  VARCHAR(20)  UNIQUE,
        loyalty_points INT          NOT NULL DEFAULT 0,
        google_id      VARCHAR(100) DEFAULT NULL,
        created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )
    `);

    // Password reset tokens
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS password_reset_tokens (
        id         SERIAL       PRIMARY KEY,
        user_id    VARCHAR(36)  NOT NULL,
        token      VARCHAR(255) NOT NULL UNIQUE,
        expires_at TIMESTAMPTZ  NOT NULL,
        used_at    TIMESTAMPTZ  DEFAULT NULL,
        created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )
    `);

    // Orders
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS orders (
        id               VARCHAR(20)  PRIMARY KEY,
        user_id          VARCHAR(36)  DEFAULT NULL,
        customer_name    VARCHAR(100) NOT NULL DEFAULT '',
        customer_phone   VARCHAR(20)  NOT NULL DEFAULT '',
        pickup_branch    VARCHAR(255) NOT NULL DEFAULT '',
        pickup_slot      VARCHAR(20)  NOT NULL DEFAULT 'asap',
        payment_method   VARCHAR(10)  NOT NULL DEFAULT 'mtn',
        subtotal         INT          NOT NULL DEFAULT 0,
        delivery_fee     INT          NOT NULL DEFAULT 0,
        discount         INT          NOT NULL DEFAULT 0,
        deposit_amount   INT          NOT NULL DEFAULT 0,
        total            INT          NOT NULL,
        promo_code       VARCHAR(20)  DEFAULT NULL,
        fulfillment_type VARCHAR(20)  NOT NULL DEFAULT 'pickup',
        status           VARCHAR(20)  NOT NULL DEFAULT 'processing',
        assigned_to      VARCHAR(36)  DEFAULT NULL,
        assigned_name    VARCHAR(100) DEFAULT NULL,
        branch_status    VARCHAR(20)  NOT NULL DEFAULT 'pending',
        created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )
    `);

    // Order items
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS order_items (
        id          SERIAL       PRIMARY KEY,
        order_id    VARCHAR(20)  NOT NULL,
        product_id  INT          NOT NULL,
        name        VARCHAR(255) NOT NULL,
        price       INT          NOT NULL,
        quantity    INT          NOT NULL,
        unit        VARCHAR(50)  NOT NULL DEFAULT 'Pcs',
        image       VARCHAR(500) NOT NULL DEFAULT '',
        category    VARCHAR(100) NOT NULL DEFAULT '',
        FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
      )
    `);

    // Branch staff
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS branch_staff (
        id            VARCHAR(36)  PRIMARY KEY,
        name          VARCHAR(100) NOT NULL,
        username      VARCHAR(50)  NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        branch_id     VARCHAR(50)  NOT NULL,
        branch_name   VARCHAR(255) NOT NULL,
        role          VARCHAR(10)  NOT NULL DEFAULT 'staff',
        created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )
    `);

    // Seed branch staff if empty
    const existing = await query<any>('SELECT COUNT(*) AS cnt FROM branch_staff');
    if (Number(existing[0]?.cnt) === 0) {
      const bcrypt = await import('bcryptjs');
      const { v4: uuidv4 } = await import('uuid');
      const managerHash = await bcrypt.hash('manager123', 10);
      const staffHash   = await bcrypt.hash('staff123', 10);

      const branches = [
        { id: 'remera',     name: 'Simba Supermarket Remera' },
        { id: 'kimironko',  name: 'Simba Supermarket Kimironko' },
        { id: 'kacyiru',    name: 'Simba Supermarket Kacyiru' },
        { id: 'nyamirambo', name: 'Simba Supermarket Nyamirambo' },
        { id: 'gikondo',    name: 'Simba Supermarket Gikondo' },
        { id: 'kanombe',    name: 'Simba Supermarket Kanombe' },
        { id: 'kinyinya',   name: 'Simba Supermarket Kinyinya' },
        { id: 'kibagabaga', name: 'Simba Supermarket Kibagabaga' },
        { id: 'nyanza',     name: 'Simba Supermarket Nyanza' },
      ];

      for (const b of branches) {
        await conn.execute(
          `INSERT INTO branch_staff (id, name, username, password_hash, branch_id, branch_name, role)
           VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (username) DO NOTHING`,
          [uuidv4(), `Manager ${b.name}`, `manager_${b.id}`, managerHash, b.id, b.name, 'manager']
        );
        await conn.execute(
          `INSERT INTO branch_staff (id, name, username, password_hash, branch_id, branch_name, role)
           VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (username) DO NOTHING`,
          [uuidv4(), `Staff ${b.name}`, `staff_${b.id}`, staffHash, b.id, b.name, 'staff']
        );
      }
      console.log('[DB] Branch staff seeded');
    }

    // Branch inventory
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS branch_inventory (
        id           SERIAL      PRIMARY KEY,
        branch_id    VARCHAR(50) NOT NULL,
        product_id   INT         NOT NULL,
        stock_count  INT         NOT NULL DEFAULT 50,
        is_available BOOLEAN     NOT NULL DEFAULT true,
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (branch_id, product_id)
      )
    `);

    // Branch reviews
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS branch_reviews (
        id          SERIAL       PRIMARY KEY,
        branch_id   VARCHAR(50)  NOT NULL,
        branch_name VARCHAR(255) NOT NULL,
        user_id     VARCHAR(36)  DEFAULT NULL,
        user_name   VARCHAR(100) NOT NULL DEFAULT 'Anonymous',
        order_id    VARCHAR(20)  NOT NULL UNIQUE,
        rating      SMALLINT     NOT NULL CHECK (rating BETWEEN 1 AND 5),
        comment     TEXT         DEFAULT NULL,
        created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )
    `);

    console.log('[DB] Migration complete — Neon PostgreSQL');
  } finally {
    conn.release();
  }
}
