import { Platform, Linking } from 'react-native';
import { decodeBase64, encodeBase64 } from '@/encryption/base64';
import { getRandomBytesAsync } from '@/platform/cryptoRandom';
import { TokenStorage } from '@/auth/storage/tokenStorage';
import sodium from '@/encryption/libsodium.lib';
import { getAuthProvider } from '@/auth/providers/registry';
import { Modal } from '@/modal';
import { t } from '@/text';
import { isSafeExternalAuthUrl } from '@/auth/providers/externalAuthUrl';
import { getActiveServerSnapshot } from '@/sync/domains/server/serverRuntime';
import { digest } from '@/platform/digest';
import { encodeHex } from '@/encryption/hex';
import { resolveAuthReturnToRoute } from '@/auth/routing/resolveAuthReturnToRoute';

function isAuthServerSnapshotCurrent(snapshot: ReturnType<typeof getActiveServerSnapshot>): boolean {
    const current = getActiveServerSnapshot();
    return current.serverId === snapshot.serverId
        && current.serverUrl === snapshot.serverUrl
        && current.generation === snapshot.generation;
}

/** Shared by welcome and invitation entry; pending keys remain owned by TokenStorage. */
export function createExternalProviderAuthActions({ returnTo, resolveReturnTo = (value) => resolveAuthReturnToRoute(value, false) }: {
    returnTo?: unknown;
    resolveReturnTo?: (value: unknown) => string;
}) {
    const createAccountViaProvider = async (providerId: string) => {
        const snapshot = getActiveServerSnapshot();
        let preservePendingSecret = false;
        let pendingWritten = false;
        try {
            const pending = await TokenStorage.getPendingExternalAuth();
            if (!isAuthServerSnapshotCurrent(snapshot)) throw new Error('Server changed during authentication');
            const recoveryPending = pending?.finalizeAttempted && pending.secret ? pending : null;
            preservePendingSecret = Boolean(recoveryPending);
            if (recoveryPending && recoveryPending.provider !== providerId) {
                await Modal.alert(t('common.error'), t('errors.operationFailed'));
                return;
            }
            const proofBytes = await getRandomBytesAsync(32);
            const proof = encodeBase64(proofBytes, 'base64url');
            const proofHashBytes = await digest('SHA-256', new TextEncoder().encode(proof));
            const proofHash = encodeHex(proofHashBytes).toLowerCase();

            const secretBytes = recoveryPending?.secret
                ? decodeBase64(recoveryPending.secret, 'base64url')
                : await getRandomBytesAsync(32);
            const secret = encodeBase64(secretBytes, 'base64url');
            const signingKeyPair = sodium.crypto_sign_seed_keypair(secretBytes);
            const publicKey = encodeBase64(signingKeyPair.publicKey);

            if (!isAuthServerSnapshotCurrent(snapshot)) throw new Error('Server changed during authentication');
            const serverUrl = snapshot.serverUrl ? String(snapshot.serverUrl).trim() : '';
            pendingWritten = await TokenStorage.setPendingExternalAuth({
                ...recoveryPending,
                provider: providerId,
                proof,
                secret,
                returnTo: resolveReturnTo(recoveryPending?.returnTo ?? returnTo),
                ...(snapshot.serverId ? { serverId: snapshot.serverId } : {}),
                ...(serverUrl ? { serverUrl } : {}),
            });
            if (!pendingWritten) throw new Error('Failed to save pending external auth');
            if (!isAuthServerSnapshotCurrent(snapshot)) throw new Error('Server changed during authentication');

            const provider = getAuthProvider(providerId);
            if (!provider) {
                if (!preservePendingSecret) await TokenStorage.clearPendingExternalAuth();
                await Modal.alert(t('common.error'), t('errors.operationFailed'));
                return;
            }

            const url = await provider.getExternalAuthUrl({ mode: 'keyed', proofHash, publicKey });
            if (!isAuthServerSnapshotCurrent(snapshot)) throw new Error('Server changed during authentication');
            if (!isSafeExternalAuthUrl(url)) {
                if (!preservePendingSecret) await TokenStorage.clearPendingExternalAuth();
                await Modal.alert(t('common.error'), t('errors.operationFailed'));
                return;
            }
            if (Platform.OS === 'web') {
                const location = (globalThis as any)?.window?.location;
                if (location && typeof location.assign === 'function') {
                    location.assign(url);
                    return;
                }
                if (location && typeof location.href === 'string') {
                    location.href = url;
                    return;
                }
            }
            await Linking.openURL(url);
        } catch (error) {
            if (pendingWritten && !preservePendingSecret && isAuthServerSnapshotCurrent(snapshot)) await TokenStorage.clearPendingExternalAuth();
            await Modal.alert(t('common.error'), t('errors.operationFailed'));
        }
    };

    const loginWithKeylessProvider = async (providerId: string) => {
        const snapshot = getActiveServerSnapshot();
        let pendingWritten = false;
        try {
            const pending = await TokenStorage.getPendingExternalAuth();
            if (!isAuthServerSnapshotCurrent(snapshot)) throw new Error('Server changed during authentication');
            if (pending?.finalizeAttempted && pending.secret) {
                await Modal.alert(t('common.error'), t('errors.operationFailed'));
                return;
            }
            const proofBytes = await getRandomBytesAsync(32);
            const proof = encodeBase64(proofBytes, "base64url");
            const proofHashBytes = await digest('SHA-256', new TextEncoder().encode(proof));
            const proofHash = encodeHex(proofHashBytes).toLowerCase();

            if (!isAuthServerSnapshotCurrent(snapshot)) throw new Error('Server changed during authentication');
            const serverUrl = snapshot.serverUrl ? String(snapshot.serverUrl).trim() : '';
            pendingWritten = await TokenStorage.setPendingExternalAuth({
                provider: providerId,
                proof,
                returnTo: resolveReturnTo(returnTo),
                ...(snapshot.serverId ? { serverId: snapshot.serverId } : {}),
                ...(serverUrl ? { serverUrl } : {}),
            });
            if (!pendingWritten) throw new Error('Failed to save pending external auth');
            if (!isAuthServerSnapshotCurrent(snapshot)) throw new Error('Server changed during authentication');

            const provider = getAuthProvider(providerId);
            if (!provider) {
                await TokenStorage.clearPendingExternalAuth();
                await Modal.alert(t('common.error'), t('errors.operationFailed'));
                return;
            }

            const url = await provider.getExternalAuthUrl({ mode: 'keyless', proofHash });
            if (!isAuthServerSnapshotCurrent(snapshot)) throw new Error('Server changed during authentication');
            if (!isSafeExternalAuthUrl(url)) {
                await TokenStorage.clearPendingExternalAuth();
                await Modal.alert(t('common.error'), t('errors.operationFailed'));
                return;
            }
            if (Platform.OS === 'web') {
                const location = (globalThis as any)?.window?.location;
                if (location && typeof location.assign === 'function') {
                    location.assign(url);
                    return;
                }
                if (location && typeof location.href === 'string') {
                    location.href = url;
                    return;
                }
            }
            await Linking.openURL(url);
        } catch {
            if (pendingWritten && isAuthServerSnapshotCurrent(snapshot)) await TokenStorage.clearPendingExternalAuth();
            await Modal.alert(t('common.error'), t('errors.operationFailed'));
        }
    };

    return { createAccountViaProvider, loginWithKeylessProvider };
}
