import Fastify from "fastify";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Socket } from "socket.io";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from "fastify-type-provider-zod";
import { db } from "@/storage/db";
import { eventRouter } from "@/app/events/eventRouter";
import { createLightSqliteHarness, type LightSqliteHarness } from "@/testkit/lightSqliteHarness";
import { createFakeSocket } from "../../testkit/socketHarness";
import { sharedSessionEntryRoutes } from "./sharedSessionEntryRoutes";
import { canApprovePermissions, canManageSharing, checkSessionAccess } from "@/app/share/accessControl";
import { isSessionEntryHostLive, sessionEntryLiveTaskRejection } from "@/app/share/sessionEntryPresence";
import { registerSessionMessageRoutes } from "../session/registerSessionMessageRoutes";
import { authorizeSessionScopedMachineBinding } from "@/app/api/socket/sessionRelayAuthCache";

describe("private session entry lifecycle", () => {
    let harness: LightSqliteHarness;
    const app = Fastify().withTypeProvider<ZodTypeProvider>();
    let ownerId: string;
    let guestId: string;
    let sourceSessionId: string;
    let hostSocket: Socket;
    let sequence = 0;
    const machineId = "entry-test-host";

    beforeAll(async () => {
        harness = await createLightSqliteHarness({
            tempDirPrefix: "happier-entry-test-",
            env: {
                HAPPIER_FEATURE_SHARING_SESSION_ENTRIES__ENABLED: "1",
                HAPPIER_FEATURE_ENCRYPTION__STORAGE_POLICY: "optional",
            },
        });
        app.setValidatorCompiler(validatorCompiler);
        app.setSerializerCompiler(serializerCompiler);
        app.decorate("authenticate", async (request: FastifyRequest, reply: FastifyReply) => {
            const userId = request.headers["x-test-user-id"];
            if (typeof userId !== "string") return reply.code(401).send({ error: "Unauthorized" });
            request.userId = userId;
        });
        sharedSessionEntryRoutes(app);
        registerSessionMessageRoutes(app);
        await app.ready();
        const owner = await db.account.create({ data: { publicKey: "owner-key" } });
        const guest = await db.account.create({ data: {
            publicKey: "guest-key", username: "guest",
            AccountIdentity: { create: { provider: "google", providerUserId: "google-guest", profile: { email_verified: true, email: "guest@example.test" } } },
        } });
        ownerId = owner.id;
        guestId = guest.id;
        await db.machine.create({ data: { id: machineId, accountId: ownerId, metadata: "opaque", active: true } });
        const source = await db.session.create({ data: {
            accountId: ownerId, tag: "private-source", metadata: "opaque-source-metadata", encryptionMode: "plain",
        } });
        sourceSessionId = source.id;
        // Socket transport is the external boundary; membership and persistence remain real.
        hostSocket = createFakeSocket({ id: "entry-host-socket", connected: true }) as unknown as Socket;
        eventRouter.addConnection(ownerId, { connectionType: "machine-scoped", userId: ownerId, machineId, socket: hostSocket });
    }, 120_000);

    beforeEach(async () => {
        await db.sharedSessionEntry.deleteMany({ where: { ownerId } });
    });

    afterAll(async () => {
        for (const connection of eventRouter.getConnections(ownerId) ?? []) eventRouter.removeConnection(ownerId, connection);
        await app.close();
        await harness?.close();
    });

    function post(userId: string, url: string, payload: object = {}) {
        return app.inject({ method: "POST", url, headers: { "x-test-user-id": userId }, payload });
    }
    async function entry(sourceId = sourceSessionId) {
        const result = await post(ownerId, "/v1/shared-session-entries", { title: "Shared project", sourceSessionId: sourceId, machineId });
        expect(result.statusCode).toBe(200);
        return result.json();
    }
    async function guest(verified = true) {
        sequence += 1;
        return db.account.create({ data: {
            publicKey: `guest-key-${sequence}`,
            AccountIdentity: { create: { provider: "google", providerUserId: `google-${sequence}`, profile: { email_verified: verified, email: `guest${sequence}@example.test` } } },
        } });
    }
    async function redeem(token: string, userId = guestId) {
        return post(userId, "/v1/shared-session-entries/redeem", { inviteToken: token });
    }
    async function child(mode = "plain") {
        sequence += 1;
        return db.session.create({ data: { accountId: ownerId, tag: `independent-${sequence}`, metadata: "independent-empty-context", encryptionMode: mode, ...(mode === "e2ee" ? { dataEncryptionKey: new Uint8Array(105) } : {}) } });
    }
    async function claim(memberId: string) {
        const result = await post(ownerId, `/v1/machines/${machineId}/shared-session-entries/claim`);
        expect(result.statusCode).toBe(200);
        expect(result.json().assignment.memberId).toBe(memberId);
        return result.json().assignment;
    }
    function complete(memberId: string, sessionId: string, encryptedDataKey?: string) {
        return post(ownerId, `/v1/machines/${machineId}/shared-session-entries/${memberId}/complete`, { sessionId, ...(encryptedDataKey ? { encryptedDataKey } : {}) });
    }

    it("redeems without friendship, keeps one membership, and gives every guest a distinct private child", async () => {
        const created = await entry();
        const secondGuest = await guest();
        const [first, repeated] = await Promise.all([redeem(created.inviteToken), redeem(created.inviteToken)]);
        expect(first.statusCode).toBe(200);
        expect(repeated.statusCode).toBe(200);
        expect(first.json().access.memberId).toBe(repeated.json().access.memberId);
        const memberId = first.json().access.memberId;
        expect(first.json().access.status).toBe("pending");
        expect(first.json().access.sessionId).toBeNull();
        expect(await checkSessionAccess(guestId, sourceSessionId)).toBeNull();
        const assignment = await claim(memberId);
        expect(assignment.encryptionMode).toBe("plain");
        expect(assignment.sourceSessionId).toBe(sourceSessionId);
        const childA = await child();
        expect((await complete(memberId, sourceSessionId)).json().error).toBe("invalid_child_session");
        expect((await complete(memberId, childA.id)).statusCode).toBe(200);
        expect((await complete(memberId, childA.id)).statusCode).toBe(200);
        expect((await checkSessionAccess(guestId, childA.id))?.level).toBe("edit");
        expect(await canApprovePermissions(guestId, childA.id)).toBe(false);
        const other = await redeem(created.inviteToken, secondGuest.id);
        const otherId = other.json().access.memberId;
        await claim(otherId);
        expect((await complete(otherId, childA.id)).json().error).toBe("invalid_child_session");
        const childB = await child();
        expect((await complete(otherId, childB.id)).statusCode).toBe(200);
        expect(await checkSessionAccess(guestId, childB.id)).toBeNull();
        expect(await checkSessionAccess(secondGuest.id, childA.id)).toBeNull();
        expect(await db.userRelationship.count()).toBe(0);
        expect(await db.sessionMessage.count({ where: { sessionId: childA.id } })).toBe(0);
        expect((await redeem(created.inviteToken)).json().access.sessionId).toBe(childA.id);
    });

    it("rejects unverified Google identities, other owners, and stale invitation links", async () => {
        const created = await entry();
        const unverified = await guest(false);
        expect((await redeem(created.inviteToken, unverified.id)).json().error).toBe("google_identity_required");
        const noGoogle = await db.account.create({ data: { publicKey: "no-google" } });
        expect((await redeem(created.inviteToken, noGoogle.id)).statusCode).toBe(403);
        expect((await post(guestId, `/v1/machines/${machineId}/shared-session-entries/claim`)).statusCode).toBe(403);
        expect((await post(guestId, `/v1/shared-session-entries/${created.entry.id}/invite`)).statusCode).toBe(403);
        const rotated = await post(ownerId, `/v1/shared-session-entries/${created.entry.id}/invite`);
        expect(rotated.statusCode).toBe(200);
        expect((await redeem(created.inviteToken)).json().error).toBe("invite_not_found");
        expect((await redeem(rotated.json().inviteToken)).statusCode).toBe(200);
    });

    it("requires a live exact-machine socket even while its database heartbeat is fresh", async () => {
        const created = await entry();
        const before = await db.sharedSessionEntryMember.count();
        hostSocket.connected = false;
        try {
            const machine = await db.machine.findUniqueOrThrow({ where: { id: machineId } });
            expect(machine.active).toBe(true);
            expect(isSessionEntryHostLive(machine)).toBe(false);
            expect((await redeem(created.inviteToken)).json().error).toBe("host_offline");
            expect((await post(ownerId, `/v1/machines/${machineId}/shared-session-entries/claim`)).statusCode).toBe(409);
            expect(await db.sharedSessionEntryMember.count()).toBe(before);
        } finally { hostSocket.connected = true; }
    });

    it("revokes read/send and in-flight provisioning atomically, then reuses the same child when re-enabled", async () => {
        const created = await entry();
        const access = (await redeem(created.inviteToken)).json().access;
        await claim(access.memberId);
        const childSession = await child();
        expect((await complete(access.memberId, childSession.id)).statusCode).toBe(200);
        const toggle = (enabled: boolean, userId = ownerId) => app.inject({ method: "PATCH", url: `/v1/shared-session-entries/${created.entry.id}/members/${access.memberId}`, headers: { "x-test-user-id": userId }, payload: { enabled } });
        expect((await toggle(false, guestId)).statusCode).toBe(403);
        expect((await toggle(false)).statusCode).toBe(200);
        expect(await db.sessionShare.count({ where: { sessionId: childSession.id } })).toBe(0);
        expect(await checkSessionAccess(guestId, childSession.id)).toBeNull();
        expect((await complete(access.memberId, childSession.id)).json().error).toBe("shared_session_access_revoked");
        expect((await redeem(created.inviteToken)).statusCode).toBe(403);
        expect((await toggle(true)).statusCode).toBe(200);
        expect((await claim(access.memberId)).sessionId).toBe(childSession.id);
        expect((await complete(access.memberId, childSession.id)).statusCode).toBe(200);
        const ready = await db.sharedSessionEntryMember.findUniqueOrThrow({ where: { id: access.memberId }, include: { entry: { include: { machine: true } } } });
        expect(sessionEntryLiveTaskRejection(ready, guestId)).toBeNull();
        hostSocket.connected = false;
        try { expect(sessionEntryLiveTaskRejection(ready, guestId)).toBe("host_offline"); }
        finally { hostSocket.connected = true; }
    });

    it("rejects E2EE downgrade, missing recipient keys, and malformed wrapped child keys", async () => {
        const encryptedSource = await child("e2ee");
        const created = await entry(encryptedSource.id);
        const encryptedGuest = await guest();
        expect((await redeem(created.inviteToken, encryptedGuest.id)).json().error).toBe("content_keys_required");
        await db.account.update({ where: { id: encryptedGuest.id }, data: { contentPublicKey: new Uint8Array(32), contentPublicKeySig: new Uint8Array(64) } });
        const access = (await redeem(created.inviteToken, encryptedGuest.id)).json().access;
        await claim(access.memberId);
        const plaintextChild = await child();
        expect((await complete(access.memberId, plaintextChild.id)).json().error).toBe("encryption_mode_mismatch");
        const encryptedChild = await child("e2ee");
        expect((await complete(access.memberId, encryptedChild.id)).json().error).toBe("encrypted_data_key_required");
        expect((await complete(access.memberId, encryptedChild.id, "bad")).json().error).toBe("invalid_encrypted_data_key");
        const envelope = Buffer.alloc(105).toString("base64");
        expect((await complete(access.memberId, encryptedChild.id, envelope)).statusCode).toBe(200);
        const share = await db.sessionShare.findUniqueOrThrow({ where: { entryMemberId: access.memberId } });
        expect(Buffer.from(share.encryptedDataKey!).toString("base64")).toBe(envelope);
        expect(share.canApprovePermissions).toBe(false);
        expect(share.accessLevel).toBe("edit");
    });

    it("keeps provisioning failures retryable only through an explicit redemption and validates safe error codes", async () => {
        const created = await entry();
        const access = (await redeem(created.inviteToken)).json().access;
        await claim(access.memberId);
        const url = `/v1/machines/${machineId}/shared-session-entries/${access.memberId}/fail`;
        expect((await post(ownerId, url, { errorCode: "/private/secret" })).statusCode).toBe(400);
        expect((await post(ownerId, url, { errorCode: "spawn_failed" })).statusCode).toBe(200);
        expect((await db.sharedSessionEntryMember.findUniqueOrThrow({ where: { id: access.memberId } })).status).toBe("failed");
        const retried = await redeem(created.inviteToken);
        expect(retried.json().access.memberId).toBe(access.memberId);
        expect(retried.json().access.status).toBe("pending");
    });

    it("keeps managed permissions binary even when a legacy share row is escalated or assigned to another guest", async () => {
        const created = await entry();
        const memberId = (await redeem(created.inviteToken)).json().access.memberId;
        await claim(memberId);
        const childSession = await child();
        expect((await complete(memberId, childSession.id)).statusCode).toBe(200);
        await db.sessionShare.update({ where: { entryMemberId: memberId }, data: { accessLevel: "admin", canApprovePermissions: true } });
        expect((await checkSessionAccess(guestId, childSession.id))?.level).toBe("edit");
        expect(await canManageSharing(guestId, childSession.id)).toBe(false);
        expect(await canApprovePermissions(guestId, childSession.id)).toBe(false);
        const otherGuest = await guest();
        await db.sessionShare.create({ data: { sessionId: childSession.id, sharedByUserId: ownerId, sharedWithUserId: otherGuest.id, accessLevel: "admin" } });
        expect(await checkSessionAccess(otherGuest.id, childSession.id)).toBeNull();
        // Keep only the owned membership grant for the cascade assertion below.
        await db.sessionShare.deleteMany({ where: { sessionId: childSession.id, sharedWithUserId: otherGuest.id } });
        await db.sharedSessionEntry.delete({ where: { id: created.entry.id } });
        expect(await db.sharedSessionEntryMember.findUnique({ where: { id: memberId } })).toBeNull();
        expect(await db.sessionShare.count({ where: { sessionId: childSession.id } })).toBe(0);
        expect(await db.session.findUnique({ where: { id: childSession.id } })).not.toBeNull();
        expect(await checkSessionAccess(guestId, childSession.id)).toBeNull();
    });

    it("fails closed when the canonical feature is disabled", async () => {
        process.env.HAPPIER_FEATURE_SHARING_SESSION_ENTRIES__ENABLED = "0";
        try {
            const response = await app.inject({ method: "GET", url: "/v1/shared-session-entries", headers: { "x-test-user-id": ownerId } });
            expect(response.statusCode).toBe(404);
            expect(response.json().error).toBe("not_found");
        } finally { process.env.HAPPIER_FEATURE_SHARING_SESSION_ENTRIES__ENABLED = "1"; }
    });

    it("stops new plaintext updates to an already connected guest immediately after revocation", async () => {
        const created = await entry();
        const memberId = (await redeem(created.inviteToken)).json().access.memberId;
        await claim(memberId);
        const childSession = await child();
        expect((await complete(memberId, childSession.id)).statusCode).toBe(200);
        await db.accessKey.create({ data: { accountId: ownerId, sessionId: childSession.id, machineId, data: "host-wrapped-key" } });
        const binding = { accountId: ownerId, sessionId: childSession.id, machineId };
        expect(await authorizeSessionScopedMachineBinding(binding)).toContain(guestId);
        const guestSocket = createFakeSocket({ id: "connected-guest" });
        const connection = { userId: guestId, sessionId: childSession.id, connectionType: "session-scoped" as const, socket: guestSocket as unknown as Socket };
        eventRouter.addConnection(guestId, connection);
        try {
            const publish = (text: string) => post(ownerId, `/v2/sessions/${childSession.id}/messages`, {
                localId: text, messageRole: "agent", content: { t: "plain", v: { role: "agent", content: text } },
            });
            expect((await publish("before-revoke-private-result")).statusCode).toBe(200);
            expect(JSON.stringify(guestSocket.emit.mock.calls)).toContain("before-revoke-private-result");
            const revoked = await app.inject({ method: "PATCH", url: `/v1/shared-session-entries/${created.entry.id}/members/${memberId}`,
                headers: { "x-test-user-id": ownerId }, payload: { enabled: false } });
            expect(revoked.statusCode).toBe(200);
            guestSocket.emit.mockClear();
            expect(await authorizeSessionScopedMachineBinding(binding)).not.toContain(guestId);
            expect((await publish("after-revoke-private-result")).statusCode).toBe(200);
            expect(JSON.stringify(guestSocket.emit.mock.calls)).not.toContain("after-revoke-private-result");
        } finally { eventRouter.removeConnection(guestId, connection); }
    });

    it("lets an owner publish only an owned source and stores no raw invitation secret", async () => {
        const response = await app.inject({
            method: "POST", url: "/v1/shared-session-entries", headers: { "x-test-user-id": ownerId },
            payload: { title: "Project assistant", sourceSessionId, machineId },
        });
        expect(response.statusCode).toBe(200);
        const result = response.json();
        expect(result.inviteToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
        const row = await db.sharedSessionEntry.findUniqueOrThrow({ where: { id: result.entry.id } });
        expect(row.inviteTokenHash).not.toBe(result.inviteToken);
        expect(row.ownerId).toBe(ownerId);
        expect(JSON.stringify(result)).not.toContain("opaque-source-metadata");

        const denied = await app.inject({
            method: "POST", url: "/v1/shared-session-entries", headers: { "x-test-user-id": guestId },
            payload: { title: "Stolen", sourceSessionId, machineId },
        });
        expect(denied.statusCode).toBe(403);
    });
});
