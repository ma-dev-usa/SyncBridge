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
