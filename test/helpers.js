import { once } from 'node:events';
import { connectDatabase, migrate } from '../src/database.js';
export async function database() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url || !new URL(url).pathname.endsWith('_test')) throw new Error('TEST_DATABASE_URL must name a database ending in _test');
  const pool = connectDatabase(url); await migrate(pool); return pool;
}
export async function serve(app) {
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => server.close(resolve)) };
}
export async function request(url, path, method = 'GET', body, headers = {}) {
  const response = await fetch(`${url}${path}`, {method,headers:{'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});
  return {status:response.status, body:await response.json(),headers:response.headers};
}
