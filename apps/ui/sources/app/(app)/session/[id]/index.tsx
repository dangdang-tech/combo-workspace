import * as React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { Platform, View } from 'react-native';
import { SessionView } from '@/components/sessions/shell/SessionView';
import { SessionInvalidLinkFallback } from '@/components/sessions/shell/SessionInvalidLinkFallback';
import { TranscriptSameSessionHandoffProvider } from '@/components/sessions/transcript/viewport/lifecycle/transcriptSameSessionHandoff';
import type { AttachmentDraft } from '@/components/sessions/attachments/attachmentDraftModel';
import { selectSessionViewShellSessionForRouteState } from '@/components/sessions/shell/sessionViewStableSession';
import { getTempData } from '@/utils/sessions/tempDataStore';
import { resolveSessionRouteAuthRecoveryState } from '@/hooks/session/sessionRouteAuthRecovery';
import { useSessionRouteServerScope } from '@/hooks/session/sessionRouteServerScope';
import { useHydrateSessionForRoute } from '@/hooks/session/useHydrateSessionForRoute';
import { useActiveServerSnapshot } from '@/hooks/server/useActiveServerSnapshot';
import { markSessionRouteEnteredForSessionUiTelemetry } from '@/sync/runtime/performance/sessionUiTelemetry';
import {
    isSessionRouteHydrationPending,
} from '@/sync/domains/session/sessionRouteHydrationState';
import {
    storage,
    useEndpointConnectivity,
    useSyncError,
} from '@/sync/domains/state/storage';
import { ActivitySpinner } from '@/components/ui/feedback/ActivitySpinner';

export default React.memo(() => {
    const params = useLocalSearchParams<{
        id?: string | string[];
        serverId?: string | string[];
        jumpSeq?: string | string[];
        recoveryDataId?: string | string[];
    }>();
    const routeScope = useSessionRouteServerScope(params as Record<string, unknown>);
    const {
        id: sessionIdParam,
        jumpSeq: jumpSeqParam,
        recoveryDataId: recoveryDataIdParam,
    } = params;
    const sessionId =
        (typeof sessionIdParam === 'string'
            ? sessionIdParam
            : Array.isArray(sessionIdParam)
                ? (sessionIdParam[0] ?? '')
                : '').trim();
    const jumpSeqRaw = typeof jumpSeqParam === 'string'
        ? jumpSeqParam
        : Array.isArray(jumpSeqParam)
            ? (jumpSeqParam[0] ?? null)
            : null;
    const jumpSeqTrimmed = typeof jumpSeqRaw === 'string' ? jumpSeqRaw.trim() : '';
    const jumpSeqNum = jumpSeqTrimmed.length > 0 ? Number(jumpSeqTrimmed) : NaN;
    const jumpToSeq = Number.isFinite(jumpSeqNum) && jumpSeqNum >= 0 ? Math.trunc(jumpSeqNum) : null;
    const recoveryDataId = typeof recoveryDataIdParam === 'string'
        ? recoveryDataIdParam
        : Array.isArray(recoveryDataIdParam)
            ? (recoveryDataIdParam[0] ?? '')
            : '';
    const recoverableAttachmentDrafts = React.useMemo(() => {
        const trimmedRecoveryDataId = recoveryDataId.trim();
        if (!trimmedRecoveryDataId) {
            return null;
        }

        const data = getTempData<{ attachmentDrafts?: readonly AttachmentDraft[] | null }>(trimmedRecoveryDataId);
        return Array.isArray(data?.attachmentDrafts) ? data.attachmentDrafts : null;
    }, [recoveryDataId]);
    const endpointConnectivity = useEndpointConnectivity();
    const syncError = useSyncError();
    const activeServerSnapshot = useActiveServerSnapshot();
    const activeServerGeneration = activeServerSnapshot.generation;

    React.useLayoutEffect(() => {
        markSessionRouteEnteredForSessionUiTelemetry({ sessionId });
    }, [sessionId]);

    const routeHydrationState = useHydrateSessionForRoute(
        sessionId,
        `SessionRoute.ensureSessionVisible gen=${activeServerGeneration}`,
        routeScope.hydrationOptions,
    );
    const sessionCached = storage((state) => {
        return Boolean(selectSessionViewShellSessionForRouteState(
            {
                sessions: state.sessions,
                sessionListViewDataByServerId: state.sessionListViewDataByServerId,
            },
            sessionId,
            routeHydrationState.serverId ?? routeScope.serverId ?? null,
        ));
    });
    const authRecoveryState = React.useMemo(() => {
        return resolveSessionRouteAuthRecoveryState({
            routeParams: params as Record<string, string | string[] | undefined>,
            activeServerId: activeServerSnapshot.serverId,
            endpointStatus: endpointConnectivity.status,
            syncError,
        });
    }, [activeServerSnapshot.serverId, endpointConnectivity.status, params, syncError]);
    const authRecoveryActive = Boolean(authRecoveryState.authSurfaceState);

    if (!sessionId) {
        return <SessionInvalidLinkFallback />;
    }

    if (isSessionRouteHydrationPending(routeHydrationState) && !sessionCached && !authRecoveryActive) {
        return (
            <View testID="session-route-loading" style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                <ActivitySpinner size="small" />
            </View>
        );
    }

    return (
        <TranscriptSameSessionHandoffProvider desiredExperience="classic" sessionId={sessionId}>
            {() => (
                <SessionView
                    id={sessionId}
                    routeServerId={routeScope.serverId ?? undefined}
                    jumpToSeq={jumpToSeq}
                    initialAttachmentDrafts={recoverableAttachmentDrafts}
                    routeAnchorOverride={Platform.OS === 'web' ? undefined : true}
                    routeHydrationState={routeHydrationState}
                />
            )}
        </TranscriptSameSessionHandoffProvider>
    );
});
