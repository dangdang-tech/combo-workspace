# Encryption and Data Encoding

This document details how client data is encrypted, how encrypted blobs are structured, and how those blobs map onto protocol fields. It is based on `apps/cli/src/api/encryption.ts` and the server routes that accept/emit these values.

For transport and event shapes, see `protocol.md`. For HTTP endpoints, see `api.md`.

## Overview

```mermaid
graph TB
    subgraph "Client (CLI/Mobile)"
        Plain[Plaintext Data]
        ClientEnc[Client Encryption]
        B64[Base64 Encoded]
    end

    subgraph "Transport"
        Wire[HTTP / WebSocket]
    end

    subgraph "Server"
        Store[(Postgres)]
        ServerEnc[Server Encryption]
        Tokens[Service Tokens]
    end

    Plain --> ClientEnc --> B64 --> Wire --> Store
    Tokens --> ServerEnc --> Store

    style Plain fill:#e8f5e9
    style B64 fill:#fff3e0
    style Store fill:#e3f2fd
```

## Design goals
- Keep the server blind to user content (end-to-end encryption on clients).
- Use explicit, stable binary layouts so clients can interoperate across versions.
- Prefer simple, consistent base64 encoding on the wire.

## Encryption variants

```mermaid
graph LR
    subgraph "Variant Selection"
        Check{Has dataKey?}
        Check --> |No| Legacy[Legacy NaCl]
        Check --> |Yes| DataKey[DataKey AES-GCM]
    end

    subgraph "Legacy"
        L1[XSalsa20-Poly1305]
        L2[32-byte shared secret]
    end

    subgraph "DataKey"
        D1[AES-256-GCM]
        D2[Per-session/machine key]
    end

    Legacy --> L1 & L2
    DataKey --> D1 & D2
```

Clients currently use one of two encryption variants:

### 1) legacy (NaCl secretbox)
Used when the client only has a shared secret key.

**Algorithm**: `tweetnacl.secretbox` (XSalsa20-Poly1305)
- **Nonce length**: 24 bytes
- **Key length**: 32 bytes

**Binary layout** (plaintext JSON -> bytes):
```
[ nonce (24) | ciphertext+auth (secretbox output) ]
```

```mermaid
packet-beta
  0-23: "nonce (24 bytes)"
  24-55: "ciphertext + auth tag"
```

### 2) dataKey (AES-256-GCM)
Used when the client supports per-session/per-machine data keys.

**Algorithm**: AES-256-GCM
- **Nonce length**: 12 bytes
- **Auth tag**: 16 bytes
- **Key length**: 32 bytes

**Binary layout**:
```
[ version (1) | nonce (12) | ciphertext (...) | authTag (16) ]
```

```mermaid
packet-beta
  0-0: "ver"
  1-12: "nonce (12 bytes)"
  13-44: "ciphertext (...)"
  45-60: "authTag (16 bytes)"
```

- `version` is currently `0`.

## Data encryption key (dataKey variant)

```mermaid
flowchart LR
    subgraph "Key Wrapping"
        DEK[Data Encryption Key]
        Eph[Ephemeral Keypair]
        Box[tweetnacl.box]
        Bundle[Key Bundle]
    end

    DEK --> Box
    Eph --> Box
    Box --> Bundle

    subgraph "Content Encryption"
        Plain[Plaintext]
        AES[AES-256-GCM]
        Cipher[Ciphertext]
    end

    DEK --> AES
    Plain --> AES --> Cipher
```

When `dataKey` is used, the actual content key is encrypted for storage/transport.

**Algorithm**: `tweetnacl.box` with an ephemeral keypair.
- **Ephemeral public key**: 32 bytes
- **Nonce**: 24 bytes

**Binary layout**:
```
[ ephPublicKey (32) | nonce (24) | ciphertext (...) ]
```

```mermaid
packet-beta
  0-31: "ephPublicKey (32 bytes)"
  32-55: "nonce (24 bytes)"
  56-87: "ciphertext (...)"
```

