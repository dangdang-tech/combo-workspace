import { describe, expect, it, vi } from 'vitest';
import { SharedEntryError } from '@/sync/api/social/apiSharedEntries';
import { sharedEntryErrorMessage } from './sharedEntryPresentation';

vi.mock('@/text', () => ({ t: (key: string) => key }));

describe('shared entry context failures', () => {
    it.each([
        ['context_snapshot_required', 'sharedEntry.contextSnapshotRequired'],
        ['context_snapshot_too_large', 'sharedEntry.contextSnapshotTooLarge'],
        ['context_snapshot_unavailable', 'sharedEntry.contextSnapshotUnavailable'],
    ])('explains %s without exposing server details', (code, message) => {
        expect(sharedEntryErrorMessage(new SharedEntryError(code, 409))).toBe(message);
    });

    it('does not display an unrecognized server or transport error', () => {
        expect(sharedEntryErrorMessage(new SharedEntryError('private-server-detail', 500))).toBe('errors.operationFailed');
        expect(sharedEntryErrorMessage(new Error('private-transport-detail'))).toBe('errors.operationFailed');
    });
});
