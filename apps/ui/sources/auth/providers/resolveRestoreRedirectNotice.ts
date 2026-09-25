import { getAuthProvider } from './registry';
import type { RestoreRedirectNotice } from './types';

/** The same verified-provider recovery explanation is used by desktop and phone entry. */
export function resolveRestoreRedirectNotice(providerValue: unknown, reasonValue: unknown): RestoreRedirectNotice | null {
    const provider = Array.isArray(providerValue) ? providerValue[0] : providerValue;
    const reason = Array.isArray(reasonValue) ? reasonValue[0] : reasonValue;
    const providerId = typeof provider === 'string' ? provider.trim().toLowerCase() : '';
    if (!providerId || typeof reason !== 'string' || reason.trim() !== 'provider_already_linked') return null;
    return getAuthProvider(providerId)?.getRestoreRedirectNotice?.({ reason: 'provider_already_linked' }) ?? null;
}