This blob is then wrapped with a version byte before being sent/stored:
```
[ version (1 = 0) | boxBundle (...) ]
```

The resulting bytes are base64-encoded and placed in fields such as `dataEncryptionKey` for sessions/machines/artifacts.

## Where encryption is applied

```mermaid
graph TB
    subgraph "Client-Encrypted Fields"
        direction TB
        S1[Session metadata]
        S2[Session agent state]
        S3[Session messages]
        M1[Machine metadata]
        M2[Daemon state]
        A1[Artifact header]
        A2[Artifact body]
        K1[KV store values]
        AK[Access keys]
    end

    subgraph "Server Storage"
        DB[(Postgres)]
    end

    S1 & S2 & S3 --> |opaque strings| DB
    M1 & M2 --> |opaque strings| DB
    A1 & A2 --> |opaque bytes| DB
    K1 --> |opaque bytes| DB
    AK --> |opaque string| DB

    style S1 fill:#e1f5fe
    style S2 fill:#e1f5fe
    style S3 fill:#e1f5fe
    style M1 fill:#e1f5fe
    style M2 fill:#e1f5fe
    style A1 fill:#e1f5fe
    style A2 fill:#e1f5fe
    style K1 fill:#e1f5fe
    style AK fill:#e1f5fe
```

The server treats these fields as opaque strings/blobs. The client encrypts them before sending.

### Session metadata + agent state
- **Encrypted by client** and stored as strings in the DB.
- Used in:
  - `POST /v1/sessions` (create/load)
  - WebSocket `update-metadata` / `update-state`
  - `update-session` events

### Session messages

```mermaid
sequenceDiagram
    participant Client
    participant Server
    participant DB as Postgres

    Client->>Client: Encrypt message
    Client->>Server: emit "message" { sid, message: "<base64>" }
    Server->>DB: Store { t: "encrypted", c: "<base64>" }

    Note over Server: Later, sync to other clients

    Server->>Client: update "new-message"<br/>content: { t: "encrypted", c: "<base64>" }
    Client->>Client: Decrypt message
```

- Client emits `message` with a base64 encrypted blob.
- Server stores it as `SessionMessage.content`:
  - `{ t: "encrypted", c: "<base64>" }`
- Server emits it back in `new-message` updates with the same structure.

### Machine metadata + daemon state
- **Encrypted by client** and stored as strings in the DB.
- Used in:
  - `POST /v1/machines`
  - WebSocket `machine-update-metadata` / `machine-update-state`
  - `update-machine` events

### Artifacts
- `header` and `body` are encrypted bytes encoded as base64 on the wire.
- Stored as `Bytes` in the DB.
- Emitted in `new-artifact` / `update-artifact` events as base64 strings.

### Access keys
- `AccessKey.data` is treated as an **opaque encrypted string**.
- The server does not decode it or inspect its contents.

### Key-value store
- `UserKVStore.value` is encrypted bytes encoded as base64 on the wire.
- `kvMutate` expects base64 strings; `kvGet/list/bulk` return base64 strings.

Session drafts reserve a typed `UserKVStore` key prefix instead of exposing their rows through the
generic KV API. The draft routes carry an explicit content envelope and enforce its owner:

- a new-Session draft follows the Account encryption mode and uses Account-scoped key material;
- an existing-Session draft follows that Session's fixed encryption mode and, in E2EE mode, uses
  the Session data-encryption key;
- raw attachment bytes, local file handles and URIs, credentials, secret values, and local
  presentation state are not part of synchronized draft content.

This keeps one draft document and synchronization contract without weakening the different key
ownership of Account-scoped and Session-scoped data.

Snapshot hydration distinguishes a temporarily unavailable existing-Session key/context from an
invalid envelope or payload. It may skip only the unavailable Session record while continuing to
materialize other Account drafts; malformed or mode-incompatible content fails the snapshot so it
cannot be silently classified as a local key-loading condition.

## On-wire formats (encrypted fields)

