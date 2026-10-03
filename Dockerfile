# Stage 0: Base setup
FROM node:24-bookworm-slim AS base
WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
ENV GRPC_POLL_STRATEGY=epoll1

# Stage 1: Pruner
FROM base AS pruner
RUN npm install -g turbo
COPY turbo.json package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/ packages/
COPY apps/ apps/
COPY nodes/ nodes/
RUN NODE_PACKAGES=$(node -e "const fs = require('fs'); const dirs = fs.readdirSync('nodes'); const names = dirs.filter(d => fs.statSync('nodes/'+d).isDirectory()).map(d => { try { return require('./nodes/'+d+'/package.json').name; } catch(e) { return null; } }).filter(Boolean); console.log(names.join(' '));") && \
    turbo prune @gatewai.studio/backend @gatewai.studio/fe $NODE_PACKAGES --docker

# Stage 2: Builder
FROM base AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential git ca-certificates pkg-config \
    && rm -rf /var/lib/apt/lists/*

COPY --from=pruner /app/out/json/ .
COPY --from=pruner /app/out/pnpm-lock.yaml ./pnpm-lock.yaml

RUN corepack enable && pnpm install --frozen-lockfile

COPY --from=pruner /app/out/full/ .
# 1. Generate Prisma Client (Generates into packages/db/generated/client)
RUN pnpm --filter=@gatewai.studio/db db:generate

ENV NODE_OPTIONS="--max-old-space-size=6144"


# 3. Build the apps (Frontend, Backend, and Nodes)
# Backend must build first — rpc-client imports AppType from @gatewai.studio/backend (devDep),
# and pnpm in production mode skips devDeps in its topological sort.
RUN pnpm run build

# 4. Prune development dependencies (removes devDeps but keeps workspace links)
# We use copy method to ensure dependencies are physically in node_modules for the runner stage
RUN pnpm config set package-import-method copy && \
    pnpm install --prod --frozen-lockfile

# 5. Native module rebuilds (only what's needed for runtime)
RUN pnpm rebuild sharp

# Clean up build caches and temporary files to minimize image layer size
RUN find /app -type d \( -name ".turbo" -o -name ".cache" \) -exec rm -rf {} + 2>/dev/null || true && \
    find /app -name "*.tsbuildinfo" -delete 2>/dev/null || true && \
    rm -rf /root/.local /root/.cache /root/.npm /tmp/*

# Stage 3: Runner
FROM base AS runner

# Install runtime dependencies for WebGPU (Google Dawn), Canvas (Skia-Canvas), and Sharp
RUN apt-get update && apt-get install -y --no-install-recommends \
    libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 \
    libgbm1 libfontconfig1 ffmpeg \
    libgl1-mesa-dri libglapi-mesa libegl1 libvulkan1 \
    && rm -rf /var/lib/apt/lists/*

# Point to the Vite-built frontend in the workspace structure
ENV FRONTEND_PATH="./apps/gatewai-fe/dist"

RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 -m -g nodejs gatewai

ENV COREPACK_HOME=/home/gatewai/.cache/corepack

WORKDIR /app
# Copy the entire built workspace (it’s already pruned by turbo and pnpm)
COPY --from=builder --chown=gatewai:nodejs /app .

RUN corepack enable && \
    mkdir -p /home/gatewai/.cache/corepack && \
    chown -R gatewai:nodejs /home/gatewai

USER gatewai
EXPOSE 8081

# Use node directly
CMD ["node", "apps/gatewai-backend/dist/src/index.js"]