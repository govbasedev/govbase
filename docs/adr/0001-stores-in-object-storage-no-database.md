---
status: accepted
date: 2026-10-14
---

# Steps hand work through stores in object storage, with no database

The pipeline's steps need a durable place to hand work to each other and to continue after a crash. A redesign concept proposed a Postgres ledger, queues and leases. We decided instead that each step owns one store in an S3-compatible bucket, behind the pipeline's own `ObjectBucket` shape: a folder per step, with `state/` holding the latest outcome per thing and `events/` holding an append-only history. A step writes only inside its own store and reads the store of the step before it, so no object ever has two writers and no locks, leases or transactions are needed. Item versions and judgments are append-only because judgments refer to them. The reasons: the owner does not want to run a database, an S3 bucket moves between providers as a config change, and the one-writer rule gives the safety a transaction would have given without the infrastructure. The cost is that cross-run questions are answered by a tool that reads the store, not by a query, and that a shape change must be additive or go to a new folder.

## Considered options

- Postgres as a job ledger with leases: rejected, a database to operate and a vendor to pay, for a guarantee the one-writer rule gives for free.
- A queue service: rejected for the same reason; the store is the queue, and the OCR step takes its share of pending scans by document id.
- SQLite files in the bucket, one per step: rejected, a half-written upload on a crash and still a database.