```mermaid
graph LR
    subgraph "Wire Format"
        JSON[JSON payload]
        B64["base64 strings<br/>(encrypted bytes)"]
        Plain["plain values<br/>(ids, versions, timestamps)"]
    end

    JSON --> B64
    JSON --> Plain
```

Below are the typical JSON shapes that carry encrypted data. All `...` values are base64 strings representing encrypted bytes.

### Session creation
```http
POST /v1/sessions
```
```json
{
  "tag": "<string>",
  "metadata": "<base64 encrypted>",
  "agentState": "<base64 encrypted or null>",
  "dataEncryptionKey": "<base64 data key bundle or null>"
}
```

### Encrypted message (client -> server)
```
Socket emit: "message"
```
```json
{
  "sid": "<session id>",
  "message": "<base64 encrypted>"
}
```

### Encrypted message (server -> client)
```
update.body.t = "new-message"
```
```json
{
  "t": "encrypted",
  "c": "<base64 encrypted>"
}
```

### Session metadata update (WebSocket)
```
Socket emit: "update-metadata"
```
```json
{
  "sid": "<session id>",
  "metadata": "<base64 encrypted>",
  "expectedVersion": 3
}
```

### Machine update (WebSocket)
```
Socket emit: "machine-update-state"
```
```json
{
  "machineId": "<machine id>",
  "daemonState": "<base64 encrypted>",
  "expectedVersion": 2
}
```

### Artifact create/update (HTTP)
```http
POST /v1/artifacts
```
```json
{
  "id": "<uuid>",
  "header": "<base64 encrypted>",
  "body": "<base64 encrypted>",
  "dataEncryptionKey": "<base64 data key bundle>"
}
```

### KV mutate (HTTP)
```http
POST /v1/kv
```
```json
{
  "mutations": [
    { "key": "prefs.theme", "value": "<base64 encrypted>", "version": 2 },
    { "key": "prefs.legacy", "value": null, "version": 5 }
  ]
}
```

## Client-side types (shapes used before encryption)
These are the client-side structures that get encrypted and sent over the wire. They are defined in `apps/cli/src/api/types.ts`.

### Session message content (encrypted)
The payload stored in `SessionMessage.content` is always encrypted and wrapped as:
```json
{ "t": "encrypted", "c": "<base64 encrypted>" }
```

### Encrypted message payload (plaintext before encryption)
Messages are encrypted as `MessageContent` and then base64 encoded:

**User message**
```json
{
  "role": "user",
  "content": { "type": "text", "text": "..." },
  "localKey": "...",
  "meta": { }
}
```

**Agent message**
```json
{
  "role": "agent",
  "content": { "type": "output | codex | acp | event", "data": "..." },
  "meta": { }
}
```

### Metadata (encrypted)
```json
{
  "path": "...",
  "host": "...",
  "homeDir": "...",
  "happyHomeDir": "...",
  "happyLibDir": "...",
  "happyToolsDir": "...",
  "version": "...",
  "name": "...",
  "os": "...",
  "summary": { "text": "...", "updatedAt": 123 },
  "machineId": "...",
  "claudeSessionId": "...",
  "tools": ["..."],
  "slashCommands": ["..."],
  "startedFromDaemon": true,
  "hostPid": 12345,
  "startedBy": "daemon | terminal",
  "lifecycleState": "running | archiveRequested | archived",
  "lifecycleStateSince": 123,
  "archivedBy": "...",
  "archiveReason": "...",
  "flavor": "..."
}
```

### Agent state (encrypted)
```json
{
  "controlledByUser": true,
  "requests": {
    "<id>": { "tool": "...", "arguments": {}, "createdAt": 123 }
  },
  "completedRequests": {
    "<id>": {
      "tool": "...",
      "arguments": {},
      "createdAt": 123,
      "completedAt": 123,
      "status": "canceled | denied | approved",
      "reason": "...",
      "mode": "default | acceptEdits | bypassPermissions | plan | read-only | safe-yolo | yolo",
      "decision": "approved | approved_for_session | denied | abort",
      "allowTools": ["..."]
    }
  }
}
```

