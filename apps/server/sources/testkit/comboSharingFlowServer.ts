/** Disposable loopback fixture for the paired COMBO sharing flow; no real accounts or models. */
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createLightSqliteHarness } from './lightSqliteHarness';
import { db } from '@/storage/db';
import { auth } from '@/app/auth/auth';
import { startApi } from '@/app/api/api';

async function main() {
    const readyFile = process.argv[2];
    const projectDir = process.argv[3];
    const port = Number(process.argv[4]);
    if (!readyFile || !projectDir || !Number.isInteger(port) || port < 1) throw new Error('Missing fixture arguments');
    const harness = await createLightSqliteHarness({ tempDirPrefix: 'combo-sharing-flow-db-', initAuth: true, initEncrypt: true, initFiles: true, env: {
        PORT: String(port), HAPPIER_SERVER_HOST: '127.0.0.1',
        HAPPIER_FEATURE_SHARING_SESSION_ENTRIES__ENABLED: '1',
        HAPPIER_FEATURE_ENCRYPTION__STORAGE_POLICY: 'optional',
        HAPPIER_FEATURE_ENCRYPTION__ALLOW_ACCOUNT_OPTOUT: '1',
    } });
    await mkdir(projectDir, { recursive: true });
    await writeFile(join(projectDir, 'README.md'), 'Synthetic COMBO test project. No real user files or model calls.\n');
    const account = async (label: string, key: string) => db.account.create({ data: {
        publicKey: key.repeat(64), username: label, encryptionMode: 'plain',
        AccountIdentity: { create: { provider: 'google', providerUserId: `synthetic-${label}`, profile: { email_verified: true, email: `${label}@example.test` } } },
    } });
    const owner = await account('synthetic-owner', 'a');
    const recipient = await account('synthetic-recipient', 'b');
    const outsider = await account('synthetic-outsider', 'c');
    const machineId = 'synthetic-combo-host';
    await db.machine.create({ data: { id: machineId, accountId: owner.id, active: true, metadata: JSON.stringify({ displayName: 'Synthetic host' }) } });
    const source = await db.session.create({ data: { accountId: owner.id, tag: 'synthetic-source', encryptionMode: 'plain', seq: 2,
        metadata: JSON.stringify({ path: projectDir, machineId, flavor: 'codex', permissionMode: 'default', summary: { text: '[MOCK] 家庭小助手', updatedAt: 1 } }),
    } });
    await db.sessionMessage.createMany({ data: [
        { sessionId: source.id, seq: 1, localId: 'synthetic-source-question', messageRole: 'user', content: { t: 'plain', v: { role: 'user', content: { type: 'text', text: '合成上下文：帮我安排周末。' } } } },
        { sessionId: source.id, seq: 2, localId: 'synthetic-source-answer', messageRole: 'agent', content: { t: 'plain', v: { role: 'agent', content: { type: 'codex', data: { type: 'message', message: '[MOCK] 先整理一份简单清单。' } } } } },
    ] });
    await startApi();
    await writeFile(readyFile, JSON.stringify({ baseUrl: `http://127.0.0.1:${port}`, sourceSessionId: source.id, machineId, projectDir,
        ownerToken: await auth.createToken(owner.id), recipientToken: await auth.createToken(recipient.id), outsiderToken: await auth.createToken(outsider.id),
    }), { mode: 0o600 });
    const cleanup = async () => { await harness.close(); process.exit(0); };
    process.once('SIGTERM', () => { void cleanup(); });
    process.once('SIGINT', () => { void cleanup(); });
}
void main().catch(error => { console.error(error); process.exit(1); });
