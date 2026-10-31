# Resource Desk booking service

Reservations and availability for shared department equipment. This service owns booking data and validates equipment through the [equipment service](https://github.com/kaizer03/bits-wilp-cc-sem3-scalable-services-assign1-equipment-service). It can be built, deployed and tested independently.

## Reservation rules

- One equipment item, one date and one morning (`AM`) or afternoon (`PM`) slot per reservation.
- Past calendar dates are rejected using Asia/Kolkata. Same-day slots are permitted.
- Equipment must exist and be operational when validated.
- A PostgreSQL partial unique index allows only one confirmed booking for an equipment/date/slot combination, including concurrent requests.
- Cancelling changes the reservation status and releases its slot while retaining history.
- A UUID `Idempotency-Key` returns the existing reservation when the same request is repeated. Reusing the key for different details returns 409. A key is generated when the header is omitted.
- Equipment name and asset tag are copied into the reservation. Existing bookings can be read during an equipment-service outage.

## Run locally

Requirements: Docker and Compose. The full two-service application is configured in the equipment repository. This repository also provides a standalone deployment for this service and its database:

```sh
printf 'BOOKING_DB_PASSWORD=%s\n' "$(openssl rand -hex 24)" > .env
docker compose up -d --build
```

The API listens at <http://127.0.0.1:4181>. The default equipment address is `http://host.docker.internal:4180`; `EQUIPMENT_SERVICE_URL` overrides it. A working equipment endpoint is required to create new bookings. Database ports are not published.

Native execution uses Node.js 24 or newer, `DATABASE_URL` (or `PGHOST`, `PGUSER`, `PGDATABASE`, `PGPASSWORD`), and `EQUIPMENT_SERVICE_URL`:

```sh
npm ci
npm start
```

The schema is initialized on startup. For Kubernetes, `deploy/kubernetes/` contains this service's API, database and persistent volume resources. The equipment repository README describes namespace, credentials, image loading and deployment for the complete application.

## API

| Method | Path | Operation |
| --- | --- | --- |
| POST | `/api/bookings` | Create a reservation |
| GET | `/api/bookings` | List up to 500 bookings, latest dates first |
| GET | `/api/bookings?date=YYYY-MM-DD` | Filter by date |
| GET | `/api/bookings/:id` | Retrieve a reservation |
| PATCH | `/api/bookings/:id/cancel` | Cancel a reservation |
| GET | `/api/availability?date=YYYY-MM-DD` | Retrieve confirmed equipment/slot reservations |
| GET | `/health/live` | Process health |
| GET | `/health/ready` | Database readiness |

Example request body:

```json
{
  "equipmentId": "58300000-0000-4000-8000-000000000001",
  "date": "2026-11-05",
  "slot": "AM",
  "requester": "Asha Sen",
  "purpose": "Department review meeting"
}
```

Successful creation returns 201; replay returns 200 and `Idempotency-Replayed: true`. Input errors return 400, missing equipment/bookings 404, slot or request-key conflicts 409, and an equipment-service failure or timeout 503. Equipment requests time out after 2.5 seconds. The UI proxy uses a separate 5-second timeout.

`X-Request-ID` is propagated when validating equipment. Structured logs include the service, method, path, status, duration and instance; requester names and booking purposes are not logged.

## Tests

Tests use PostgreSQL and a local equipment HTTP stub, without requiring the equipment repository or service. The database name must end in `_test`.

```sh
npm ci
TEST_DATABASE_URL=postgres://postgres:password@127.0.0.1:5432/booking_test npm test
```

Coverage includes persistence, twelve simultaneous competing reservations, concurrent retries with one key, cancellation/rebooking, maintenance, missing equipment, dependency outage/timeouts, invalid dates and availability queries. Test records use a new equipment identifier on each run.

## Scope

This is a trusted local application without authentication. The equipment status check and reservation insert are separate service operations; a maintenance change after validation does not automatically invalidate a reservation. The database prevents reservation conflicts but does not provide a distributed transaction with the equipment service. A single local PostgreSQL instance is a deliberate deployment limit.
