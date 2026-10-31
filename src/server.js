import { createApp } from './app.js';
import { connectDatabase, migrate } from './database.js';
const pool = connectDatabase(process.env.DATABASE_URL);
await migrate(pool);
const app = createApp({ pool });
const server = app.listen(Number(process.env.PORT || 4181), '0.0.0.0', () => console.log('booking-service listening'));
async function shutdown() {
  server.close(async () => { await pool.end(); process.exit(0); });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
