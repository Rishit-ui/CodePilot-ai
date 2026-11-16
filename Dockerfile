# CodePilot AI production image
FROM node:24-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:24-bookworm-slim AS runner
ENV NODE_ENV=production \
    CODEPILOT_HOST=0.0.0.0 \
    CODEPILOT_PORT=3000 \
    CODEPILOT_DATA_DIR=/app/.data
WORKDIR /app
RUN groupadd --system codepilot && useradd --system --gid codepilot --home-dir /app codepilot
COPY --from=dependencies --chown=codepilot:codepilot /app/node_modules ./node_modules
COPY --chown=codepilot:codepilot package.json package-lock.json ./
COPY --chown=codepilot:codepilot src ./src
COPY --chown=codepilot:codepilot public ./public
RUN mkdir -p /app/.data && chown codepilot:codepilot /app/.data
USER codepilot
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
STOPSIGNAL SIGTERM
CMD ["node", "src/server.js"]
