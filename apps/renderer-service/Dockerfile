# framefields renderer worker (apps/renderer-service/PLAN.md §12).
#
# The image contains the worker only, with no framefields engine. Each job
# renders with the framefields version its own repo installs (package.json +
# lockfile), so the runtime stage carries the system libraries that
# framefields' native modules (WebGPU/Dawn, skia, sharp, webcodecs) need.
#
# Build from the repo root:
#   docker build -f apps/renderer-service/Dockerfile -t framefields-renderer .
#   docker build -f apps/renderer-service/Dockerfile --build-arg VARIANT=full -t framefields-renderer:full .
#
# VARIANT=full adds a C/C++ toolchain for projects whose native dependencies
# have no prebuilt binaries for linux-x64.

# Debian 13 (trixie): prebuilt WebGPU/Dawn binaries in npm need glibc >= 2.38.
ARG NODE_IMAGE=node:24-trixie-slim

# ─── Stage 1: prune the monorepo to the service ──────────────────────────────
FROM ${NODE_IMAGE} AS pruner
WORKDIR /repo
RUN npm install -g turbo@2
COPY turbo.json package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/ packages/
COPY apps/ apps/
COPY nodes/ nodes/
RUN turbo prune @framefields/renderer-service --docker

# ─── Stage 2: build the service and a standalone copy of it ──────────────────
FROM ${NODE_IMAGE} AS builder
WORKDIR /repo
RUN apt-get update && apt-get install -y --no-install-recommends openssh-client \
    && rm -rf /var/lib/apt/lists/* && corepack enable
COPY --from=pruner /repo/out/json/ .
COPY --from=pruner /repo/out/pnpm-lock.yaml ./pnpm-lock.yaml
# Scripts off: nothing here is built natively; workspace packages pulled in as
# test-only devDependencies (framefields) are installed but never built.
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY --from=pruner /repo/out/full/ .
RUN pnpm --filter @framefields/renderer-service build \
    && pnpm --filter @framefields/renderer-service deploy --prod --legacy /out \
    # Pinned SSH host keys for github.com / gitlab.com / bitbucket.org (§6.5).
    && /out/deploy/known-hosts.sh

# ─── Stage 3: runtime ────────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS runner
ARG VARIANT=slim

# Rendering (Vulkan/GL/fonts/media libs for framefields' native modules),
# ffmpeg/ffprobe (output checks), git + LFS + ssh (checkouts), tini (PID 1:
# forwards signals, reaps git/install subprocesses), python3 + runpod (shim).
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates openssl \
    libnss3 libatk1.0-0t64 libatk-bridge2.0-0t64 libcups2t64 libdrm2 \
    libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 libxi6 \
    libgbm1 libpango-1.0-0 libcairo2 libasound2t64 \
    libgl1-mesa-dri libglapi-mesa libegl1 libvulkan1 mesa-vulkan-drivers libfontconfig1 \
    ffmpeg xvfb xauth \
    git git-lfs openssh-client tini \
    python3 python3-pip \
    && if [ "$VARIANT" = "full" ]; then \
         apt-get install -y --no-install-recommends build-essential python3-dev pkg-config; \
       fi \
    && mkdir -p /tmp/.X11-unix && chmod 1777 /tmp/.X11-unix \
    && rm -rf /var/lib/apt/lists/* \
    && git lfs version

RUN pip3 install --no-cache-dir "runpod>=1.7,<2" --break-system-packages

ENV NODE_ENV=production \
    NVIDIA_VISIBLE_DEVICES=all \
    NVIDIA_DRIVER_CAPABILITIES=graphics,utility,video,compute \
    FF_WORK_DIR=/tmp/framefields \
    RENDERER_PORT=8082 \
    COREPACK_HOME=/var/cache/framefields/corepack

RUN groupadd --system --gid 1001 framefields && \
    useradd --system --uid 1001 -m -g framefields framefields && \
    mkdir -p /var/cache/framefields /tmp/framefields && \
    chown -R framefields:framefields /var/cache/framefields /tmp/framefields && \
    corepack enable

WORKDIR /app
COPY --from=builder --chown=framefields:framefields /out .

USER framefields
EXPOSE 8082

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.RENDERER_PORT||8082)+'/health').then(r=>process.exit(r.status===200?0:1),()=>process.exit(1))"

# -s: RunPod starts the container through its own init, so tini isn't PID 1;
# registering as a subreaper keeps zombie reaping working there.
ENTRYPOINT ["/usr/bin/tini", "-s", "-g", "--", "/app/docker/entrypoint.sh"]
