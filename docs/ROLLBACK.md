# Rollback

## Application rollback

1. Stop promotion and record the failing commit and evidence.
2. Redeploy the last verified immutable image or Git commit without changing database credentials or volumes.
3. Verify health, readiness, login, ownership, and the previously recorded persistence identifier.
4. Keep execution disabled throughout rollback.

## Database safety

Schema migrations are additive and tracked in `schema_migrations`. Before a production release, create and verify a provider snapshot plus an encrypted logical backup. Do not delete or recreate the database volume during application rollback. If a schema rollback is ever required, restore into a separate database first and validate it before switching traffic.

## Docker recovery

`docker compose down` preserves named volumes. Recreate the prior application image with the same `.env.docker` and run `docker compose up -d`. Never use `down -v` as a rollback command.
