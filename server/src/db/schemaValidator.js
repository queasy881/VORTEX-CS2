import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { pool, query } from './pool.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const REQUIRED_SCHEMA = {
  users: {
    columns: {
      id: { type: 'uuid', nullable: false },
      username: { type: 'character varying', nullable: false, maxLength: 32 },
      email: { type: 'character varying', nullable: false, maxLength: 255 },
      password_hash: { type: 'text', nullable: false },
      created_at: { type: 'timestamp with time zone', nullable: true },
    },
  },
  friendships: {
    columns: {
      id: { type: 'uuid', nullable: false },
      requester_id: { type: 'uuid', nullable: true },
      addressee_id: { type: 'uuid', nullable: true },
      status: { type: 'character varying', nullable: false, maxLength: 16 },
      created_at: { type: 'timestamp with time zone', nullable: true },
    },
  },
  files: {
    columns: {
      id: { type: 'uuid', nullable: false },
      owner_id: { type: 'uuid', nullable: true },
      filename: { type: 'text', nullable: false },
      r2_key: { type: 'text', nullable: false },
      original_size_bytes: { type: 'bigint', nullable: false },
      compressed_size_bytes: { type: 'bigint', nullable: false },
      mime_type: { type: 'text', nullable: true },
      created_at: { type: 'timestamp with time zone', nullable: true },
    },
  },
  file_shares: {
    columns: {
      id: { type: 'uuid', nullable: false },
      file_id: { type: 'uuid', nullable: true },
      shared_with_user_id: { type: 'uuid', nullable: true },
      shared_at: { type: 'timestamp with time zone', nullable: true },
    },
  },
  refresh_tokens: {
    columns: {
      id: { type: 'uuid', nullable: false },
      user_id: { type: 'uuid', nullable: true },
      token_hash: { type: 'text', nullable: false },
      expires_at: { type: 'timestamp with time zone', nullable: false },
      revoked: { type: 'boolean', nullable: true },
      created_at: { type: 'timestamp with time zone', nullable: true },
    },
  },
};

const REQUIRED_INDEXES = [
  'idx_friendships_requester',
  'idx_friendships_addressee',
  'idx_files_owner',
  'idx_shares_user',
  'idx_refresh_tokens_user',
  'idx_refresh_tokens_hash',
];

export async function repairLegacySchema() {
  const dropped = [];
  for (const tableName of Object.keys(REQUIRED_SCHEMA)) {
    const exists = await query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1`,
      [tableName]
    );
    if (exists.rowCount === 0) continue;

    const cols = await query(
      `SELECT column_name, data_type, character_maximum_length
       FROM information_schema.columns
       WHERE table_schema='public' AND table_name=$1`,
      [tableName]
    );
    const existingCols = {};
    for (const row of cols.rows) {
      existingCols[row.column_name] = {
        type: row.data_type,
        maxLength: row.character_maximum_length,
      };
    }

    const expected = REQUIRED_SCHEMA[tableName].columns;
    let mismatch = false;
    for (const [colName, exp] of Object.entries(expected)) {
      const actual = existingCols[colName];
      if (!actual || actual.type !== exp.type) {
        mismatch = true;
        break;
      }
      if (exp.maxLength && actual.maxLength !== exp.maxLength) {
        mismatch = true;
        break;
      }
    }

    if (mismatch) {
      await pool.query(`DROP TABLE IF EXISTS ${tableName} CASCADE`);
      dropped.push(tableName);
    }
  }
  return dropped;
}

export async function runMigrations() {
  const sqlPath = join(__dirname, 'schema.sql');
  const sql = await readFile(sqlPath, 'utf8');
  await pool.query(sql);
}

export async function validateSchema() {
  const errors = [];

  const tablesResult = await query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`
  );
  const existingTables = new Set(tablesResult.rows.map((r) => r.table_name));

  for (const tableName of Object.keys(REQUIRED_SCHEMA)) {
    if (!existingTables.has(tableName)) {
      errors.push(`Missing table: ${tableName}`);
      continue;
    }

    const colsResult = await query(
      `SELECT column_name, data_type, is_nullable, character_maximum_length
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1`,
      [tableName]
    );

    const existingCols = {};
    for (const row of colsResult.rows) {
      existingCols[row.column_name] = {
        type: row.data_type,
        nullable: row.is_nullable === 'YES',
        maxLength: row.character_maximum_length,
      };
    }

    const required = REQUIRED_SCHEMA[tableName].columns;
    for (const [colName, expected] of Object.entries(required)) {
      const actual = existingCols[colName];
      if (!actual) {
        errors.push(`Missing column: ${tableName}.${colName}`);
        continue;
      }
      if (actual.type !== expected.type) {
        errors.push(
          `Type mismatch: ${tableName}.${colName} expected '${expected.type}', got '${actual.type}'`
        );
      }
      if (expected.maxLength && actual.maxLength !== expected.maxLength) {
        errors.push(
          `Length mismatch: ${tableName}.${colName} expected length ${expected.maxLength}, got ${actual.maxLength}`
        );
      }
    }
  }

  const indexResult = await query(
    `SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`
  );
  const existingIndexes = new Set(indexResult.rows.map((r) => r.indexname));
  for (const idx of REQUIRED_INDEXES) {
    if (!existingIndexes.has(idx)) {
      errors.push(`Missing index: ${idx}`);
    }
  }

  return { valid: errors.length === 0, errors };
}
