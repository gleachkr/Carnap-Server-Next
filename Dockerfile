# Carnap as a container: the same `bun src/server/main.ts` that `bun run serve`
# starts, with the client bundles built in.
#
# Two stages, because the build needs the whole dependency tree and the running
# server needs about half of it. The result is one process, one SQLite file, and
# no network dependency at boot beyond the database URL.
#
# Nothing here is Docker-specific — `podman build -t carnap .` and
# `docker build -t carnap .` produce the same image. The base image is named
# with its registry because podman refuses to guess one, and docker does not
# mind being told.
#
# Debian rather than the alpine tag, which is 70 MB smaller and segfaults on
# every SIGTERM: the server runs its whole shutdown correctly and then bun's own
# teardown crashes, so `docker stop` reports exit 139 and takes five seconds
# instead of one. Measured on bun 1.3.14/musl with the libsql native module
# loaded; the glibc build of the same commit exits 0.

FROM docker.io/oven/bun:1.3-slim AS build

WORKDIR /app

# Dependencies first, and from the lockfile only, so editing a source file does
# not re-resolve the tree. `--frozen-lockfile` makes a lockfile that disagrees
# with `package.json` a build failure rather than a silent upgrade.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Everything `build:client` reads: the client and worker sources it bundles, the
# font-copying script (the only one of `scripts/` the build runs), and the
# tsconfigs that decide how JSX compiles.
COPY tsconfig.json tsconfig.client.json ./
COPY scripts/copy-fonts.ts ./scripts/
COPY src ./src

# Writes `public/`: the editor and viewer bundles, the exercise components, the
# proof compiler's WASM, and the fonts. On Cloudflare this is what Workers
# Assets serves; here it is what `serveStatic` serves.
RUN bun run build:client

FROM docker.io/oven/bun:1.3-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production

# A second install rather than a copy of the first: the runtime needs neither
# the TypeScript compiler nor Biome nor Wrangler nor Miniflare, and leaving them
# out is most of the difference in image size. `bun` runs the TypeScript
# directly, so no build output of our own is involved — `src/` *is* the program.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY --from=build /app/public ./public

# `src/` carries the migrations as well as the program: the server reads
# `src/worker/infrastructure/database/migrations` at boot and applies the pending
# ones. That path is relative, so the working directory has to stay `/app`.
COPY src ./src

# `tsconfig.json` is not a build artifact here — bun reads it at *run* time to
# learn that JSX compiles to `hono/jsx` rather than to React. Without it every
# `.tsx` page fails to import `react/jsx-runtime` on the first request.
COPY tsconfig.json ./

# `COPY` preserves the build host's mode bits and assigns the files to root, so
# a maintainer whose umask is tighter than 022 ships a tree that `USER bun`
# cannot read: at 027 the copied directories arrive `750` and the files `640`,
# which leaves uid 1000 in `other` with nothing. Every `RUN` above is root and
# unaffected, so the build succeeds and the *container* fails, with an `EACCES`
# on `src/server/main.ts` that reads like a corrupt image rather than a umask.
#
# `a+rX` and not `a+rx`: the capital adds execute to directories, which is what
# makes them traversable, while leaving ordinary source files unexecutable.
# `COPY --chown=bun:bun` would fix the same thing by the other route, and is the
# one a rootless builder with no subuid ranges cannot take — the same constraint
# the `/data` line below explains.
RUN chmod -R a+rX package.json bun.lock src tsconfig.json

# The database lives outside the image, on a volume, or every `podman run`
# starts a fresh course catalog. `file:` needs the directory to exist and to be
# writable by the user the process runs as.
#
# `chown` is the right way to say "the server owns this", and it is also the one
# thing a rootless builder with no subuid ranges cannot do — it can name no uid
# but its own. So the fallback is a mode instead of an owner: weaker, but with
# the property that actually matters here, since a fresh named volume inherits
# this directory's ownership and mode and this line is therefore what decides
# whether the server can open its own database.
ENV CARNAP_DATABASE_URL=file:/data/carnap.db
RUN mkdir -p /data \
  && { chown bun:bun /data 2>/dev/null || chmod 0777 /data; }
VOLUME /data

# The `bun` user comes with the base image. Root would work and is the thing to
# avoid: nothing here needs it, and under a rootful Docker daemon a container
# running as root writes root-owned files into whatever the operator bind-mounts
# at /data — their own database, no longer theirs to read.
USER bun

ENV PORT=8787
EXPOSE 8787

# Liveness, not readiness: `/health` answers without touching storage, so this
# reports that the process is up and serving, which is what an orchestrator
# restarts on. Podman keeps it only when built with `--format docker`; the OCI
# image format has nowhere to put it and drops it with a warning.
#
# Asked with bun rather than with curl, which this base image does not carry —
# the alternative is apt-get for one HTTP request.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD ["bun", "-e", "process.exit((await fetch('http://127.0.0.1:' + (process.env.PORT ?? 8787) + '/health')).ok ? 0 : 1)"]

CMD ["bun", "src/server/main.ts"]
