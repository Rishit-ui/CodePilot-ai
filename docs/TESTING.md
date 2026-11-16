# Testing

## Local gates

Run from a clean checkout with Node.js 24:

```text
npm ci
npm run check
npm test
npm audit --omit=dev --audit-level=high
npx playwright install chromium
npm run test:e2e
```

Provider-gated tests must be reported as `BLOCKED` or `NOT TESTED` when their authorized credentials are absent; a skip is not a pass. Never enable external execution to make a test green.

## Container gates

Validate Compose with populated local secrets, build the image, start the stack, and verify both services become healthy. Exercise registration, login, project creation, ownership isolation, and an import. Record a durable identifier, then separately restart the app, restart PostgreSQL, and rebuild the app image. The identifier must remain after every operation. Confirm PostgreSQL has no published host port and the app process is non-root.

`docker compose down -v` destroys persistent data and is excluded from routine validation.