### Machine metadata (encrypted)
```json
{
  "host": "...",
  "platform": "...",
  "happyCliVersion": "...",
  "homeDir": "...",
  "happyHomeDir": "...",
  "happyLibDir": "..."
}
```

### Daemon state (encrypted)
```json
{
  "status": "running | shutting-down",
  "pid": 123,
  "httpPort": 123,
  "startedAt": 123,
  "shutdownRequestedAt": 123,
  "shutdownSource": "mobile-app | cli | os-signal | unknown"
}
```

## Decryption flow (client side)

```mermaid
flowchart TD
    Start([Receive encrypted field]) --> B64[Decode base64 to bytes]
    B64 --> Check{Has dataKey?}

    Check --> |No| Legacy[Use legacy variant]
    Check --> |Yes| DataKey[Use dataKey variant]

    subgraph "Legacy Path"
        Legacy --> ExtractL[Extract nonce + ciphertext]
        ExtractL --> DecryptL[secretbox.open with shared key]
    end

    subgraph "DataKey Path"
        DataKey --> GetDEK[Decrypt dataEncryptionKey bundle]
        GetDEK --> ExtractD[Extract version + nonce + ciphertext + tag]
        ExtractD --> DecryptD[AES-GCM decrypt with DEK]
    end

    DecryptL --> Plain([Plaintext JSON])
    DecryptD --> Plain
```

- Read base64 field from API/Socket.
- Decode base64 to bytes.
- Choose encryption variant (`legacy` or `dataKey`) based on local credentials.
- Decrypt bytes using the appropriate key and algorithm.

For `dataKey`, clients must first decrypt or derive the per-session/per-machine data key from the stored `dataEncryptionKey` bundle.

## Server-side encryption (service tokens)

```mermaid
graph LR
    subgraph "Third-Party Tokens"
        GH[GitHub OAuth]
        OAI[OpenAI]
        ANT[Anthropic]
        GEM[Gemini]
    end

    subgraph "Server"
        Secret[HANDY_MASTER_SECRET]
        KeyTree[KeyTree]
        Encrypt[Encrypt]
    end

    DB[(Postgres)]

    Secret --> KeyTree --> Encrypt
    GH & OAI & ANT & GEM --> Encrypt --> DB

    style GH fill:#fff3e0
    style OAI fill:#fff3e0
    style ANT fill:#fff3e0
    style GEM fill:#fff3e0
```

The server encrypts certain third-party tokens at rest:
- GitHub OAuth tokens (`GithubUser.token`).
- Vendor service tokens (`ServiceAccountToken.token`).

These are encrypted with a server-only KeyTree derived from `HANDY_MASTER_SECRET` and are not end-to-end encrypted.

## Encoding conventions

```mermaid
graph TB
    subgraph "Encoding Rules"
        E1["Encrypted bytes → base64 string"]
        E2["Timestamps → plain number (epoch ms)"]
        E3["IDs, tags, versions → plain string/number"]
    end

    subgraph "Examples"
        Ex1["metadata: 'SGVsbG8gV29ybGQ='"]
        Ex2["createdAt: 1704067200000"]
        Ex3["id: 'abc-123', version: 5"]
    end

    E1 --> Ex1
    E2 --> Ex2
    E3 --> Ex3
```

- All encrypted bytes are base64 strings on the wire unless explicitly noted.
- Timestamps remain plain numbers (epoch ms) and are not encrypted by the server.
- Non-encrypted identifiers (ids, tags, versions) are always plain strings/numbers.

## Session storage modes

Sessions can store transcript content in encrypted-at-rest or plaintext-at-rest mode. This is a storage mode, not a transport-security or authentication mode.

Canonical concepts:

