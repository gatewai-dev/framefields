# framefields renderer worker (apps/renderer-service/PLAN.md §12).
#
# Build from the repo root:
#   docker build -f apps/renderer-service/Dockerfile -t framefields-renderer .
#   docker build -f apps/renderer-service/Dockerfile --build-arg VARIANT=full -t framefields-renderer:full .
#
# VARIANT=full adds a C/C++ toolchain for projects whose native dependencies
# have no prebuilt binaries.

ARG NODE_IMAGE=node:24-bookworm-slim

# ─── Stage 0: base ────────────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS base
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

# ─── Stage 1: prune the monorepo to the service and its node packages ────────
FROM base AS pruner
RUN npm install -g turbo@2
COPY turbo.json package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/ packages/
COPY apps/ apps/
COPY nodes/ nodes/
RUN NODE_PACKAGES=$(node -e "const fs=require('fs');console.log(fs.readdirSync('nodes').filter(d=>fs.statSync('nodes/'+d).isDirectory()).map(d=>{try{return require('./nodes/'+d+'/package.json').name}catch{return null}}).filter(Boolean).join(' '))") && \
    turbo prune @framefields/renderer-service $NODE_PACKAGES --docker

# ─── Stage 2: build ──────────────────────────────────────────────────────────
FROM base AS builder
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential git ca-certificates pkg-config python3 \
    libxi-dev libglu1-mesa-dev libglew-dev libgl1-mesa-dev \
    libvulkan-dev libfontconfig1-dev \
    && ln -s /usr/bin/python3 /usr/bin/python \
    && rm -rf /var/lib/apt/lists/*

COPY --from=pruner /app/out/json/ .
COPY --from=pruner /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
RUN corepack enable && \
    pnpm config set package-import-method copy && \
    pnpm install --frozen-lockfile

COPY --from=pruner /app/out/full/ .
ENV NODE_OPTIONS="--max-old-space-size=6144"
# Everything pruned in: node packages are discovered at runtime, not imported.
RUN pnpm exec turbo run build

RUN pnpm install --prod --frozen-lockfile
# Linux native bindings for webcodecs, then rebuild native modules for this arch.
RUN pnpm --filter=@framefields/renderer add @napi-rs/webcodecs-linux-x64-gnu @napi-rs/webcodecs-linux-arm64-gnu
RUN pnpm rebuild -r sharp skia-canvas webgpu gl @napi-rs/webcodecs mediabunny
RUN find /app/node_modules -name "prebuild.mjs" -path "*/skia-canvas/*" -exec sh -c 'cd "$(dirname {})/.." && node lib/prebuild.mjs download --or-compile' \;
RUN find /app/node_modules -name "skia.node" | grep -q skia.node || (echo "ERROR: skia.node missing!" && exit 1)

# Pinned SSH host keys for github.com / gitlab.com / bitbucket.org (§6.5).
RUN apt-get update && apt-get install -y --no-install-recommends openssh-client \
    && apps/renderer-service/deploy/known-hosts.sh

RUN find /app -type d \( -name ".turbo" -o -name ".cache" \) -exec rm -rf {} + 2>/dev/null || true && \
    find /app -name "*.tsbuildinfo" -delete 2>/dev/null || true && \
    rm -rf /root/.local /root/.cache /root/.npm /tmp/*

# ─── Stage 3: runtime ────────────────────────────────────────────────────────
FROM base AS runner
ARG VARIANT=slim

# Rendering (GL/Vulkan/fonts), ffmpeg/ffprobe (output checks), git + LFS +
# ssh (checkouts), tini (PID 1: forwards signals, reaps git subprocesses),
# python3 + runpod (serverless shim).
RUN apt-get update && apt-get install -y --no-install-recommends \
    libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
    libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 \
    libgbm1 libpango-1.0-0 libcairo2 libasound2 \
    libgl1-mesa-dri libglapi-mesa libegl1 libvulkan1 libfontconfig1 \
    ffmpeg xvfb xauth \
    git git-lfs openssh-client ca-certificates tini \
    python3 python3-pip \
    && if [ "$VARIANT" = "full" ]; then \
         apt-get install -y --no-install-recommends build-essential python3-dev pkg-config; \
       fi \
    && mkdir -p /tmp/.X11-unix && chmod 1777 /tmp/.X11-unix \
    && rm -rf /var/lib/apt/lists/* \
    && git lfs version

RUN pip3 install --no-cache-dir "runpod>=1.7,<2" --break-system-packages

ENV NVIDIA_VISIBLE_DEVICES=all \
    NVIDIA_DRIVER_CAPABILITIES=graphics,utility,video,compute \
    FF_WORK_DIR=/tmp/framefields \
    RENDERER_PORT=8082

RUN groupadd --system --gid 1001 framefields && \
    useradd --system --uid 1001 -m -g framefields framefields && \
    mkdir -p /var/cache/framefields /tmp/framefields && \
    chown -R framefields:framefields /var/cache/framefields /tmp/framefields

ENV COREPACK_HOME=/var/cache/framefields/corepack
WORKDIR /app
COPY --from=builder --chown=framefields:framefields /app .
RUN corepack enable

USER framefields
EXPOSE 8082

HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.RENDERER_PORT||8082)+'/health').then(r=>process.exit(r.status===200?0:1),()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "-g", "--", "apps/renderer-service/docker/entrypoint.sh"]
