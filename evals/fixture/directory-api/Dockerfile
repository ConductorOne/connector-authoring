# Tier-1 eval fixture: Directory API.
# Node >= 22.18 runs the TypeScript source directly (type stripping); no build
# step and no runtime dependencies.
FROM node:22-alpine

WORKDIR /fixture
COPY src/ ./src/
COPY openapi.json ./openapi.json
COPY package.json ./package.json

ENV PORT=8080 HOST=0.0.0.0
EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=3s --retries=5 \
  CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1

CMD ["node", "src/server.ts"]