- **Server storage policy:** `required_e2ee | optional | plaintext_only`, surfaced through `/v1/features`.
- **Account encryption mode:** `e2ee | plain`, used as the default for new sessions.
- **Session encryption mode:** `e2ee | plain`, fixed at session creation so a transcript does not mix modes.
- **Client encryption requirement:** `follow_account | require_e2ee`, resolved strongest-wins from the synced Account preference, a UI device-local pin, and the daemon's `HAPPIER_ENCRYPTION_REQUIREMENT` override.
- **Content envelope:**
  - encrypted content: `{ t: 'encrypted', c: string }`
  - plaintext content: `{ t: 'plain', v: unknown }`

Write paths must enforce mode/content-kind compatibility:

- `e2ee` sessions accept encrypted content only.
- `plain` sessions accept plain content only.

Clients must parse the envelope and branch explicitly. Do not guess that content is encrypted.

`require_e2ee` is enforced at the Account-settings and Session-content choke points. A client must reject a plaintext Account envelope before publishing it, reject plaintext session creation or a create-or-load response, and avoid opening or authoring plaintext Session content. The UI device-local pin remains scoped with the existing server/account settings persistence; the synced preference reaches a daemon through the existing Account-settings snapshot and pre-spawn minimum-version hint. No relay API or separate UI-to-daemon policy field owns this decision.

Missing client-requirement fields preserve the released behavior (`follow_account`). The daemon environment override can only strengthen the effective requirement; invalid non-empty values fail startup.

Sharing rules:

- Plain sessions can share without `encryptedDataKey` because access is server-managed.
- E2EE sessions and public shares require a valid encrypted data-key envelope.

Feature gates:

- `encryption.plaintextStorage`
- `encryption.accountOptOut`

Do not gate plaintext behavior on raw env vars or `capabilities` fields.

When Account encryption mode changes, every active new-Session draft participates in the same
atomic mode transition as the other Account-scoped encrypted records. Existing-Session drafts do
not participate: their envelope remains bound to the owning Session. A missing or incomplete draft
census, a revision mismatch, or a wrong envelope kind aborts the Account transition without
partially changing the mode.

## Terminal pairing authentication rollout

Terminal pairing v3 adds a 32-byte secret to the QR/deep link and authenticates the sealed
content-key response with HMAC-SHA-256. The terminal keeps that secret local and does not include it
in the relay auth request.

The current rollout is an **expansion phase**: new native clients produce v3 responses, while the
terminal still accepts legacy v1/v2 responses for compatibility. Until a later release activates
v3 enforcement, a malicious relay can still downgrade the exchange to a forged legacy response.

Users who want to opt into enforcement during the expansion phase can require the current
authenticated protocol locally:

```bash
HAPPIER_TERMINAL_PAIRING_REQUIRE=v3 happier auth login
```

`v3` is a minimum accepted pairing-protocol requirement: legacy v1/v2 responses are rejected, and
future supported versions may satisfy the same or a stronger requirement. Unknown values fail
closed with a configuration error. For `auth request --json` plus `auth wait`, the requirement is
persisted in the private pending-auth state so the wait process cannot accidentally lose it.

Native-app QR pairing can provide relay-independent authentication once enforcement is active
because the secret travels camera-to-app. Web pairing cannot make the same guarantee against a
hostile self-hosted relay: that relay also serves the JavaScript which receives the secret, so the
web flow necessarily trusts its web origin.

## Shared workspace entry grants

The COMBO source-build `sharing.sessionEntries` feature creates a host-owned child Session for each `(entryId, userId)` membership. Creating the entry freezes source metadata and stored message ciphertext in `sourceSnapshot`. The host uses the canonical replay reader to recover user and assistant text, then creates a separate conversation through `createSpawnedSession`, using a stable member-derived spawn nonce and the source's machine, directory, and Agent. It encrypts the copied history with the child's key and waits for each stored-message acknowledgement before completing the grant. The UI routes each recipient to their assigned child. Later source messages are excluded; project files remain shared.

For E2EE children, the host verifies the recipient's content-public-key signature against its account signing key, opens the actual child session DEK, and seals that DEK with the canonical v1 encrypted-data-key envelope. It never substitutes the machine/account encryption key. Plain children require no key envelope. Legacy encrypted sources without a per-session DEK fail closed. The canonical session-creation policy must match the source mode before a new child is spawned; a second check catches changes during allocation.

