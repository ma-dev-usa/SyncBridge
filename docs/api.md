# API reference

Base URL: http://127.0.0.1:8080/api/v1. Protected routes require `Authorization: Bearer <key>`.

| Method | Path | Purpose |
|---|---|---|
| GET | /healthz | Liveness (outside API prefix) |
| GET | /readyz | Database readiness (outside API prefix) |
| POST | /events | Validate and enqueue |
| GET | /events | Latest 100 events, state counts, delivery count |
| GET | /events/{id} | Event and attempt history |
| POST | /events/{id}/replay | Requeue a dead-letter event |

| Event | Source | Target | Payload fields |
|---|---|---|---|
| customer.updated | crm | erp | customer_id, name, email |
| order.created | commerce | erp | order_id, customer_id, sku, quantity |
| inventory.updated | erp | commerce | sku, quantity |

IDs are 1–80 characters, starting with a letter or digit; subsequent characters may also include periods, underscores, colons or hyphens. Quantities are integers between 0 and 1 billion; orders require positive quantities. String fields are trimmed and capped at 200 characters. Unmapped fields are ignored.

POST returns 202 for new work, 200 for identical normalized duplicates, 409 for conflicting IDs, 422 for invalid events, 400 for malformed input or disabled fault injection, and 401 for invalid credentials. Delivery is asynchronous.

When ENABLE_SIMULATION=1, optional top-level mode may be normal, transient (first two attempts fail with simulated 503) or permanent (simulated 422). See [fixtures](../fixtures/events.json).

Replay accepts only dead events and preserves prior attempts. Permanent faults remain permanent on replay; a corrected business event requires a new ID.
