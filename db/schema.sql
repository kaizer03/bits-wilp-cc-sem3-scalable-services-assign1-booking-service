CREATE TABLE IF NOT EXISTS bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  equipment_id UUID NOT NULL,
  equipment_name VARCHAR(100) NOT NULL,
  asset_tag VARCHAR(30) NOT NULL,
  booking_date DATE NOT NULL,
  slot VARCHAR(2) NOT NULL CHECK (slot IN ('AM', 'PM')),
  requester VARCHAR(80) NOT NULL,
  purpose VARCHAR(200) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled')),
  request_key UUID NOT NULL UNIQUE,
  request_hash VARCHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  cancelled_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS bookings_active_slot ON bookings(equipment_id, booking_date, slot) WHERE status='confirmed';