`SharedSessionEntryMember` owns readiness and revocation; the resulting `SessionShare` grants edit access with no approval delegation. `sessionEntryAdmission` checks current membership and the exact machine's live relay connection at message admission and pending dispatch. Host transcript publication remains possible during reconnection. Grant/revoke operations use the existing share event, change cursor, relay-cache invalidation, and draft lifecycle owners. Revocation prevents future access; it cannot retract previously delivered keys or plaintext from a recipient.

Publication metadata (`publicMetadata.v = 1`) is a separate plaintext whitelist of description and publisher display name; the title remains the entry title. Possession of the invitation token allows an anonymous preview of these fields, never of the source snapshot, source key, machine, members, or messages. An authenticated preview can also return only that account's existing membership access; reading a preview does not allocate a child.

New entries retain `inviteTokenEncrypted` using the existing server-master-key encryption owner, with a derivation path bound to the entry owner, entry ID, and invite version. This is server-side encryption at rest, not end-to-end encryption. Only the authenticated owner can recover the token. The SHA-256 token hash remains the lookup authority; recovery also checks that the plaintext matches it. Explicit rotation updates both hash and ciphertext, while preserving context and existing members. A legacy hash-only token is not recoverable, and reading it never rotates it implicitly.


### Execution-policy assessment: unresolved (2026-10-04)

A disposable SQLite probe observed that a managed recipient with `canApprovePermissions = false` could update the child's plaintext metadata from `permissionMode: "default"` to `"yolo"`. The write passed through `updateSessionMetadata` and `ensureSessionEditAccess` in `apps/server/sources/app/session/sessionWriteService.ts`; that boundary accepts the recipient's edit grant. This proves a metadata-write capability, not a real model execution or sandbox escape. No model, shell tool, real login, or customer account was used.

To reproduce without execution, run from `apps/server` with its existing `createLightSqliteHarness` against a fresh temporary database. Create synthetic owner and recipient accounts, an owner machine, a plain source and child session, an entry and a ready member assigned to that child. Create a `SessionShare` with `entryMemberId`, `accessLevel: "edit"`, and `canApprovePermissions: false`. Do not connect an agent. Then use the real boundaries:

```ts
import { canApprovePermissions } from '@/app/share/accessControl';
import { updateSessionMetadata } from '@/app/session/sessionWriteService';
import { db } from '@/storage/db';

const canApprove = await canApprovePermissions(recipient.id, child.id);
const result = await updateSessionMetadata({
    actorUserId: recipient.id,
    sessionId: child.id,
    expectedVersion: child.metadataVersion,
    metadataCiphertext: JSON.stringify({ permissionMode: 'yolo', permissionModeUpdatedAt: 1 }),
});
const saved = await db.session.findUniqueOrThrow({ where: { id: child.id } });
console.log({ canApprove, metadataUpdateAccepted: result.ok,
    savedPermissionMode: JSON.parse(saved.metadata).permissionMode });
// Observed: { canApprove: false, metadataUpdateAccepted: true, savedPermissionMode: 'yolo' }
```

Close the harness afterward so it removes its temporary database. Use the repository's normal Yarn invocation and current generated SQLite client; no retained database migration or credentials are required.

A second, source-derived risk is the permission override in `message.meta`: the Codex `onUserMessage` handler in `apps/cli/src/backends/codex/runCodex.ts` reads it and updates the runtime permission mode. The Codex policy owner maps `yolo` to `approvalPolicy: "never"` and `sandbox: "danger-full-access"`. The live consequence of a recipient-supplied override has not been exercised. Separately, `provisionSharedSession` inherits the source's permission mode and uses the same project directory, so independent conversations provide neither file isolation nor a guarantee of per-action host approval.

