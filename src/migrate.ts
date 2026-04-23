import { getPool, query } from './db';

export async function migrate() {
  const conn = await getPool().getConnection();
  try {
    // Users table
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id           VARCHAR(36)  PRIMARY KEY,
        name         VARCHAR(100) NOT NULL,
        email        VARCHAR(150) NOT NULL UNIQUE,
        phone        VARCHAR(20)  DEFAULT NULL,
        password_hash VARCHAR(255) NOT NULL,
        referral_code VARCHAR(20)  UNIQUE,
        loyalty_points INT         NOT NULL DEFAULT 0,
        created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await conn.execute(`
      CREATE TABLE IF NOT EXISTS password_reset_tokens (
        id          INT AUTO_INCREMENT PRIMARY KEY,
        user_id     VARCHAR(36)  NOT NULL,
        token       VARCHAR(255) NOT NULL UNIQUE,
        expires_at  DATETIME     NOT NULL,
        used_at     DATETIME     DEFAULT NULL,
        created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_password_reset_user_id (user_id),
        INDEX idx_password_reset_token (token)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // Orders table
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
        status           ENUM('processing','delivered','cancelled') NOT NULL DEFAULT 'processing',
        created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // Add missing columns to existing orders table (safe — ignores if already exists)
    const alterCols = [
      `ALTER TABLE orders ADD COLUMN pickup_branch VARCHAR(255) NOT NULL DEFAULT ''`,
      `ALTER TABLE orders ADD COLUMN pickup_slot VARCHAR(20) NOT NULL DEFAULT 'asap'`,
      `ALTER TABLE orders ADD COLUMN deposit_amount INT NOT NULL DEFAULT 0`,
      `ALTER TABLE orders ADD COLUMN fulfillment_type VARCHAR(20) NOT NULL DEFAULT 'pickup'`,
      `ALTER TABLE orders ADD COLUMN user_id VARCHAR(36) DEFAULT NULL`,
      `ALTER TABLE orders ADD COLUMN assigned_to VARCHAR(36) DEFAULT NULL`,
      `ALTER TABLE orders ADD COLUMN assigned_name VARCHAR(100) DEFAULT NULL`,
      `ALTER TABLE orders ADD COLUMN branch_status ENUM('pending','preparing','ready','picked_up') NOT NULL DEFAULT 'pending'`,
    ];
    for (const sql of alterCols) {
      try { await conn.execute(sql); } catch { /* column already exists — safe to ignore */ }
    }

    // Rename old delivery columns to pickup columns if they still exist
    const renameCols = [
      `ALTER TABLE orders CHANGE COLUMN delivery_address pickup_branch VARCHAR(255) NOT NULL DEFAULT ''`,
      `ALTER TABLE orders CHANGE COLUMN delivery_slot pickup_slot VARCHAR(20) NOT NULL DEFAULT 'asap'`,
    ];
    for (const sql of renameCols) {
      try { await conn.execute(sql); } catch { /* column doesn't exist or already renamed — safe to ignore */ }
    }

    // Branch staff table
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS branch_staff (
        id           VARCHAR(36)  PRIMARY KEY,
        name         VARCHAR(100) NOT NULL,
        username     VARCHAR(50)  NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        branch_id    VARCHAR(50)  NOT NULL,
        branch_name  VARCHAR(255) NOT NULL,
        role         ENUM('manager','staff') NOT NULL DEFAULT 'staff',
        created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // Seed default branch staff if table is empty
    const existing = await query<any>('SELECT COUNT(*) AS cnt FROM branch_staff');
    if (existing[0]?.cnt === 0) {
      const bcrypt = await import('bcryptjs');
      const managerHash = await bcrypt.hash('manager123', 10);
      const staffHash   = await bcrypt.hash('staff123', 10);
      const { v4: uuidv4 } = await import('uuid');

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
          `INSERT IGNORE INTO branch_staff (id, name, username, password_hash, branch_id, branch_name, role) VALUES (?,?,?,?,?,?,?)`,
          [uuidv4(), `Manager ${b.name}`, `manager_${b.id}`, managerHash, b.id, b.name, 'manager']
        );
        await conn.execute(
          `INSERT IGNORE INTO branch_staff (id, name, username, password_hash, branch_id, branch_name, role) VALUES (?,?,?,?,?,?,?)`,
          [uuidv4(), `Staff ${b.name}`, `staff_${b.id}`, staffHash, b.id, b.name, 'staff']
        );
      }
      console.log('[DB] Branch staff seeded');
    }

    // Order items table
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS order_items (
        id          INT AUTO_INCREMENT PRIMARY KEY,
        order_id    VARCHAR(20)  NOT NULL,
        product_id  INT          NOT NULL,
        name        VARCHAR(255) NOT NULL,
        price       INT          NOT NULL,
        quantity    INT          NOT NULL,
        unit        VARCHAR(50)  NOT NULL DEFAULT 'Pcs',
        image       VARCHAR(500) NOT NULL DEFAULT '',
        category    VARCHAR(100) NOT NULL DEFAULT '',
        FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    console.log('[DB] Migration complete');

    // Branch inventory table
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS branch_inventory (
        id           INT AUTO_INCREMENT PRIMARY KEY,
        branch_id    VARCHAR(50)  NOT NULL,
        product_id   INT          NOT NULL,
        stock_count  INT          NOT NULL DEFAULT 50,
        is_available TINYINT(1)   NOT NULL DEFAULT 1,
        updated_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_branch_product (branch_id, product_id),
        INDEX idx_branch (branch_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    console.log('[DB] Inventory table ready');

    // Branch reviews table
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS branch_reviews (
        id           INT AUTO_INCREMENT PRIMARY KEY,
        branch_id    VARCHAR(50)  NOT NULL,
        branch_name  VARCHAR(255) NOT NULL,
        user_id      VARCHAR(36)  DEFAULT NULL,
        user_name    VARCHAR(100) NOT NULL DEFAULT 'Anonymous',
        order_id     VARCHAR(20)  NOT NULL,
        rating       TINYINT      NOT NULL CHECK (rating BETWEEN 1 AND 5),
        comment      TEXT         DEFAULT NULL,
        created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_branch_reviews_branch (branch_id),
        UNIQUE KEY uq_order_review (order_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    console.log('[DB] Branch reviews table ready');
  } finally {
    conn.release();
  }
}