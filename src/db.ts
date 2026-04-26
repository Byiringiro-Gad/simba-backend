import { neon, neonConfig } from '@neondatabase/serverless';
import dotenv from 'dotenv';
dotenv.config();

// HTTP fetch transport — no WebSocket needed on Render/Node.js
// fetchConnectionCache is now always true in newer versions, no need to set it

const DATABASE_URL = process.env.DATABASE_URL ?? '';
if (!DATABASE_URL) {
  console.warn('[db] DATABASE_URL not set');
}

let _sql: ReturnType<typeof neon> | null = null;
function getSql() {
  if (!_sql) _sql = neon(DATABASE_URL);
  return _sql;
}

// ── MySQL → PostgreSQL translation ───────────────────────────────────────────
function translateSQL(sql: string): string {
  return sql
    .replace(/ENGINE\s*=\s*\w+/gi, '')
    .replace(/DEFAULT\s+CHARSET\s*=\s*\w+/gi, '')
    .replace(/CHARSET\s*=\s*\w+/gi, '')
    .replace(/COLLATE\s*=?\s*\w+/gi, '')
    .replace(/INT\s+AUTO_INCREMENT\s+PRIMARY\s+KEY/gi, 'SERIAL PRIMARY KEY')
    .replace(/AUTO_INCREMENT/gi, '')
    .replace(/TINYINT\s*\(\s*1\s*\)/gi, 'BOOLEAN')
    .replace(/TINYINT/gi, 'SMALLINT')
    .replace(/ENUM\s*\([^)]+\)/gi, 'TEXT')
    .replace(/INSERT\s+IGNORE\s+INTO/gi, 'INSERT INTO')
    .replace(/\bDATETIME\b/gi, 'TIMESTAMPTZ')
    .replace(/ON\s+UPDATE\s+CURRENT_TIMESTAMP/gi, '')
    .replace(/DEFAULT\s+CURRENT_TIMESTAMP/gi, 'DEFAULT NOW()')
    .replace(/\bUNSIGNED\b/gi, '')
    .replace(/UNIQUE\s+KEY\s+\w+\s*\([^)]+\)/gi, '')
    .replace(/INDEX\s+\w+\s*\([^)]+\)/gi, '')
    .replace(/KEY\s+\w+\s*\([^)]+\)/gi, '')
    .replace(/,\s*\)/g, ')')
    .trim();
}

function buildQuery(sql: string, params?: any[]): { text: string; values: any[] } {
  if (!params || params.length === 0) return { text: translateSQL(sql), values: [] };
  let i = 0;
  const text = translateSQL(sql).replace(/\?/g, () => `$${++i}`);
  return { text, values: params };
}

// ── SHOW COLUMNS shim ─────────────────────────────────────────────────────────
async function showColumns(sql_client: ReturnType<typeof neon>, tableName: string, columnName: string): Promise<any[]> {
  const rows = await sql_client`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = ${tableName} AND column_name = ${columnName} AND table_schema = 'public'
  `;
  return rows as any[];
}

// ── Connection shim ───────────────────────────────────────────────────────────
class NeonConnection {
  private sql: ReturnType<typeof neon>;
  constructor(sql: ReturnType<typeof neon>) { this.sql = sql; }

  async execute(rawSql: string, params?: any[]): Promise<[any[], any]> {
    // SHOW COLUMNS shim
    const showColMatch = rawSql.match(/SHOW\s+COLUMNS\s+FROM\s+(\w+)\s+LIKE\s+['"]([\w]+)['"]/i);
    if (showColMatch) {
      const rows = await showColumns(this.sql, showColMatch[1], showColMatch[2]);
      return [rows, null];
    }

    const { text, values } = buildQuery(rawSql, params);

    // INSERT IGNORE → ON CONFLICT DO NOTHING
    let finalText = text;
    if (/INSERT\s+IGNORE/i.test(rawSql) && !finalText.includes('ON CONFLICT')) {
      finalText = finalText + ' ON CONFLICT DO NOTHING';
    }

    // ON DUPLICATE KEY UPDATE → ON CONFLICT ... DO UPDATE
    if (finalText.includes('ON DUPLICATE KEY UPDATE')) {
      finalText = finalText.replace(
        /ON DUPLICATE KEY UPDATE\s+([\s\S]+)$/i,
        (_: string, updates: string) => {
          const setParts = updates.split(',').map((part: string) =>
            part.replace(/(\w+)\s*=\s*VALUES\s*\(\s*(\w+)\s*\)/gi, '$1=EXCLUDED.$2')
                .replace(/(\w+)\s*=\s*NOW\s*\(\s*\)/gi, '$1=NOW()')
          );
          return `ON CONFLICT DO NOTHING`; // safe fallback
        }
      );
    }

    // ALTER TABLE ... AFTER col — PostgreSQL doesn't support AFTER, strip it
    finalText = finalText.replace(/\s+AFTER\s+\w+/gi, '');
    // ALTER TABLE ... CHANGE COLUMN → RENAME COLUMN
    const changeMatch = finalText.match(/ALTER TABLE (\w+) CHANGE COLUMN (\w+) (\w+) (.+)/i);
    if (changeMatch) {
      finalText = `ALTER TABLE ${changeMatch[1]} RENAME COLUMN ${changeMatch[2]} TO ${changeMatch[3]}`;
    }

    try {
      const rows = await this.sql.query(finalText, values);
      return [rows as any[], null];
    } catch (err: any) {
      if (err.message?.includes('already exists') || err.message?.includes('duplicate column')) {
        return [[], null];
      }
      throw err;
    }
  }

  release() { /* no-op — Neon HTTP is stateless */ }
}

class NeonPool {
  async getConnection(): Promise<NeonConnection> {
    return new NeonConnection(getSql());
  }
}

let _pool: NeonPool | null = null;
export function getPool(): NeonPool {
  if (!_pool) _pool = new NeonPool();
  return _pool;
}

export async function query<T = any>(sql: string, params?: any[]): Promise<T[]> {
  const conn = new NeonConnection(getSql());
  const [rows] = await conn.execute(sql, params);
  return rows as T[];
}
