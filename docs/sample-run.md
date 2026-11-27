# Sample integration run

Four synthetic events exercise the normal, retry and dead-letter paths. The transient order recovers on its third attempt.

| Event | Route | Final state | Attempts |
|---|---|---|---:|
| evt-1001 | CRM to ERP | delivered | 1 |
| evt-1002 | Commerce to ERP | delivered | 3 |
| evt-1003 | ERP to Commerce | delivered | 1 |
| evt-1004 | Commerce to ERP | dead | 1 |

| Elapsed ms | Event | Attempt | Outcome |
|---:|---|---:|---|
| 0 | evt-1001 | 1 | delivered |
| 0 | evt-1002 | 1 | retry |
| 0 | evt-1003 | 1 | delivered |
| 0 | evt-1004 | 1 | dead |
| 1000 | evt-1002 | 2 | retry |
| 3000 | evt-1002 | 3 | delivered |

The [fixture](../fixtures/events.json) and [browser simulation](../demo.html) reproduce this scenario. These are simulated integration results.

## Local verification

The backend was exercised on Node.js 22.16.0 with SQLite using the same source blobs as the repository. A 10,000-event synthetic run with repeated submissions produced 10,000 distinct delivery receipts. Retry scheduling, conflicting IDs, restart recovery and dead-letter replay passed. The HTTP integration test also passed, covering authentication, ingestion, duplicate handling and replay.

The project targets Node.js 24; the GitHub Actions workflow is configured to validate that runtime and build the container.
