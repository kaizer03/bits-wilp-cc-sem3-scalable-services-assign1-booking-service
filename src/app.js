import express from 'express';
import { createHash, randomUUID } from 'node:crypto';
import { middleware, errors, HttpError, identifier, text } from './http.js';
const fields = `id, equipment_id AS "equipmentId", equipment_name AS "equipmentName", asset_tag AS "assetTag", to_char(booking_date,'YYYY-MM-DD') AS date, slot, requester, purpose, status, created_at AS "createdAt", cancelled_at AS "cancelledAt"`;
export function localToday() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date()); }
export function validDate(value, { future = false } = {}) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000') || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw new HttpError(400, 'Choose a valid booking date.');
  if (future && value < localToday()) throw new HttpError(400, 'Bookings cannot be made for past dates.');
  return value;
}
export function createApp({ pool, equipmentUrl = process.env.EQUIPMENT_SERVICE_URL || 'http://127.0.0.1:4180', timeout = 2500 }) {
  const app = express();
  middleware(app, 'booking');
  app.use(express.json({ limit: '32kb' }));
  app.use((req, res, next) => {
    if (['POST', 'PATCH'].includes(req.method) && (!req.body || typeof req.body !== 'object' || Array.isArray(req.body))) return next(new HttpError(400, 'A JSON object is required.'));
    next();
  });
  app.get('/health/live', (req, res) => res.json({ status: 'up', service: 'booking' }));
  app.get('/health/ready', async (req, res) => { await pool.query('SELECT 1'); res.json({ status: 'ready' }); });
  app.get('/api/bookings', async (req, res) => {
    const date = req.query.date ? validDate(req.query.date) : null;
    const result = await pool.query(`SELECT ${fields} FROM bookings WHERE ($1::date IS NULL OR booking_date=$1) ORDER BY booking_date DESC, created_at DESC LIMIT 500`, [date]);
    res.json(result.rows);
  });
  app.get('/api/bookings/:id', async (req, res) => {
    const result = await pool.query(`SELECT ${fields} FROM bookings WHERE id=$1`, [identifier(req.params.id)]);
    if (!result.rowCount) throw new HttpError(404, 'Booking was not found.');
    res.json(result.rows[0]);
  });
  app.get('/api/availability', async (req, res) => {
    const date = validDate(req.query.date);
    const result = await pool.query(`SELECT equipment_id AS "equipmentId", slot FROM bookings WHERE booking_date=$1 AND status='confirmed'`, [date]);
    res.json({ date, reserved: result.rows });
  });
  app.post('/api/bookings', async (req, res) => {
    const equipmentId = identifier(req.body.equipmentId);
    const date = validDate(req.body.date);
    const slot = req.body.slot;
    if (!['AM', 'PM'].includes(slot)) throw new HttpError(400, 'Choose a morning or afternoon slot.');
    const requester = text(req.body.requester, 'Requester', 80);
    const purpose = text(req.body.purpose, 'Purpose', 200);
    const key = identifier(req.get('Idempotency-Key') || randomUUID());
    const hash = createHash('sha256').update(JSON.stringify({ equipmentId, date, slot, requester, purpose })).digest('hex');
    async function replay() {
      const existing = await pool.query(`SELECT ${fields}, request_hash FROM bookings WHERE request_key=$1`, [key]);
      if (!existing.rowCount) return false;
      const booking = existing.rows[0];
      if (booking.request_hash !== hash) throw new HttpError(409, 'That request key has already been used for different booking details.');
      delete booking.request_hash;
      res.set('Idempotency-Replayed', 'true').json(booking);
      return true;
    }
    if (await replay()) return;
    validDate(date, { future: true });
    let product;
    try {
      const response = await fetch(`${equipmentUrl}/api/equipment/${equipmentId}`, { headers: { 'X-Request-ID': req.requestId }, signal: AbortSignal.timeout(timeout) });
      if (response.status === 404) throw new HttpError(404, 'Equipment was not found.');
      if (!response.ok) throw new HttpError(503, 'Equipment service is temporarily unavailable. Please try again.');
      product = await response.json();
    } catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(503, 'Equipment service is temporarily unavailable. Please try again.'); }
    if (product.status !== 'operational') throw new HttpError(409, 'This equipment is under maintenance and cannot be booked.');
    try {
      const result = await pool.query(`INSERT INTO bookings(equipment_id,equipment_name,asset_tag,booking_date,slot,requester,purpose,request_key,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING ${fields}`, [equipmentId, product.name, product.assetTag, date, slot, requester, purpose, key, hash]);
      res.status(201).json(result.rows[0]);
    } catch (error) {
      if (error.code === '23505') { if (await replay()) return; throw new HttpError(409, 'This equipment is already booked for the selected date and slot.'); }
      throw error;
    }
  });
  app.patch('/api/bookings/:id/cancel', async (req, res) => {
    const result = await pool.query(`UPDATE bookings SET status='cancelled', cancelled_at=COALESCE(cancelled_at,now()) WHERE id=$1 RETURNING ${fields}`, [identifier(req.params.id)]);
    if (!result.rowCount) throw new HttpError(404, 'Booking was not found.');
    res.json(result.rows[0]);
  });
  errors(app);
  return app;
}
