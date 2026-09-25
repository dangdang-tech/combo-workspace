# Deployment

This document describes how to deploy the Happier backend (`apps/server`) and the infrastructure it expects.

## COMBO single-instance test deployment

The COMBO fork can run the API and exported web UI in one source-built image, using SQLite and local file storage. This light profile does not require the Postgres, Redis, or S3 services described for the full profile below. Shared workspace presence currently requires a single API instance.

Use the `relay-server-local-source` Docker target. The `relay-server` target downloads upstream release artifacts, which do not contain the COMBO fork changes. Build from a committed source archive so local credentials and test state cannot enter the image:

```sh
COMBO_SHA=$(git rev-parse HEAD)
git archive "$COMBO_SHA" | docker buildx build \
  --target relay-server-local-source \
  --build-arg HAPPIER_BUILD_DB_PROVIDERS=all \
  --build-arg HAPPIER_EMBEDDED_POLICY_ENV=preview \
  --build-arg SENTRY_RELEASE="$COMBO_SHA" \
  --load -t "combo-workspace-test:$COMBO_SHA" -
```

Generate all database client types at build time: the server typecheck resolves the MySQL import even when the deployed runtime uses SQLite. This does not start or require a MySQL service. Empty build-time server URLs use the browser's own origin. Put HTTPS in front of the container and configure all runtime public URLs to that same origin. Do not compile a localhost API URL into the deployed UI.

The deployment templates are:

- [Compose service](../docker/compose.combo-test.yml): one API/UI instance, loopback port, dedicated data/config mounts, readiness check, and bounded resources.
- [Runtime environment example](../docker/combo-test.env.example): copy outside the repository and set the actual HTTPS origin.
- [Nginx configuration](../docker/nginx.combo-test.conf.template): replace `COMBO_TEST_HOST` and `COMBO_API_PORT`; provision the named certificate before loading its HTTPS server block. It forwards Socket.IO polling and WebSocket upgrades as well as ordinary API requests.

Create a dedicated writable data directory for UID/GID 1000. The config directory must contain an `oidc.json` array readable by that user. Keep both outside the checkout. Preserve the data directory across releases: it includes the SQLite database, local assets, and the generated server master secret. Never share it with another environment.

```sh
COMBO_IMAGE="combo-workspace-test:$COMBO_SHA" \
COMBO_ENV_FILE=/etc/combo-workspace-test/runtime.env \
COMBO_DATA_DIR=/var/lib/combo-workspace-test/data \
COMBO_CONFIG_DIR=/etc/combo-workspace-test/providers \
docker compose -f docker/compose.combo-test.yml up -d
```