The proposed requirement is awaiting user confirmation: recipients may chat and submit tasks, while the host retains authority over execution permissions. If approved, repair the host's permission resolution and the server's session-control mutation boundary together, preserving recipient chat access, ordinary owner controls, offline recovery, and encrypted-message support. Hiding a UI picker or parsing only plaintext metadata on the relay is insufficient. Validate recipient metadata and message overrides, owner changes, inherited automatic modes, and recovery at those real boundaries before a paid/live execution test. No policy change has been implemented by this assessment.


### Consumer message risk gate: local mock integration (2026-10-04)

`apps/cli/src/api/session/consumerMessageRiskGate.ts` implements the approved risk disposition: a valid risk probability at or above an explicitly supplied threshold refuses input; missing configuration, malformed results, exceptions, and timeout return `consumer_risk_unavailable` with `retryable: true`. There is no human-review decision. Provider ID, threshold, evaluator, and request budget are injected through `ApiClient.sessionSyncClient`/`ApiSessionClient`; the synthetic test threshold is not calibrated Jev policy. No Jev network adapter or credentials are configured.

The server assigns `SessionPendingMessage.authorAccountId` from authenticated `request.userId`, including when the body is edited. The canonical materializer compares this writer with Session ownership and `SharedSessionEntryMember.userId`, returning `consumerMessageSource` outside encrypted payload content: `owner`, `private` (verified owner input outside a managed child), `consumer`, or `unknown`. HTTP and socket serialization use the same owner; rejoining a provider claim recalculates the classification from its stored author. No schema shape or migration changes are required. Deleted/missing attribution and other unverified writers are unknown; absence of a managed member alone never exempts a message. Neither payload metadata nor editable `sharedSessionEntryId` decides this classification.

`ApiSessionClient.deliverPendingQueueMessage` checks consumer/unknown input after decryption and before marking it delivered, buffering it, or invoking the Agent callback. Confirmed owner/private input bypasses evaluation. A missing or malformed classification on the current provider-claim contract is screened rather than presumed owner. The released `server-v0.2.1` sid-only materializer commits/removes a row before returning it and cannot atomically attest the message writer. The host therefore blocks that operation before materialization with non-retryable `consumer_source_unavailable`, preserving the queue. A pre-read would not fence editing, reordering, or sharing changes. Current-server verified owner/private input retains its bypass; safe continuation against that older peer requires a server upgrade or an approved atomic source-attestation backport. After evaluation and again before buffered dispatch, the host rechecks runtime closure/termination, socket identity, connection epoch, server contract, and provider generation. Invalidated unaccepted claims follow existing runtime-disposed settlement; close/replacement retains the existing server recovery owner. Concurrent successful claims recheck canonical local deduplication after evaluation. Refusal settles a current claim with existing `provider_rejected_before_acceptance`; evaluator unavailability uses `provider_unavailable_before_acceptance`, preserving explicit retry without classifying the content as malicious. Default-on warning logs contain codes and identifiers, not message text or private evaluator errors.

Local tests inject mock evaluators; no real Jev/model request is sent. This gate covers the canonical remote Pending-to-Agent callback and its buffer, not local terminal input, initial host/provider prompts, or execution-run/direct provider APIs. It is not filesystem isolation and does not repair the unresolved execution-policy assessment above. Live use still requires an approved real adapter/configuration; without an evaluator, consumer/unknown messages stop with retryable unavailability.

Before live TypeSafe/Jev use, approve the outbound message/context disclosure and request budget, choose provider endpoint/model and a product threshold with evaluation evidence, and supply credentials through the existing approved secret owner. The official guardrails cookbook gives application-owned policy examples, not calibrated COMBO settings: https://docs.typesafe.ai/cookbooks/llm_guardrails and https://docs.typesafe.ai/model-jaggedness/jev-1.13.

## Implementation references
- Client crypto: `apps/cli/src/api/encryption.ts`
- Session message format: `apps/cli/src/api/types.ts`
- Server message ingestion: `apps/server/sources/app/api/socket/sessionUpdateHandler.ts`
- Artifact/KV routes: `apps/server/sources/app/api/routes/artifactsRoutes.ts`, `apps/server/sources/app/kv/kvMutate.ts`
