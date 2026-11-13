# Phase 2 Infrastructure Report

Date: 2026-11-13

Deployment/push: not performed.

## Container evidence — `PASS`

`docker build --tag codepilot-ai:phase2-final .` completed successfully from the final source. The two-stage image installed locked runtime dependencies with `npm ci --omit=dev`; npm reported 22 packages and 0 vulnerabilities. `.dockerignore` excludes Git metadata, `.env*`, local data, tests, logs, and docs.

A temporary container ran as user `codepilot`, connected to the live PostgreSQL 17 test instance, and reached Docker health `healthy`. `/api/health` returned HTTP 200 with database `postgres`, auth `enabled`, and execution `disabled`. `/api/ready` returned database and rate-limit store `available`, with the worker `disabled`.

## Serverless assessment

The Vercel entry points and rewrite paths remain covered by automated tests, including authentication enforcement. Durable state and distributed limiting use PostgreSQL, not `/tmp`.

As checked against Vercel documentation on 2026-11-13, Function payloads are limited to 4.5 MB and execution duration is plan/configuration dependent. The application caps direct Vercel uploads at 4.5 MB and configures 30 seconds. Long analyses and execution must not rely on an invocation continuing after its response. Sources: https://vercel.com/docs/functions/limitations and https://vercel.com/docs/queues.

The database-backed `execution_jobs` table supplies durable application status, ownership, cancellation, and bounded retries. Vercel Queues is a suitable future delivery transport but was not provisioned or tested; therefore managed queue connectivity is `NOT TESTED`, and external execution remains `BLOCKED`.

## Monitoring

- `/api/health`: process/capability liveness.
- `/api/ready`: sanitized PostgreSQL, rate-limit backend, and worker-mode status; database probe failure returns 503.
- `operational_events`: API, readiness/database, import, analysis/operation, worker, and deployment-verification failures.
- Audit history: failed authentication, rate limiting, queued execution, and project actions.

Queue delay and job-timeout telemetry require a real worker and remain `NOT TESTED`.
