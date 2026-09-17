import { z } from 'zod';
import { serverFetch } from '@/sync/http/client';
import { createSessionRequestWithServerScope } from '@/sync/runtime/orchestration/serverScopedRpc/createSessionRequestWithServerScope';

const statusSchema = z.enum(['pending', 'provisioning', 'ready', 'failed', 'revoked']);
const accessSchema = z.object({
    entryId: z.string(), title: z.string(), memberId: z.string(), status: statusSchema,
    sessionId: z.string().nullable(), hostOnline: z.boolean(), errorCode: z.string().nullable(),
}).refine((access) => access.status !== 'ready' || Boolean(access.sessionId));
const entrySchema = z.object({
    id: z.string(), title: z.string(), sourceSessionId: z.string(), machineId: z.string(), createdAt: z.number(),
    hasContextSnapshot: z.boolean().default(false),
});
const memberSchema = z.object({ id: z.string(), userId: z.string(), username: z.string().nullable(), status: statusSchema, enabled: z.boolean(), sessionId: z.string().nullable(), errorCode: z.string().nullable() });
export type SharedEntryAccess = z.infer<typeof accessSchema>;
export type SharedEntry = z.infer<typeof entrySchema>;
export type SharedEntryMember = z.infer<typeof memberSchema>;

export class SharedEntryError extends Error {
    constructor(readonly code: string, readonly status: number) { super(code); }
}

/** Requests keep the selected server's credentials and never automatically retry a mutation. */
export function createSharedEntryClient(serverId?: string | null) {
    const request = createSessionRequestWithServerScope({ serverId, activeRequest: serverFetch });
    async function json(path: string, init?: RequestInit): Promise<unknown> {
        const response = await request(path, init);
        const result = await response.json().catch(() => null);
        if (!response.ok) throw new SharedEntryError(typeof result?.error === 'string' ? result.error : 'operation_failed', response.status);
        return result;
    }
    const base = '/v1/shared-session-entries';
    const body = (value: unknown, method = 'POST'): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
    return {
        list: async () => z.object({ entries: z.array(entrySchema) }).parse(await json(base)).entries,
        create: async (input: { title: string; sourceSessionId: string; machineId: string }) => z.object({ entry: entrySchema, inviteToken: z.string() }).parse(await json(base, body(input))),
        rotateInvite: async (entryId: string) => z.object({ inviteToken: z.string() }).parse(await json(`${base}/${encodeURIComponent(entryId)}/invite`, body({}))).inviteToken,
        redeem: async (inviteToken: string) => z.object({ access: accessSchema }).parse(await json(`${base}/redeem`, body({ inviteToken }))).access,
        access: async (entryId: string) => z.object({ access: accessSchema }).parse(await json(`${base}/${encodeURIComponent(entryId)}/access`)).access,
        sessionAccess: async (sessionId: string) => z.object({ access: accessSchema.nullable() }).parse(await json(`/v1/sessions/${encodeURIComponent(sessionId)}/shared-session-entry-access`)).access,
        members: async (entryId: string) => z.object({ members: z.array(memberSchema) }).parse(await json(`${base}/${encodeURIComponent(entryId)}/members`)).members,
        setMemberEnabled: async (entryId: string, memberId: string, enabled: boolean) => z.object({ member: memberSchema }).parse(await json(`${base}/${encodeURIComponent(entryId)}/members/${encodeURIComponent(memberId)}`, body({ enabled }, 'PATCH'))).member,
    };
}
