const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("railway")
    ? { rejectUnauthorized: false }
    : false,
});

async function initDB() {
  // Check if users table has UUID id (old schema) and drop all if so
  const check = await pool.query(`
    SELECT data_type FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'id'
  `);
  // Also check if user_key column is missing (old schema)
  const keyCheck = await pool.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'user_key'
  `);
  if (check.rows.length > 0 && (check.rows[0].data_type === 'uuid' || keyCheck.rows.length === 0)) {
    console.log("Detected old UUID schema, dropping tables to recreate...");
    await pool.query("DROP TABLE IF EXISTS command_queue CASCADE");
    await pool.query("DROP TABLE IF EXISTS sessions CASCADE");
    await pool.query("DROP TABLE IF EXISTS agents CASCADE");
    await pool.query("DROP TABLE IF EXISTS users CASCADE");
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(50) UNIQUE NOT NULL,
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      user_key VARCHAR(64) UNIQUE NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS agents (
      id SERIAL PRIMARY KEY,
      filename VARCHAR(255) NOT NULL,
      file_data BYTEA NOT NULL,
      file_size INTEGER NOT NULL,
      uploaded_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      token VARCHAR(64) UNIQUE NOT NULL,
      machine_name VARCHAR(255),
      status VARCHAR(20) DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT NOW(),
      last_seen TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS command_queue (
      id SERIAL PRIMARY KEY,
      session_id INTEGER REFERENCES sessions(id) ON DELETE CASCADE,
      command VARCHAR(255) NOT NULL,
      args TEXT,
      status VARCHAR(20) DEFAULT 'pending',
      result TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      completed_at TIMESTAMP
    )
  `);

  console.log("Database tables initialized");
}

module.exports = { pool, initDB };
