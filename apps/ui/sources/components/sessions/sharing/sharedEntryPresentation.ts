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

export function sharedEntryMessageSendError(result: { errorCode?: string; errorMessage?: string }): string {
    if (result.errorCode === 'host_offline') return t('sharedEntry.hostOffline');
    if (result.errorCode === 'shared_session_access_revoked') return t('sharedEntry.accessDisabled');
    return result.errorMessage ?? t('errors.failedToSendMessage');
}
