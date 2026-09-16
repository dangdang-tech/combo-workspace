import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createSharedEntryClient } from '@/sync/api/social/apiSharedEntries';
import { sharedEntryErrorMessage } from '@/components/sessions/sharing/sharedEntryPresentation';
import { useSharedEntryPolling } from '@/components/sessions/sharing/useSharedEntryPolling';
import { t } from '@/text';

type AccessState = { sessionId: string; serverId: string | null; blocked: boolean; message: string | null };

/** Availability is refreshed independently of the draft. Becoming online never sends it. */
export function useSharedSessionSendAccess(sessionId: string, serverId: string | null, enabled: boolean) {
    const client = useMemo(() => createSharedEntryClient(serverId), [serverId]);
    const [state, setState] = useState<AccessState | null>(null);
    const generation = useRef(0);
    const inFlight = useRef<Promise<boolean> | null>(null);
    const refresh = useCallback((): Promise<boolean> => {
        if (!enabled) return Promise.resolve(true);
        if (inFlight.current) return inFlight.current;
        const requestGeneration = generation.current;
        const request = (async () => {
            try {
                const access = await client.sessionAccess(sessionId);
                if (requestGeneration !== generation.current) return false;
                const allowed = access?.status === 'ready' && access.hostOnline;
                const message = allowed ? null : access?.status === 'revoked' ? t('sharedEntry.accessDisabled')
                    : access && !access.hostOnline ? t('sharedEntry.hostOffline') : t('sharedEntry.checking');
                setState(previous => previous?.sessionId === sessionId && previous.serverId === serverId && previous.blocked === !allowed && previous.message === message
                    ? previous : { sessionId, serverId, blocked: !allowed, message });
                return Boolean(allowed);
            } catch (error) {
                if (requestGeneration === generation.current) setState({ sessionId, serverId, blocked: true, message: sharedEntryErrorMessage(error) });
                return false;
            } finally {
                if (requestGeneration === generation.current) inFlight.current = null;
            }
        })();
        inFlight.current = request;
        return request;
    }, [client, enabled, serverId, sessionId]);
    useEffect(() => {
        generation.current += 1;
        inFlight.current = null;
        if (enabled) void refresh();
        return () => { generation.current += 1; inFlight.current = null; };
    }, [enabled, refresh]);
    useSharedEntryPolling(refresh, enabled);
    const current = state?.sessionId === sessionId && state.serverId === serverId ? state : null;
    return { blocked: enabled && (current?.blocked ?? true), message: enabled ? (current?.message ?? t('sharedEntry.checking')) : null, refresh };
}
