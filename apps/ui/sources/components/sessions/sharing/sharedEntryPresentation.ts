import { t } from '@/text';
import { SharedEntryError } from '@/sync/api/social/apiSharedEntries';
export function sharedEntryErrorMessage(error: unknown): string {
    if (error instanceof SharedEntryError) {
        switch (error.code) {
            case 'host_offline': return t('sharedEntry.hostOffline');
            case 'google_identity_required': return t('sharedEntry.googleRequired');
            case 'content_keys_required': return t('sharedEntry.keysRequired');
            case 'invite_not_found': return t('sharedEntry.inviteInvalid');
            case 'context_snapshot_required': return t('sharedEntry.contextSnapshotRequired');
            case 'context_snapshot_too_large': return t('sharedEntry.contextSnapshotTooLarge');
            case 'context_snapshot_unavailable': return t('sharedEntry.contextSnapshotUnavailable');
            case 'forbidden':
            case 'shared_session_access_revoked': return t('sharedEntry.accessDisabled');
        }
    }
    return t('errors.operationFailed');
}

/** Recovery stays with the existing account/auth routes; immutable invites cannot be repaired by a guest. */
export function sharedEntryInviteRecovery(error: unknown): 'retry' | 'account' | 'restore' | 'new-invite' | 'contact-host' {
    if (!(error instanceof SharedEntryError)) return 'retry';
    if (error.code.startsWith('context_snapshot_')) return 'new-invite';
    switch (error.code) {
        case 'google_identity_required': return 'account';
        case 'content_keys_required': return 'restore';
        case 'invite_not_found': return 'new-invite';
        case 'forbidden':
        case 'shared_session_access_revoked': return 'contact-host';
        default: return 'retry';
    }
}

/** An invitation has no message draft yet; keep the send-error guidance separate. */
export function sharedEntryInviteErrorMessage(error: unknown): string {
    if (error instanceof SharedEntryError) {
        if (error.code === 'google_auth_unavailable') return t('sharedEntry.googleAuthUnavailable');
        if (error.code === 'host_offline') return t('sharedEntry.inviteHostOffline');
        if (error.code.startsWith('context_snapshot_')) return t('sharedEntry.inviteSnapshotUnavailable');
    }
    return sharedEntryErrorMessage(error);
}

export function sharedEntryMessageSendError(result: { errorCode?: string; errorMessage?: string }): string {
    if (result.errorCode === 'host_offline') return t('sharedEntry.hostOffline');
    if (result.errorCode === 'shared_session_access_revoked') return t('sharedEntry.accessDisabled');
    return result.errorMessage ?? t('errors.failedToSendMessage');
}
