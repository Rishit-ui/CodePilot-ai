# CodePilot AI — Production Multi-Stage Container
FROM node:24-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

# Create non-root execution user
RUN addgroup -S codepilot && adduser -S codepilot -G codepilot

COPY package.json ./
COPY src/ ./src/
COPY public/ ./public/

RUN mkdir -p /app/.data && chown -R codepilot:codepilot /app

USER codepilot

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "src/server.js"]
