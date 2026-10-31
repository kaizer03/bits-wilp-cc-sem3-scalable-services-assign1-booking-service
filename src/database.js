import pg from 'pg';
import { readFile } from 'node:fs/promises';
export function connectDatabase(connectionString) {
  if (!connectionString && !process.env.PGHOST) throw new Error('DATABASE_URL or PostgreSQL connection settings are required');
  return new pg.Pool({ connectionString, max: 5, connectionTimeoutMillis: 3000, idleTimeoutMillis: 10000 });
}
export async function migrate(pool) {
  const connection = await pool.connect();
  try {
    await connection.query('BEGIN');
    await connection.query("SELECT pg_advisory_xact_lock(58301)");
    await connection.query(await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8'));
    await connection.query('COMMIT');
  } catch (error) {
    await connection.query('ROLLBACK');
    throw error;
  } finally { connection.release(); }
}
