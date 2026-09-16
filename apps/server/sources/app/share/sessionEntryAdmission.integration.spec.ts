import { randomUUID } from "node:crypto";
import type { Socket } from "socket.io";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/storage/db";
import { createLightSqliteHarness, type LightSqliteHarness } from "@/testkit/lightSqliteHarness";
import { createFakeSocket } from "@/app/api/testkit/socketHarness";
import { eventRouter } from "@/app/events/eventRouter";
import { createSessionMessage } from "@/app/session/sessionWriteService";
import { enqueuePendingMessage, restorePendingMessage, sendPendingDeliveryAsNew, updatePendingRequestedAction } from "@/app/session/pending/pendingMessageService";
import { canApprovePermissions, canManageSharing, checkSessionAccess } from "./accessControl";
import { materializeNextPendingMessageForCurrentPublisher } from "@/app/session/pending/materializeNextPendingMessage";
import Fastify, { type FastifyRequest } from "fastify";
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from "fastify-type-provider-zod";
import { sessionPendingRoutes } from "@/app/api/routes/session/pendingRoutes";
import { registerSessionMessageRoutes } from "@/app/api/routes/session/registerSessionMessageRoutes";

describe("shared entry admission at canonical session writers", () => {
    let harness: LightSqliteHarness;
    const app = Fastify().withTypeProvider<ZodTypeProvider>();
    const connectedOwners = new Set<string>();
    beforeAll(async () => {
        harness = await createLightSqliteHarness({ tempDirPrefix: "happier-entry-admission-", initAuth: false,
            env: { HAPPIER_FEATURE_ENCRYPTION__STORAGE_POLICY: "optional" } });
        app.setValidatorCompiler(validatorCompiler);
        app.setSerializerCompiler(serializerCompiler);
        app.decorate("authenticate", async (request: FastifyRequest) => { request.userId = String(request.headers["x-test-user-id"] ?? ""); });
        sessionPendingRoutes(app);
        registerSessionMessageRoutes(app);
        await app.ready();
    }, 120_000);
    afterAll(async () => {
        for (const ownerId of connectedOwners) {
            for (const connection of eventRouter.getConnections(ownerId) ?? []) eventRouter.removeConnection(ownerId, connection);
        }
        await app.close();
        await harness?.close();
    });

    async function seed(online = false) {
        const suffix = randomUUID();
        const owner = await db.account.create({ data: { publicKey: `owner-${suffix}` } });
        const guest = await db.account.create({ data: { publicKey: `guest-${suffix}` } });
        const stranger = await db.account.create({ data: { publicKey: `stranger-${suffix}` } });
        const machine = await db.machine.create({ data: { id: `machine-${suffix}`, accountId: owner.id,
            metadata: "opaque", active: true, lastActiveAt: new Date() } });
        const source = await db.session.create({ data: { accountId: owner.id, tag: `source-${suffix}`, metadata: "opaque" } });
        const child = await db.session.create({ data: { accountId: owner.id, tag: `child-${suffix}`, metadata: "opaque" } });
        const entry = await db.sharedSessionEntry.create({ data: { ownerId: owner.id, machineId: machine.id,
            sourceSessionId: source.id, title: "Shared project", inviteTokenHash: suffix } });
        const member = await db.sharedSessionEntryMember.create({ data: { entryId: entry.id, userId: guest.id,
            sessionId: child.id, status: "ready", enabled: true } });
        await db.sessionShare.create({ data: { sessionId: child.id, sharedByUserId: owner.id, sharedWithUserId: guest.id,
            accessLevel: "edit", canApprovePermissions: false, encryptedDataKey: new Uint8Array([1]) } });
        if (online) {
            // Only the socket transport is replaced; permissions and SQLite writes are real.
            const socket = createFakeSocket({ connected: true }) as unknown as Socket;
            eventRouter.addConnection(owner.id, { userId: owner.id, machineId: machine.id, connectionType: "machine-scoped", socket });
            connectedOwners.add(owner.id);
        }
        return { owner, guest, stranger, machine, source, child, member };
    }
    async function enqueue(actorUserId: string, sessionId: string, localId: string = randomUUID()) {
        return enqueuePendingMessage({ actorUserId, sessionId, localId, ciphertext: "encrypted-input",
            messageRole: "user", requestedAction: { v: 1, kind: "enqueue" } });
    }
    function disconnect(ownerId: string) {
        for (const connection of eventRouter.getConnections(ownerId) ?? []) eventRouter.removeConnection(ownerId, connection);
    }

    it("rejects offline HTTP/socket writer and Pending ingress with zero new executable rows", async () => {
        const { owner, guest, child } = await seed();
        await expect(enqueue(guest.id, child.id)).resolves.toMatchObject({ ok: false, error: "host_offline" });
        await expect(enqueue(owner.id, child.id)).resolves.toMatchObject({ ok: false, error: "host_offline" });
        await expect(createSessionMessage({ actorUserId: guest.id, sessionId: child.id, ciphertext: "input", messageRole: "user" }))
            .resolves.toMatchObject({ ok: false, error: "host_offline" });
        expect(await db.sessionPendingMessage.count({ where: { sessionId: child.id } })).toBe(0);
        expect(await db.sessionMessage.count({ where: { sessionId: child.id } })).toBe(0);
    });

    it("allows host result publication while rejecting guest role spoofing during an outage", async () => {
        const { owner, guest, child } = await seed();
        await expect(createSessionMessage({ actorUserId: owner.id, sessionId: child.id, ciphertext: "result", messageRole: "agent" }))
            .resolves.toMatchObject({ ok: true, didWrite: true });
        await expect(createSessionMessage({ actorUserId: guest.id, sessionId: child.id, ciphertext: "spoofed", messageRole: "agent" }))
            .resolves.toMatchObject({ ok: false, error: "host_offline" });
        expect(await db.sessionMessage.count({ where: { sessionId: child.id } })).toBe(1);
    });

    it("does not let stale or upgraded shares bypass disabled membership or binary guest permissions", async () => {
        const { owner, guest, child, member } = await seed(true);
        await db.sessionShare.update({ where: { sessionId_sharedWithUserId: { sessionId: child.id, sharedWithUserId: guest.id } },
            data: { accessLevel: "admin", canApprovePermissions: true } });
        expect(await canApprovePermissions(guest.id, child.id)).toBe(false);
        expect(await canManageSharing(guest.id, child.id)).toBe(false);
        await db.sharedSessionEntryMember.update({ where: { id: member.id }, data: { enabled: false, status: "revoked" } });
        expect(await checkSessionAccess(guest.id, child.id)).toBeNull();
        expect(await checkSessionAccess(owner.id, child.id)).toMatchObject({ isOwner: true });
        await expect(enqueue(guest.id, child.id)).resolves.toMatchObject({ ok: false, error: "shared_session_access_revoked" });
        await expect(createSessionMessage({ actorUserId: guest.id, sessionId: child.id, ciphertext: "late" }))
            .resolves.toMatchObject({ ok: false, error: "shared_session_access_revoked" });
    });

    it("accepts its assigned member online but denies a different account despite a stray share", async () => {
        const { owner, guest, stranger, child } = await seed(true);
        await expect(enqueue(guest.id, child.id)).resolves.toMatchObject({ ok: true, didWrite: true });
        await db.sessionShare.create({ data: { sessionId: child.id, sharedByUserId: owner.id, sharedWithUserId: stranger.id,
            accessLevel: "edit", encryptedDataKey: new Uint8Array([1]) } });
        expect(await checkSessionAccess(stranger.id, child.id)).toBeNull();
        await expect(createSessionMessage({ actorUserId: stranger.id, sessionId: child.id, ciphertext: "other-user" }))
            .resolves.toMatchObject({ ok: false, error: "forbidden" });
        expect(await db.sessionPendingMessage.count({ where: { sessionId: child.id } })).toBe(1);
    });

    it("excludes a stray share recipient from new plaintext socket fan-out", async () => {
        const { owner, stranger, child } = await seed(true);
        await db.session.update({ where: { id: child.id }, data: { encryptionMode: "plain" } });
        await db.sessionShare.create({ data: { sessionId: child.id, sharedByUserId: owner.id, sharedWithUserId: stranger.id, accessLevel: "edit" } });
        const socket = createFakeSocket({ id: "stranger-live-socket" });
        eventRouter.addConnection(stranger.id, { userId: stranger.id, sessionId: child.id, connectionType: "session-scoped", socket: socket as unknown as Socket });
        connectedOwners.add(stranger.id);
        const response = await app.inject({ method: "POST", url: `/v2/sessions/${child.id}/messages`,
            headers: { "x-test-user-id": owner.id }, payload: { localId: "after-stray-share", messageRole: "agent",
                content: { t: "plain", v: { role: "agent", content: "private-new-result" } } } });
        expect(response.statusCode).toBe(200);
        expect(await checkSessionAccess(stranger.id, child.id)).toBeNull();
        expect(JSON.stringify(socket.emit.mock.calls)).not.toContain("private-new-result");
    });

    it("cannot restore or resend an earlier task as new after the host disconnects", async () => {
        const { owner, guest, child } = await seed(true);
        await enqueue(guest.id, child.id, "previous-request");
        await db.sessionPendingMessage.update({ where: { sessionId_localId: { sessionId: child.id, localId: "previous-request" } },
            data: { status: "discarded", discardedAt: new Date(), discardedReason: "user_discarded" } });
        disconnect(owner.id);
        await expect(restorePendingMessage({ actorUserId: guest.id, sessionId: child.id, localId: "previous-request" }))
            .resolves.toMatchObject({ ok: false, error: "host_offline" });
        await db.sessionPendingMessage.update({ where: { sessionId_localId: { sessionId: child.id, localId: "previous-request" } },
            data: { status: "queued", deliveryState: "blocked", deliveryBlockedReason: "delivery_outcome_uncertain" } });
        await expect(sendPendingDeliveryAsNew({ actorUserId: guest.id, sessionId: child.id, localId: "previous-request" }))
            .resolves.toMatchObject({ ok: false, error: "host_offline" });
        expect(await db.sessionPendingMessage.count({ where: { sessionId: child.id } })).toBe(1);
    });

    it("cannot arm an existing queued action for later execution while the host is offline", async () => {
        const { owner, guest, child, member } = await seed(true);
        await enqueue(guest.id, child.id, "change-action");
        disconnect(owner.id);
        const params = { actorUserId: guest.id, sessionId: child.id, localId: "change-action",
            requestedAction: { v: 1, kind: "enqueue" } as const, resumeWhenAvailable: true };
        await expect(updatePendingRequestedAction(params)).resolves.toMatchObject({ ok: false, error: "host_offline" });
        const request = () => app.inject({ method: "PATCH", url: `/v2/sessions/${child.id}/pending/change-action/action`,
            headers: { "x-test-user-id": guest.id }, payload: { requestedAction: params.requestedAction, resumeWhenAvailable: true } });
        const offline = await request();
        expect(offline.statusCode).toBe(409);
        expect(offline.json().error).toBe("host_offline");
        await db.sharedSessionEntryMember.update({ where: { id: member.id }, data: { enabled: false, status: "revoked" } });
        const revoked = await request();
        expect(revoked.statusCode).toBe(403);
        expect(revoked.json().error).toBe("shared_session_access_revoked");
    });

    it("rejects an offline owner user task whose role is derived from plaintext content", async () => {
        const { owner, child } = await seed();
        await db.session.update({ where: { id: child.id }, data: { encryptionMode: "plain" } });
        await expect(createSessionMessage({ actorUserId: owner.id, sessionId: child.id,
            content: { t: "plain", v: { role: "user", content: "run a task" } } }))
            .resolves.toMatchObject({ ok: false, error: "host_offline" });
        await expect(createSessionMessage({ actorUserId: owner.id, sessionId: child.id,
            content: { t: "plain", v: { role: "agent", content: "completed result" } } }))
            .resolves.toMatchObject({ ok: true, didWrite: true });
    });

    it("preserves fenced host historical transcription while rejecting a stale publisher fence", async () => {
        const { owner, child, machine } = await seed();
        await db.session.update({ where: { id: child.id }, data: { active: true } });
        await db.accessKey.create({ data: { accountId: owner.id, machineId: machine.id, sessionId: child.id, data: "wrapped" } });
        const params = {
            actorUserId: owner.id, sessionId: child.id, ciphertext: "historical-user-transcript", messageRole: "user",
            trustedPublisherFence: { accountId: owner.id, machineId: machine.id, sessionId: child.id, committedFence: child.lastActiveAt },
            trustedSourceTimestamps: { createdAt: 100, updatedAt: 200 },
            trustedTranscriptObservationProvenance: { kind: "non_dependent", source: "history" } as const,
        };
        await expect(createSessionMessage({ ...params, localId: "observed-history" }))
            .resolves.toMatchObject({ ok: true, didWrite: true });
        await db.session.update({ where: { id: child.id }, data: { lastActiveAt: new Date(child.lastActiveAt.getTime() + 1) } });
        await expect(createSessionMessage({ ...params, localId: "stale-history" }))
            .resolves.toMatchObject({ ok: false, error: "forbidden" });
        await expect(enqueue(owner.id, child.id)).resolves.toMatchObject({ ok: false, error: "host_offline" });
        expect(await db.sessionMessage.count({ where: { sessionId: child.id } })).toBe(1);
    });

    it("does not dispatch an already queued task after a host disconnect or member revocation", async () => {
        const { owner, guest, child, machine, member } = await seed(true);
        await enqueue(guest.id, child.id, "waiting");
        const active = await db.session.update({ where: { id: child.id }, data: { active: true, lastActiveAt: new Date() } });
        await db.accessKey.create({ data: { accountId: owner.id, machineId: machine.id, sessionId: child.id, data: "wrapped" } });
        const claim = () => materializeNextPendingMessageForCurrentPublisher({
            actorUserId: owner.id, sessionId: child.id, deliveryTiming: "after_foreground_ready", foregroundState: "ready",
            trustedPublisherFence: { accountId: owner.id, machineId: machine.id, sessionId: child.id, committedFence: active.lastActiveAt },
        });
        disconnect(owner.id);
        await expect(claim()).resolves.toMatchObject({ ok: false, error: "host_offline" });
        await db.sharedSessionEntryMember.update({ where: { id: member.id }, data: { enabled: false, status: "revoked" } });
        await expect(claim()).resolves.toMatchObject({ ok: false, error: "shared_session_access_revoked" });
        expect(await db.sessionPendingMessage.findUniqueOrThrow({ where: { sessionId_localId: { sessionId: child.id, localId: "waiting" } } }))
            .toMatchObject({ status: "queued", deliveryState: null });
    });

    it("returns terminal offline and revoked codes through the real HTTP adapters", async () => {
        const { guest, child, member } = await seed();
        for (const suffix of ["pending", "messages"]) {
            const url = `/v2/sessions/${child.id}/${suffix}`;
            const payload = { localId: `http-${suffix}`, ciphertext: "ciphertext", messageRole: "user" };
            const offline = await app.inject({ method: "POST", url, headers: { "x-test-user-id": guest.id }, payload });
            expect(offline.statusCode).toBe(409);
            expect(offline.json().error).toBe("host_offline");
            await db.sharedSessionEntryMember.update({ where: { id: member.id }, data: { enabled: false, status: "revoked" } });
            const revoked = await app.inject({ method: "POST", url, headers: { "x-test-user-id": guest.id }, payload });
            expect(revoked.statusCode).toBe(403);
            expect(revoked.json().error).toBe("shared_session_access_revoked");
            await db.sharedSessionEntryMember.update({ where: { id: member.id }, data: { enabled: true, status: "ready" } });
        }
    });
});
