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
import { registerSessionDraftRoutes } from "@/app/account/sessionDrafts/registerSessionDraftRoutes";
import { sessionDraftPhysicalKey } from "@/app/account/sessionDrafts/sessionDraftService";

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
        registerSessionDraftRoutes(app);
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
        return post(ownerId, `/v1/machines/${machineId}/shared-session-entries/${memberId}/complete`, { sessionId, contextSnapshotVersion: 1, ...(encryptedDataKey ? { encryptedDataKey } : {}) });
    }

    it("reports snapshot availability without exposing snapshot contents in entry summaries", async () => {
        const { newInvite } = await import("@/app/share/sessionEntryService");
        const legacy = await db.sharedSessionEntry.create({ data: { ownerId, sourceSessionId, machineId, title: "Legacy summary", inviteTokenHash: newInvite().hash } });
        const created = await entry();
        expect(created.entry.hasContextSnapshot).toBe(true);
        const response = await app.inject({ method: "GET", url: "/v1/shared-session-entries", headers: { "x-test-user-id": ownerId } });
        expect(response.statusCode).toBe(200);
        expect(response.json().entries).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: created.entry.id, hasContextSnapshot: true }),
            expect.objectContaining({ id: legacy.id, hasContextSnapshot: false }),
        ]));
        expect(response.body).not.toContain("sourceSnapshot");
        expect(response.body).not.toContain("opaque-source-metadata");
        expect(response.body).not.toContain("dataEncryptionKey");
    });

    it("rejects completion from daemons that do not acknowledge context snapshot version 1", async () => {
        const created = await entry();
        const memberId = (await redeem(created.inviteToken)).json().access.memberId;
        await claim(memberId);
        const childSession = await child();
        for (const contextSnapshotVersion of [undefined, 0, 2, "1"]) {
            const response = await post(ownerId, `/v1/machines/${machineId}/shared-session-entries/${memberId}/complete`, {
                sessionId: childSession.id, ...(contextSnapshotVersion === undefined ? {} : { contextSnapshotVersion }),
            });
            expect(response.statusCode).toBe(400);
            expect(await db.sessionShare.count({ where: { entryMemberId: memberId } })).toBe(0);
            expect(await checkSessionAccess(guestId, childSession.id)).toBeNull();
        }
        expect(await db.sharedSessionEntryMember.findUniqueOrThrow({ where: { id: memberId } })).toMatchObject({ status: "provisioning", sessionId: null });
        expect((await complete(memberId, childSession.id)).statusCode).toBe(200);
    });

    it.each(["pending", "provisioning", "failed", "ready", "revoked"])("refuses to capture a new snapshot when rotating a legacy entry with a %s member", async (status) => {
        const { newInvite } = await import("@/app/share/sessionEntryService");
        const invite = newInvite();
        const legacy = await db.sharedSessionEntry.create({ data: { ownerId, sourceSessionId, machineId, title: "Legacy with members", inviteTokenHash: invite.hash } });
        const childSession = await child();
        const member = await db.sharedSessionEntryMember.create({ data: {
            entryId: legacy.id, userId: guestId, status, enabled: status !== "revoked", sessionId: status === "ready" ? childSession.id : null,
        } });
        if (status === "ready") {
            await db.sessionShare.create({ data: {
                sessionId: childSession.id, sharedByUserId: ownerId, sharedWithUserId: guestId,
                entryMemberId: member.id, accessLevel: "edit", canApprovePermissions: false,
            } });
        }

        const rotated = await post(ownerId, `/v1/shared-session-entries/${legacy.id}/invite`);

        expect(rotated.statusCode).toBe(409);
        expect(rotated.json().error).toBe("context_snapshot_required");
        expect(await db.sharedSessionEntry.findUniqueOrThrow({ where: { id: legacy.id } })).toMatchObject({ sourceSnapshot: null, inviteTokenHash: invite.hash });
        const newGuest = await guest();
        expect((await redeem(invite.token, newGuest.id)).json().error).toBe("context_snapshot_required");
        if (status === "ready") {
            expect((await redeem(invite.token)).json().access.sessionId).toBe(childSession.id);
            const response = await app.inject({ method: "GET", url: `/v1/shared-session-entries/${legacy.id}/access`, headers: { "x-test-user-id": guestId } });
            expect(response.json().access).toMatchObject({ status: "ready", sessionId: childSession.id });
            expect((await checkSessionAccess(guestId, childSession.id))?.level).toBe("edit");
        } else if (status !== "revoked") {
            expect((await redeem(invite.token)).json().error).toBe("context_snapshot_required");
            expect((await complete(member.id, childSession.id)).json().error).toBe("context_snapshot_required");
        } else {
            const enabled = await app.inject({ method: "PATCH", url: `/v1/shared-session-entries/${legacy.id}/members/${member.id}`,
                headers: { "x-test-user-id": ownerId }, payload: { enabled: true } });
            expect(enabled.statusCode).toBe(409);
            expect(enabled.json().error).toBe("context_snapshot_required");
            expect(await db.sharedSessionEntryMember.findUniqueOrThrow({ where: { id: member.id } })).toMatchObject({ enabled: false, status: "revoked" });
        }
    });

    it("skips legacy pending assignments without snapshots so they cannot block new shares", async () => {
        const { newInvite } = await import("@/app/share/sessionEntryService");
        const legacy = await db.sharedSessionEntry.create({ data: { ownerId, sourceSessionId, machineId, title: "Legacy pending", inviteTokenHash: newInvite().hash } });
        await db.sharedSessionEntryMember.create({ data: { entryId: legacy.id, userId: guestId, createdAt: new Date(0) } });
        const created = await entry();
        const memberId = (await redeem(created.inviteToken)).json().access.memberId;

        expect((await claim(memberId)).sourceSnapshot.v).toBe(1);
    });

    it.each(["plain", "e2ee"])("restores the same legacy %s child after revocation without capturing source context", async (encryptionMode) => {
        const { newInvite } = await import("@/app/share/sessionEntryService");
        const invite = newInvite();
        const legacy = await db.sharedSessionEntry.create({ data: { ownerId, sourceSessionId, machineId, title: "Legacy conversation", inviteTokenHash: invite.hash } });
        const childSession = await child(encryptionMode);
        await db.sessionMessage.create({ data: { sessionId: childSession.id, seq: 1, content: { t: "encrypted", c: "existing-child-content" } } });
        const member = await db.sharedSessionEntryMember.create({ data: { entryId: legacy.id, userId: guestId, status: "ready", sessionId: childSession.id } });
        await db.sessionShare.create({ data: {
            sessionId: childSession.id, sharedByUserId: ownerId, sharedWithUserId: guestId,
            entryMemberId: member.id, accessLevel: "edit", canApprovePermissions: false,
        } });
        const toggle = (enabled: boolean) => app.inject({ method: "PATCH", url: `/v1/shared-session-entries/${legacy.id}/members/${member.id}`,
            headers: { "x-test-user-id": ownerId }, payload: { enabled } });
        expect((await toggle(false)).statusCode).toBe(200);
        expect(await checkSessionAccess(guestId, childSession.id)).toBeNull();
        expect(await db.sessionShare.count({ where: { entryMemberId: member.id } })).toBe(0);

        expect((await toggle(true)).statusCode).toBe(200);
        const assignment = await claim(member.id);
        expect(assignment).toMatchObject({ sessionId: childSession.id, sourceSnapshot: null, encryptionMode });
        expect(await checkSessionAccess(guestId, childSession.id)).toBeNull();
        const differentChild = await child(encryptionMode);
        expect((await complete(member.id, differentChild.id)).json().error).toBe("invalid_child_session");
        const wrappedKey = encryptionMode === "e2ee" ? Buffer.alloc(105).toString("base64") : undefined;
        if (wrappedKey) expect((await complete(member.id, childSession.id)).json().error).toBe("encrypted_data_key_required");
        expect((await complete(member.id, childSession.id, wrappedKey)).statusCode).toBe(200);
        expect((await checkSessionAccess(guestId, childSession.id))?.level).toBe("edit");
        const share = await db.sessionShare.findUniqueOrThrow({ where: { entryMemberId: member.id } });
        expect(share).toMatchObject({ sessionId: childSession.id, accessLevel: "edit", canApprovePermissions: false });
        if (wrappedKey) expect(Buffer.from(share.encryptedDataKey!).toString("base64")).toBe(wrappedKey);
        expect((await db.sharedSessionEntry.findUniqueOrThrow({ where: { id: legacy.id } })).sourceSnapshot).toBeNull();
        expect(await db.sessionMessage.count({ where: { sessionId: childSession.id } })).toBe(1);
        expect((await redeem(invite.token, (await guest()).id)).json().error).toBe("context_snapshot_required");
    });

    it("keeps the snapshot and encryption contract frozen when the source changes and the invitation rotates", async () => {
        const encryptedSource = await child("e2ee");
        const created = await entry(encryptedSource.id);
        const captured = (await db.sharedSessionEntry.findUniqueOrThrow({ where: { id: created.entry.id } })).sourceSnapshot;
        await db.session.update({ where: { id: encryptedSource.id }, data: { encryptionMode: "plain", dataEncryptionKey: null, metadata: "later-private-metadata" } });

        const rotated = await post(ownerId, `/v1/shared-session-entries/${created.entry.id}/invite`);
        expect(rotated.statusCode).toBe(200);
        expect((await db.sharedSessionEntry.findUniqueOrThrow({ where: { id: created.entry.id } })).sourceSnapshot).toEqual(captured);
        const encryptedGuest = await guest();
        expect((await redeem(rotated.json().inviteToken, encryptedGuest.id)).json().error).toBe("content_keys_required");
        await db.account.update({ where: { id: encryptedGuest.id }, data: { contentPublicKey: new Uint8Array(32), contentPublicKeySig: new Uint8Array(64) } });
        const memberId = (await redeem(rotated.json().inviteToken, encryptedGuest.id)).json().access.memberId;
        const assignment = await claim(memberId);
        expect(assignment.encryptionMode).toBe("e2ee");
        expect(assignment.sourceSnapshot).toEqual(captured);
        const plaintextChild = await child();
        expect((await complete(memberId, plaintextChild.id)).json().error).toBe("encryption_mode_mismatch");
        const encryptedChild = await child("e2ee");
        expect((await complete(memberId, encryptedChild.id, Buffer.alloc(105).toString("base64"))).statusCode).toBe(200);
    });

    it("allows 5000 snapshot rows and atomically refuses a larger context", async () => {
        const source = await child();
        await db.session.update({ where: { id: source.id }, data: { seq: 5_000 } });
        for (let offset = 0; offset < 5_000; offset += 500) {
            await db.sessionMessage.createMany({ data: Array.from({ length: 500 }, (_, index) => ({
                sessionId: source.id, seq: offset + index + 1, content: { t: "plain", v: "context" },
            })) });
        }
        const created = await entry(source.id);
        const snapshot = (await db.sharedSessionEntry.findUniqueOrThrow({ where: { id: created.entry.id } })).sourceSnapshot as { messages: unknown[] };
        expect(snapshot.messages).toHaveLength(5_000);
        await db.session.update({ where: { id: source.id }, data: { seq: 5_001 } });
        await db.sessionMessage.create({ data: { sessionId: source.id, seq: 5_001, content: { t: "plain", v: "extra" } } });
        const rejected = await post(ownerId, "/v1/shared-session-entries", { title: "Oversized", sourceSessionId: source.id, machineId });
        expect(rejected.statusCode).toBe(409);
        expect(rejected.json().error).toBe("context_snapshot_too_large");
        expect(await db.sharedSessionEntry.count({ where: { sourceSessionId: source.id } })).toBe(1);
    });

    it("bounds snapshot size in UTF-8 bytes without leaving a partial entry", async () => {
        const source = await child();
        await db.session.update({ where: { id: source.id }, data: { metadata: "界".repeat(700_000) } });
        const rejected = await post(ownerId, "/v1/shared-session-entries", { title: "Oversized bytes", sourceSessionId: source.id, machineId });
        expect(rejected.statusCode).toBe(409);
        expect(rejected.json().error).toBe("context_snapshot_too_large");
        expect(await db.sharedSessionEntry.count({ where: { sourceSessionId: source.id } })).toBe(0);
    });

    it("freezes message content and metadata when sharing, without exposing the source snapshot to guests", async () => {
        const source = await child();
        await db.session.update({ where: { id: source.id }, data: { seq: 1, metadata: "metadata-at-share" } });
        const message = await db.sessionMessage.create({ data: {
            sessionId: source.id, seq: 1, localId: "streaming-source",
            content: { t: "plain", v: { role: "user", content: { type: "text", text: "before sharing" } } },
        } });
        const created = await entry(source.id);
        expect(JSON.stringify(created)).not.toContain("metadata-at-share");
        await db.session.update({ where: { id: source.id }, data: { seq: 2, metadata: "private-after-sharing" } });
        await db.sessionMessage.update({ where: { id: message.id }, data: {
            content: { t: "plain", v: { role: "user", content: { type: "text", text: "private streamed addition" } } },
        } });
        await db.sessionMessage.create({ data: { sessionId: source.id, seq: 2,
            content: { t: "plain", v: { role: "user", content: { type: "text", text: "private later turn" } } },
        } });
        const redeemed = (await redeem(created.inviteToken)).json();
        expect(JSON.stringify(redeemed)).not.toContain("before sharing");
        const assignment = await claim(redeemed.access.memberId);
        expect(assignment.sourceSnapshot).toMatchObject({ v: 1, session: { id: source.id, seq: 1, metadata: "metadata-at-share" },
            messages: [{ seq: 1, content: { t: "plain", v: { content: { text: "before sharing" } } } }] });
        expect(JSON.stringify(assignment.sourceSnapshot)).not.toContain("private");
        expect(await checkSessionAccess(guestId, source.id)).toBeNull();
    });

    it("refuses legacy invitations without a share-time snapshot until the owner regenerates the invitation", async () => {
        const { newInvite } = await import("@/app/share/sessionEntryService");
        const invite = newInvite();
        const legacy = await db.sharedSessionEntry.create({ data: { ownerId, sourceSessionId, machineId, title: "Legacy", inviteTokenHash: invite.hash } });
        expect((await redeem(invite.token)).json().error).toBe("context_snapshot_required");
        expect(await db.sharedSessionEntryMember.count({ where: { entryId: legacy.id } })).toBe(0);
        const refreshed = await post(ownerId, `/v1/shared-session-entries/${legacy.id}/invite`);
        expect(refreshed.statusCode).toBe(200);
        expect((await redeem(refreshed.json().inviteToken)).statusCode).toBe(200);
    });

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

    it("retains the guest's synced encrypted draft across temporary revocation without retaining access", async () => {
        const encryptedSource = await child("e2ee");
        const created = await entry(encryptedSource.id);
        const recipient = await guest();
        await db.account.update({ where: { id: recipient.id }, data: { contentPublicKey: new Uint8Array(32), contentPublicKeySig: new Uint8Array(64) } });
        const memberId = (await redeem(created.inviteToken, recipient.id)).json().access.memberId;
        await claim(memberId);
        const childSession = await child("e2ee");
        const wrappedChildKey = Buffer.alloc(105).toString("base64");
        expect((await complete(memberId, childSession.id, wrappedChildKey)).statusCode).toBe(200);
        await db.accessKey.create({ data: { accountId: ownerId, sessionId: childSession.id, machineId, data: "host-wrapped-key" } });
        const binding = { accountId: ownerId, sessionId: childSession.id, machineId };
        expect(await authorizeSessionScopedMachineBinding(binding)).toContain(recipient.id);

        const address = { kind: "session" as const, sessionId: childSession.id };
        const content = { t: "encrypted", c: "guest-only-encrypted-draft" };
        const save = await post(recipient.id, "/v1/account/session-drafts/mutate", { address, expectedRevision: "absent", content });
        expect(save.statusCode).toBe(200);
        expect(save.json()).toMatchObject({ status: "updated", record: { revision: 0, content } });
        const read = (userId = recipient.id) => post(userId, "/v1/account/session-drafts/read", { address });
        const savedRead = (await read()).json();
        const draftWhere = { accountId_key: { accountId: recipient.id, key: sessionDraftPhysicalKey(address)! } };
        const storedDraft = await db.userKVStore.findUniqueOrThrow({ where: draftWhere });
        const draftChangeWhere = { accountId: recipient.id, kind: "account", entityId: `session-draft:session/${childSession.id}` };
        const storedChange = await db.accountChange.findFirstOrThrow({ where: draftChangeWhere });
        expect((await read(ownerId)).json()).toEqual({ status: "absent" });

        const toggle = (enabled: boolean) => app.inject({ method: "PATCH", url: `/v1/shared-session-entries/${created.entry.id}/members/${memberId}`,
            headers: { "x-test-user-id": ownerId }, payload: { enabled } });
        expect((await toggle(false)).statusCode).toBe(200);
        expect(await db.sessionShare.findUnique({ where: { entryMemberId: memberId } })).toBeNull();
        expect(await checkSessionAccess(recipient.id, childSession.id)).toBeNull();
        expect(await checkSessionAccess(recipient.id, encryptedSource.id)).toBeNull();
        expect(await authorizeSessionScopedMachineBinding(binding)).not.toContain(recipient.id);
        expect((await read()).json()).toEqual({ status: "absent" });
        expect((await post(recipient.id, "/v1/account/session-drafts/list", {})).json().items).toEqual([]);
        const rejectedSave = await post(recipient.id, "/v1/account/session-drafts/mutate", { address, expectedRevision: 0, content });
        expect(rejectedSave.statusCode).toBe(404);
        expect(rejectedSave.json()).toEqual({ error: "session_unavailable" });
        const rejectedMessage = await post(recipient.id, `/v2/sessions/${childSession.id}/messages`, { localId: "while-revoked", ciphertext: "encrypted-message", messageRole: "user" });
        expect(rejectedMessage.statusCode).toBe(403);
        expect(rejectedMessage.json().error).toBe("shared_session_access_revoked");
        const rejectedRead = await app.inject({ method: "GET", url: `/v1/sessions/${childSession.id}/messages`, headers: { "x-test-user-id": recipient.id } });
        expect(rejectedRead.statusCode).toBe(404);
        expect(await db.userKVStore.findUniqueOrThrow({ where: draftWhere })).toEqual(storedDraft);
        expect(await db.accountChange.findFirstOrThrow({ where: draftChangeWhere })).toEqual(storedChange);

        expect((await toggle(true)).statusCode).toBe(200);
        expect((await read()).json()).toEqual({ status: "absent" });
        expect((await claim(memberId)).sessionId).toBe(childSession.id);
        expect((await complete(memberId, childSession.id, wrappedChildKey)).statusCode).toBe(200);
        expect((await read()).json()).toEqual(savedRead);
        expect(await authorizeSessionScopedMachineBinding(binding)).toContain(recipient.id);
        expect(await checkSessionAccess(recipient.id, encryptedSource.id)).toBeNull();
        expect((await post(recipient.id, "/v1/account/session-drafts/mutate", { address, expectedRevision: 0, content: { ...content, c: "resumed-guest-draft" } })).json())
            .toMatchObject({ status: "updated", record: { revision: 1 } });
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