Real shared-entry acceptance requires a Google OAuth test application with callback `<HTTPS_ORIGIN>/v1/oauth/google/callback`, provider ID `google`, and verified-email enforcement. Use the [Google OIDC configuration](../apps/docs/content/docs/self-hosting/auth-oidc.mdx#google-keyed-accounts-with-e2ee). An empty provider array can support key-based account checks if anonymous signup is explicitly enabled and the Google signup/login requirements are removed; it does not validate Google login or invitation eligibility. Never expose the local signed test issuer as real Google authentication.

Before accepting a deployment, verify `/ready`, `/v1/features`, the application version, a fresh browser login and account restore, host pairing and presence, a real Codex task in a disposable project, persisted history after a service restart, and two-account invitation/revocation/offline behavior. Host-owned file editing, tool approvals, and an enabled terminal require their own live checks. Guest direct machine file/terminal access is not granted by a shared conversation.

On a shared build host, use a dedicated builder with CPU/memory limits and limited parallelism; see [Docker container-driver limits](https://docs.docker.com/build/builders/drivers/docker-container/) and [BuildKit parallelism](https://docs.docker.com/build/buildkit/configure/#max-parallelism). Stop that builder after the build without pruning unrelated Docker resources.

## Upgrade the COMBO context-snapshot version

Treat this as a coordinated source-version upgrade of the server, web UI, and host CLI. The server requires `contextSnapshotVersion: 1` when a daemon completes member preparation. An older daemon can still connect, but cannot complete the updated preparation protocol. A new daemon rejects new allocations without a share-time snapshot instead of reading the current source history. Restoring an already allocated member reuses that child and its key without copying any source history.

The additive `20260917120000_shared_session_context_snapshot` migration adds nullable `SharedSessionEntry.sourceSnapshot` for PostgreSQL, SQLite, and MySQL. Existing entries remain readable with a null snapshot; migration does not backfill them from a newer source conversation. Existing ready members retain access under the current grant rules, and can be revoked and restored to the same child. Create a new entry for new recipients when an old entry has members and no snapshot. Replacing a current invitation token preserves its snapshot. Source deletion keeps the existing cascade behavior: it removes the entry, memberships, and their stored grants, while child sessions remain with the host. Immediate invalidation of every open socket is not asserted here.

Before switching the test environment:

1. Stop its dedicated host daemon so old and new provisioning workers do not overlap.
2. Back up that environment's database and preserve its data/config directories, including the server master secret. Verify the provider-specific migration on a backup or disposable clone; do not point development migration commands at another environment.
3. Deploy the matching source-built server and UI, apply the provider's migration through the existing startup or migration owner, and check readiness and the feature response.
4. Start the matching host CLI against the same origin and confirm its exact-machine presence.
5. Use two real Google accounts in a disposable project. Put a marker in A's conversation, create an invitation, then add a different marker to A. B must see and use the first marker, not the later one; B's new messages must leave A's conversation unchanged. Verify independent child keys, host-only tool approval, revoke/re-enable, and offline draft behavior separately.

The server saves source metadata and stored message ciphertext at invitation creation, so later in-place streaming updates cannot change the saved context. It accepts at most 5,000 main-conversation rows and 2,000,000 serialized bytes. The daemon reuses the canonical replay reader and creator, with a default 120,000-character seed budget including framing (`HAPPIER_REPLAY_MAX_SEED_CHARS`, bounded by the existing replay configuration). Oversized or unreadable context and fork-dependent sources fail closed. Copied history contains user/assistant text, not the complete provider trace. Each child keeps the source project directory; project files remain shared.

These are upgrade and acceptance requirements, not a claim that a particular image has been deployed or passed browser/provider acceptance. Preserve the pre-upgrade backup; rolling back readers after new snapshot writes requires its own validation.

## Upgrade COMBO publication and invitation recovery

The source-build publication update adds `20260923120000_shared_session_publication` for PostgreSQL, SQLite, and MySQL. It adds nullable `SharedSessionEntry.publicMetadata` and `inviteTokenEncrypted`; it does not backfill or rewrite existing invitations, snapshots, members, or conversations. Preserve the server master secret: new invitation-token recovery depends on it.

Use matching CLI, UI, and server sources. The new CLI publication action needs the updated server's `reuseExisting` create input, owner invite read, and invitation preview. An older host can still prepare a child, but only the updated host applies the published invitation title to newly created copies. Older clients can continue using their existing create, rotate, and redeem requests. Existing hash-only invitations remain redeemable; the owner must retain the original link or explicitly replace it to make it recoverable.

Follow the backup, dedicated-host, migration rehearsal, image, and two-account checks above. On a disposable copy of the current database, apply the exact provider migration through the server's normal migration owner, verify integrity and unchanged existing row counts, then check both updated-reader behavior and old-reader startup. Do not use `db push`, rewrite the migration ledger, or restore an old backup as an image rollback. A rollback retains the additive columns and all post-deployment conversation writes.

Acceptance additionally covers: repeat CLI/MCP publication returns the same URL and snapshot; public preview exposes only the intended metadata; a signed-in recipient resumes their own copy after reload; native Codex publication leaves the selected source thread untouched and uses acknowledged imported records rather than a transcript preview. Verify a real recipient reply using inherited context, not only readiness or unit tests.

## Runtime overview
- **App server:** Node.js running `tsx ./sources/main.ts` (Fastify + Socket.IO).
- **Database:** Postgres via Prisma.
- **Cache:** Redis (currently used for connectivity and future expansion).
- **Object storage:** S3-compatible storage for user-uploaded assets (MinIO works).
- **Metrics:** Optional Prometheus `/metrics` server on a separate port.

## Required services
1. **Postgres**
   - Required for all persisted data.
   - Configure via `DATABASE_URL`.

2. **Redis**
   - Required by startup (`redis.ping()` is called).
   - Configure via `REDIS_URL`.

3. **S3-compatible storage**
   - Used for avatars and other uploaded assets.
   - Configure via `S3_HOST`, `S3_PORT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET`, `S3_PUBLIC_URL`, `S3_USE_SSL`.

## Environment variables
**Required**
- `DATABASE_URL`: Postgres connection string.
- `HANDY_MASTER_SECRET`: master key for auth tokens and server-side encryption.
- `REDIS_URL`: Redis connection string.
- `S3_HOST`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET`, `S3_PUBLIC_URL`: object storage config.

**Common**
- `PORT`: API server port (default `3005`).
- `METRICS_ENABLED`: set to `false` to disable metrics server.
- `METRICS_PORT`: metrics server port (default `9090`).
- `S3_PORT`: optional S3 port.
- `S3_USE_SSL`: `true`/`false` (default `true`).

**Optional integrations**
- GitHub (OAuth + optional org allowlist enforcement)
  - OAuth (used for linking a GitHub identity and for GitHub-only signup when enabled):
    - `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`
    - `GITHUB_REDIRECT_URL` (preferred) or legacy `GITHUB_REDIRECT_URI`
      - Set this to your server callback: `https://YOUR_SERVER/v1/oauth/github/callback`
    - Optional: `GITHUB_STORE_ACCESS_TOKEN` (`true` to persist encrypted user tokens; default `false`)
  - Auth policy / enforcement (enterprise / self-hosting restrictions):
    - `AUTH_ANONYMOUS_SIGNUP_ENABLED` (default `true`)
    - `AUTH_SIGNUP_PROVIDERS` (e.g. `github`)
    - `AUTH_REQUIRED_LOGIN_PROVIDERS` (e.g. `github`)
    - `AUTH_GITHUB_ALLOWED_USERS` (CSV list of lowercase GitHub logins)
    - `AUTH_GITHUB_ALLOWED_ORGS` (CSV list of lowercase org slugs)
    - `AUTH_GITHUB_ORG_MATCH` (`any`/`all`, default `any`)
    - `AUTH_OFFBOARDING_ENABLED` (default `true` when allowlists are set)
    - `AUTH_OFFBOARDING_INTERVAL_SECONDS` (default `600`)
    - `AUTH_OFFBOARDING_MODE` (`per-request-cache`)
    - `AUTH_GITHUB_ORG_MEMBERSHIP_SOURCE` (`github_app` recommended when org allowlist is set, or `oauth_user_token`)
  - GitHub App mode for org membership checks (recommended; avoids relying on user OAuth tokens):
    - `AUTH_GITHUB_APP_ID`
    - `AUTH_GITHUB_APP_PRIVATE_KEY` (PEM)
    - `AUTH_GITHUB_APP_INSTALLATION_ID_BY_ORG` (e.g. `acme=123,other=456`)
- Voice (server-minted ElevenLabs conversation tokens via `POST /v1/voice/token`):
  - Required: `ELEVENLABS_API_KEY`, `ELEVENLABS_AGENT_ID_PROD`
  - Required when `HAPPIER_FEATURE_VOICE__REQUIRE_SUBSCRIPTION=true`: `REVENUECAT_SECRET_KEY`
  - Optional controls:
    - `HAPPIER_FEATURE_VOICE__ENABLED` (`true`/`false`, default `true`)
    - `HAPPIER_FEATURE_VOICE__REQUIRE_SUBSCRIPTION` (`true`/`false`, defaults to `true` when `NODE_ENV=production`)
    - `VOICE_FREE_SESSIONS_PER_MONTH` (default `0`)
    - `VOICE_FREE_MINUTES_PER_MONTH` (default `0`, enforced when `HAPPIER_FEATURE_VOICE__REQUIRE_SUBSCRIPTION=true`)
    - `VOICE_MAX_CONCURRENT_SESSIONS` (default `1`)
    - `VOICE_MAX_SESSION_SECONDS` (default `1200`, min `30`)
    - `VOICE_MAX_MINUTES_PER_DAY` (default `0` = unlimited; global per-user guardrail)
    - `VOICE_TOKEN_MAX_PER_MINUTE` (default `10`, `0` disables rate limiting)
    - `VOICE_COMPLETE_MAX_PER_MINUTE` (default `60`, `0` disables rate limiting)
    - `VOICE_LEASE_CLEANUP` (`true`/`false`, default `false`)
    - `VOICE_LEASE_RETENTION_DAYS` (default `30`, clamp 7–365)
    - `VOICE_LEASE_CLEANUP_INTERVAL_MS` (default `21600000` = 6h, min `10000`)
- Debug logging: `DANGEROUSLY_LOG_TO_SERVER_FOR_AI_AUTO_DEBUGGING` (enables file logging + dev log endpoint).

## Docker image
A single multi-target Dockerfile is provided at `Dockerfile`.

Build targets:
- API server: `server`
- Worker: `server-worker`
- Website: `website`
- Webapp: `webapp`
- Docs: `docs`

Key notes:
- The server defaults to port `3005` (set `PORT` explicitly in container environments).
- The image includes FFmpeg and Python for media processing.
- The server entrypoint (`apps/server/scripts/run-server.sh`) runs `prisma migrate deploy` on startup by default (set `RUN_MIGRATIONS=0` to disable). On Postgres, it retries on advisory-lock contention.
- Health-managed and multi-replica deployments should run `run-server --migrate-only` as a single pre-deploy operation, then start API and worker replicas with `RUN_MIGRATIONS=0`. The migration command exits before server startup and explicitly overrides `RUN_MIGRATIONS=0`.
- PostgreSQL advisory locks serialize concurrent migrators but cannot preserve a migration when the owning container is terminated. The pre-deploy operation's lifetime and timeout must be independent from application startup health checks.
- If the platform cannot block application rollout on a pre-deploy operation, use exactly one API migration owner (`RUN_MIGRATIONS=1`), disable migrations on all workers and other replicas, and configure start-first rollout, rollback on failure, and a health startup grace long enough for the largest expected migration. Separate auto-deploy webhooks are not an ordering mechanism.

## Kubernetes manifests
Example manifests live in `apps/server/deploy`:
- `handy.yaml`: Deployment + Service + ExternalSecrets for the server.
- `happy-redis.yaml`: Redis StatefulSet + Service + ConfigMap.

The deployment config expects:
- Prometheus scraping annotations on port `9090`.
- A secret named `handy-secrets` populated by ExternalSecrets.
- A service mapping port `3000` to container port `3005`.

## Local dev helpers
The server package includes scripts for local infrastructure:
- `yarn workspace @happier-dev/server db` (Postgres in Docker)
- `yarn workspace @happier-dev/server redis`
- `yarn workspace @happier-dev/server s3` + `s3:init`

Use `.env`/`.env.dev` to load local settings when running `yarn workspace @happier-dev/server dev`.

## Implementation references
- Entrypoint: `apps/server/sources/main.ts`
- Dockerfile: `Dockerfile`
- Kubernetes manifests: `apps/server/deploy`
- Env usage: `apps/server/sources` (`rg -n "process.env"`)
