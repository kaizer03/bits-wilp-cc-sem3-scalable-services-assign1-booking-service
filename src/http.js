import { randomUUID } from 'node:crypto';
import os from 'node:os';
export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export function middleware(app, name) {
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    const supplied = req.get('X-Request-ID');
    req.requestId = supplied && /^[a-zA-Z0-9-]{1,80}$/.test(supplied) ? supplied : randomUUID();
    res.set({ 'X-Request-ID': req.requestId, 'X-Instance-ID': os.hostname(), 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin' });
    const start = Date.now();
    res.on('finish', () => console.log(JSON.stringify({ service: name, requestId: req.requestId, method: req.method, path: req.path, status: res.statusCode, durationMs: Date.now() - start, instance: os.hostname() })));
    next();
  });
}
export function errors(app) {
  app.use((req, res) => res.status(404).json({ error: 'Route not found' }));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status = error.status || (error.type === 'entity.parse.failed' ? 400 : 500);
    if (status >= 500) console.error(JSON.stringify({ requestId: req.requestId, code: error.code, message: error.message }));
    res.status(status).json({ error: status === 500 ? 'The service could not complete the request.' : error.message, requestId: req.requestId });
  });
}
export function identifier(value) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value || '')) throw new HttpError(400, 'A valid identifier is required.');
  return value;
}
export function text(value, label, max = 120) {
  if (typeof value !== 'string' || value.trim().length < 2 || value.trim().length > max) throw new HttpError(400, `${label} must contain 2 to ${max} characters.`);
  return value.trim();
}
