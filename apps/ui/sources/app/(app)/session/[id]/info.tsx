import React, { useCallback } from 'react';
import { View } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Typography } from '@/constants/Typography';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { ItemList } from '@/components/ui/lists/ItemList';
import { Avatar } from '@/components/ui/avatar/Avatar';
import { useSession, useIsDataReady, useSetting } from '@/sync/domains/state/storage';
import { getSessionName, useSessionStatus, formatPathRelativeToHome, getSessionAvatarId, type SessionStatus } from '@/utils/sessions/sessionUtils';
import { Modal } from '@/modal';
import { useUnistyles } from 'react-native-unistyles';
import { layout } from '@/components/ui/layout/layout';
import { t } from '@/text';
import type { Session } from '@/sync/domains/state/storageTypes';
import { useHappyAction } from '@/hooks/ui/useHappyAction';
import { useHydrateSessionForRoute } from '@/hooks/session/useHydrateSessionForRoute';
import {
    isSessionRouteHydrationAvailable,
    isSessionRouteHydrationMissing,
} from '@/sync/domains/session/sessionRouteHydrationState';
import { HappyError } from '@/utils/errors/errors';
import { resolveAgentIdFromSessionMetadata } from '@happier-dev/agents';
import { DEFAULT_AGENT_ID, resolveAgentIdFromFlavor } from '@/agents/catalog/catalog';
import { useFeatureEnabled } from '@/hooks/server/useFeatureEnabled';
import { Text } from '@/components/ui/text/Text';
import { StatusDot } from '@/components/ui/status/StatusDot';
import { resolveServerIdForSessionIdFromLocalCache } from '@/sync/runtime/orchestration/serverScopedRpc/resolveServerIdForSessionIdFromLocalCache';
import { usePreferredServerIdForSession } from '@/sync/runtime/orchestration/serverScopedRpc/usePreferredServerIdForSession';
import { SessionRetentionNotice } from '@/components/sessions/info/SessionRetentionNotice';
import { useSessionRouteServerScope, type SessionRouteServerScope } from '@/hooks/session/sessionRouteServerScope';
import { safeRouterBack } from '@/utils/navigation/safeRouterBack';
import { createSessionActionTarget } from '@/components/sessions/actions/sessionActionContext';
import { executeSessionAction } from '@/components/sessions/actions/sessionActionExecution';
import {
    SESSION_ACTION_ARCHIVE_ID,
    SESSION_ACTION_DELETE_ID,
    SESSION_ACTION_RENAME_ID,
    SESSION_ACTION_STOP_ID,
} from '@/components/sessions/actions/sessionActionIds';
import { listVisibleSessionActionIds } from '@/components/sessions/actions/sessionActionAvailability';
import { createSessionActionInfoItemProps } from '@/components/sessions/actions/sessionActionPresentation';
import { Icon } from '@/components/ui/icons/Icon';

function shallowEqualRecord(
    left: Readonly<Record<string, unknown>>,
    right: Readonly<Record<string, unknown>>,
): boolean {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) return false;
    for (const key of leftKeys) {
        if (!Object.prototype.hasOwnProperty.call(right, key)) return false;
        if (!Object.is(left[key], right[key])) return false;
    }
    return true;
}

function areSessionInfoStaticFieldsEqual(previous: Session, next: Session): boolean {
    if (previous === next) return true;
    const {
        updatedAt: _previousUpdatedAt,
        seq: _previousSeq,
        lastViewedSessionSeq: _previousLastViewedSessionSeq,
        activeAt: _previousActiveAt,
        latestReadyEventSeq: _previousLatestReadyEventSeq,
        latestReadyEventAt: _previousLatestReadyEventAt,
        pendingVersion: _previousPendingVersion,
        metadataVersion: _previousMetadataVersion,
        agentStateVersion: _previousAgentStateVersion,
        thinkingAt: _previousThinkingAt,
        ...previousStaticFields
    } = previous;
    const {
        updatedAt: _nextUpdatedAt,
        seq: _nextSeq,
        lastViewedSessionSeq: _nextLastViewedSessionSeq,
        activeAt: _nextActiveAt,
        latestReadyEventSeq: _nextLatestReadyEventSeq,
        latestReadyEventAt: _nextLatestReadyEventAt,
        pendingVersion: _nextPendingVersion,
        metadataVersion: _nextMetadataVersion,
        agentStateVersion: _nextAgentStateVersion,
        thinkingAt: _nextThinkingAt,
        ...nextStaticFields
    } = next;
    return shallowEqualRecord(previousStaticFields, nextStaticFields);
}

function useStableSessionInfoContentSession(session: Session | null): Session | null {
    return React.useMemo(() => session, [
        session?.id,
        session?.serverId,
        session?.encryptionMode,
        session?.createdAt,
        session?.active,
        session?.archivedAt,
        session?.pendingCount,
        session?.pendingPermissionRequestCount,
        session?.pendingUserActionRequestCount,
        session?.pendingRequestObservedAt,
        session?.latestTurnStatus,
        session?.latestTurnStatusObservedAt,
        session?.lastRuntimeIssue,
        session?.metadata,
        session?.agentState,
        session?.thinking,
        session?.presence,
        session?.optimisticThinkingAt,
        session?.thinkingGraceUntil,
        session?.todos,
        session?.permissionMode,
        session?.permissionModeUpdatedAt,
        session?.modelMode,
        session?.modelModeUpdatedAt,
        session?.owner,
        session?.ownerProfile,
        session?.accessLevel,
        session?.canApprovePermissions,
    ]);
}

function areSessionInfoContentPropsEqual(
    previous: Readonly<{
        session: Session;
        sessionServerId: string | null;
        routeScope: SessionRouteServerScope;
    }>,
    next: Readonly<{
        session: Session;
        sessionServerId: string | null;
        routeScope: SessionRouteServerScope;
    }>,
): boolean {
    return previous.sessionServerId === next.sessionServerId
        && previous.routeScope === next.routeScope
        && areSessionInfoStaticFieldsEqual(previous.session, next.session);
}

function SessionInfoVolatileDetailItems({
    sessionId,
    formatDate,
}: Readonly<{
    sessionId: string;
    formatDate: (timestamp: number) => string;
}>) {
    const { theme } = useUnistyles();
    const session = useSession(sessionId);
    if (!session) return null;

    return (
        <>
            <Item
                title={t('sessionInfo.lastUpdated')}
                subtitle={formatDate(session.updatedAt)}
                icon={<Icon name="clock" size={29} color={theme.colors.accent.blue} />}
                showChevron={false}
            />
        </>
    );
}

function SessionInfoActivityGroup({ sessionStatus }: Readonly<{ sessionStatus: SessionStatus }>) {
    return (
        <ItemGroup title={t('sessionInfo.activity')}>
            <Item
                title={t('sessionInfo.sessionStatus')}
                detail={sessionStatus.statusText}
                icon={<Icon name="pulse" size={29} color={sessionStatus.statusColor} />}
                showChevron={false}
            />
        </ItemGroup>
    );
}

function SessionInfoContent({ session, sessionServerId, routeScope }: Readonly<{
    session: Session;
    sessionServerId: string | null;
    routeScope: SessionRouteServerScope;
}>) {
    const { theme } = useUnistyles();
    const router = useRouter();
    const sessionName = getSessionName(session);
    const sessionStatus = useSessionStatus(session, {
        subscribeToSession: false,
        subscribeToTranscript: false,
    });
    const hideInactiveSessions = useSetting('hideInactiveSessions') === true;
    const sharedEntriesEnabled = useFeatureEnabled('sharing.sessionEntries', { scopeKind: 'spawn', serverId: sessionServerId });
    const agentId = resolveAgentIdFromSessionMetadata(session.metadata) ?? resolveAgentIdFromFlavor(session.metadata?.flavor) ?? DEFAULT_AGENT_ID;

    const handleExitAfterSessionMutation = useCallback(() => {
        safeRouterBack({
            router,
            fallbackHref: routeScope.buildHref(session.id),
        });
        safeRouterBack({
            router,
            fallbackHref: '/',
        });
    }, [routeScope, router, session.id]);

    const resolvedServerId = resolveServerIdForSessionIdFromLocalCache(session.id);
    const scopedMutationServerId = resolvedServerId ?? sessionServerId ?? routeScope.serverId ?? null;
    const sessionActionTarget = React.useMemo(
        () => createSessionActionTarget({
            session,
            serverId: scopedMutationServerId,
            currentUserId: !session.accessLevel && typeof session.owner === 'string' ? session.owner : null,
            isConnected: sessionStatus.isConnected,
        }),
        [scopedMutationServerId, session, sessionStatus.isConnected],
    );
    const canArchiveSession = sessionActionTarget.canArchive;
    const canDeleteSession = sessionActionTarget.canDelete;
    const visibleSessionActionIds = React.useMemo(
        () => new Set(listVisibleSessionActionIds({ target: sessionActionTarget, surface: 'sessionInfo' })),
        [sessionActionTarget],
    );
    const canRenameSession = visibleSessionActionIds.has(SESSION_ACTION_RENAME_ID);
    const stopInfoItemProps = React.useMemo(() => createSessionActionInfoItemProps({
        actionId: SESSION_ACTION_STOP_ID,
        iconColor: theme.colors.state.danger.foreground,
    }), [theme.colors.state.danger.foreground]);
    const archiveInfoItemProps = React.useMemo(() => createSessionActionInfoItemProps({
        actionId: SESSION_ACTION_ARCHIVE_ID,
        iconColor: theme.colors.state.danger.foreground,
    }), [theme.colors.state.danger.foreground]);
    const deleteInfoItemProps = React.useMemo(() => createSessionActionInfoItemProps({
        actionId: SESSION_ACTION_DELETE_ID,
        iconColor: theme.colors.state.danger.foreground,
    }), [theme.colors.state.danger.foreground]);

    const handleStopAndMaybeArchive = useCallback(async () => {
        await executeSessionAction({
            actionId: SESSION_ACTION_STOP_ID,
            target: sessionActionTarget,
            context: {
                hideInactiveSessions,
            },
        });
        handleExitAfterSessionMutation();
    }, [handleExitAfterSessionMutation, hideInactiveSessions, sessionActionTarget]);
    const [stoppingSession, performStop] = useHappyAction(handleStopAndMaybeArchive);

    const handleStopSession = useCallback(async () => {
        const confirmed = await Modal.confirm(
            t('sessionInfo.stopSession'),
            t('sessionInfo.stopSessionConfirm'),
            {
                cancelText: t('common.cancel'),
                confirmText: t('sessionInfo.stopSession'),
                destructive: true,
            },
        );
        if (!confirmed) return;
        await performStop();
    }, [performStop]);

    const handleArchive = useCallback(async () => {
        await executeSessionAction({
            actionId: SESSION_ACTION_ARCHIVE_ID,
            target: sessionActionTarget,
            context: {
                hideInactiveSessions,
            },
        });
        handleExitAfterSessionMutation();
    }, [handleExitAfterSessionMutation, hideInactiveSessions, sessionActionTarget]);
    const [archivingSession, performArchive] = useHappyAction(handleArchive);

    const handleArchiveSession = useCallback(async () => {
        const confirmed = await Modal.confirm(
            t('sessionInfo.archiveSession'),
            t('sessionInfo.archiveSessionConfirm'),
            {
                cancelText: t('common.cancel'),
                confirmText: t('sessionInfo.archiveSession'),
                destructive: true,
            },
        );
        if (!confirmed) return;
        await performArchive();
    }, [performArchive]);

    // Use HappyAction for deletion - it handles errors automatically
    const [, performDelete] = useHappyAction(async () => {
        await executeSessionAction({
            actionId: SESSION_ACTION_DELETE_ID,
            target: sessionActionTarget,
        });
        handleExitAfterSessionMutation();
    });

    const handleDeleteSession = useCallback(() => {
        Modal.alert(
            t('sessionInfo.deleteSession'),
            t('sessionInfo.deleteSessionWarning'),
            [
                { text: t('common.cancel'), style: 'cancel' },
                {
                    text: t('sessionInfo.deleteSession'),
                    style: 'destructive',
                    onPress: performDelete
                }
            ]
        );
    }, [performDelete]);

    const handleRenameSession = useCallback(async () => {
        if (!canRenameSession) return;
        const newName = await Modal.prompt(
            t('sessionInfo.renameSession'),
            t('sessionInfo.renameSessionSubtitle'),
            {
                defaultValue: sessionName,
                placeholder: t('sessionInfo.renameSessionPlaceholder'),
                confirmText: t('common.save'),
                cancelText: t('common.cancel')
            }
        );

        if (!newName?.trim()) return;
        try {
            await executeSessionAction({
                actionId: SESSION_ACTION_RENAME_ID,
                target: sessionActionTarget,
                input: { title: newName },
            });
        } catch (error) {
            if (error instanceof HappyError) {
                Modal.alert(t('common.error'), error.message);
            } else {
                Modal.alert(t('common.error'), t('errors.unknownError'));
            }
        }
    }, [canRenameSession, sessionActionTarget, sessionName]);

    const formatDate = useCallback((timestamp: number) => {
        return new Date(timestamp).toLocaleString();
    }, []);

    return (
        <>
            <ItemList>
                {/* Session Header */}
                <View style={{ maxWidth: layout.maxWidth, alignSelf: 'center', width: '100%' }}>
                    <View style={{ alignItems: 'center', paddingVertical: 24, backgroundColor: theme.colors.surface.base, marginBottom: 8, borderRadius: 12, marginHorizontal: 16, marginTop: 16 }}>
                        <Avatar id={getSessionAvatarId(session)} size={80} monochrome={!sessionStatus.isConnected} flavor={agentId} />
                        <Text style={{
                            fontSize: 20,
                            fontWeight: '600',
                            marginTop: 12,
                            textAlign: 'center',
                            color: theme.colors.text.primary,
                            ...Typography.default('semiBold')
                        }}>
                            {sessionName}
                        </Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
                            <StatusDot
                                color={sessionStatus.statusDotColor}
                                isPulsing={sessionStatus.isPulsing}
                                size={10}
                                style={{ marginRight: 4 }}
                            />
                            <Text style={{
                                fontSize: 15,
                                color: sessionStatus.statusColor,
                                fontWeight: '500',
                                ...Typography.default()
                            }}>
                                {sessionStatus.statusText}
                            </Text>
                        </View>
                    </View>
                </View>

                <SessionRetentionNotice sessionId={session.id} />

                {/* Session Details */}
                <ItemGroup>
                    <Item
                        title={t('sessionInfo.happySessionId')}
                        subtitle={`${session.id.substring(0, 8)}...${session.id.substring(session.id.length - 8)}`}
                        icon={<Icon name="fingerprint" size={29} color={theme.colors.accent.blue} />}
                        copy={session.id}
                    />
                    <Item
                        title={t('sessionInfo.connectionStatus')}
                        detail={sessionStatus.isConnected ? t('status.online') : t('status.offline')}
                        icon={<Icon name="pulse" size={29} color={sessionStatus.isConnected ? theme.colors.state.success.foreground : theme.colors.text.secondary} />}
                        showChevron={false}
                    />
                    <Item
                        title={t('sessionInfo.created')}
                        subtitle={formatDate(session.createdAt)}
                        icon={<Icon name="calendar" size={29} color={theme.colors.accent.blue} />}
                        showChevron={false}
                    />
                    <SessionInfoVolatileDetailItems sessionId={session.id} formatDate={formatDate} />
                </ItemGroup>

                {/* Quick Actions */}
                <ItemGroup title={t('sessionInfo.quickActions')}>
                    {canRenameSession && (
                        <Item
                            title={t('sessionInfo.renameSession')}
                            subtitle={t('sessionInfo.renameSessionSubtitle')}
                            icon={<Icon name="pencil" size={29} color={theme.colors.accent.blue} />}
                            onPress={handleRenameSession}
                        />
                    )}
                    {!session.accessLevel && !session.metadata?.sharedSessionEntryId && sharedEntriesEnabled && (
                        <Item
                            testID="session-shared-entry-management"
                            title={t('sharedEntry.title')}
                            subtitle={t('sharedEntry.description')}
                            icon={<Icon name="users" size={29} color={theme.colors.accent.blue} />}
                            onPress={() => router.push(routeScope.buildHref(session.id, { suffix: '/entry-sharing' }))}
                        />
                    )}
                    {visibleSessionActionIds.has(SESSION_ACTION_STOP_ID) && stopInfoItemProps && (
                        <Item
                            {...stopInfoItemProps}
                            onPress={handleStopSession}
                            loading={stoppingSession}
                        />
                    )}
                    {canArchiveSession && archiveInfoItemProps && (
                        <Item
                            {...archiveInfoItemProps}
                            onPress={handleArchiveSession}
                            loading={archivingSession}
                        />
                    )}
                    {canDeleteSession && deleteInfoItemProps && (
                        <Item
                            {...deleteInfoItemProps}
                            onPress={handleDeleteSession}
                        />
                    )}
                </ItemGroup>

                {/* Metadata */}
                {session.metadata && (
                    <ItemGroup title={t('sessionInfo.metadata')}>
                        <Item
                            title={t('sessionInfo.host')}
                            subtitle={session.metadata.host}
                            icon={<Icon name="desktop" size={29} color={theme.colors.accent.indigo} />}
                            showChevron={false}
                        />
                        <Item
                            title={t('sessionInfo.path')}
                            subtitle={formatPathRelativeToHome(session.metadata.path, session.metadata.homeDir)}
                            icon={<Icon name="folder" size={29} color={theme.colors.accent.indigo} />}
                            showChevron={false}
                        />
                    </ItemGroup>
                )}

                <SessionInfoActivityGroup sessionStatus={sessionStatus} />
            </ItemList>
        </>
    );
}

const MemoizedSessionInfoContent = React.memo(SessionInfoContent, areSessionInfoContentPropsEqual);

export default () => {
    const { theme } = useUnistyles();
    const params = useLocalSearchParams<{ id: string; serverId?: string }>();
    const routeScope = useSessionRouteServerScope(params);
    const { id } = params;
    const sessionId = String(id ?? '').trim();
    const routeHydrationState = useHydrateSessionForRoute(
        sessionId,
        'SessionInfoRoute.ensureSessionVisible',
        routeScope.hydrationOptions,
    );
    const sessionHydrated = isSessionRouteHydrationAvailable(routeHydrationState);
    const sessionMissingAfterHydration = isSessionRouteHydrationMissing(routeHydrationState);
    const session = useSession(sessionId);
    const isDataReady = useIsDataReady();
    const sessionServerId = usePreferredServerIdForSession(sessionId);
    // Handle three states: loading, deleted, and exists.
    // If the session record is already present, fail open and render it even if global hydration
    // is still in progress; otherwise deep links can get stuck in a permanent spinner state.
    const contentSession = useStableSessionInfoContentSession(session);

    if (!session && (!isDataReady || !sessionHydrated) && !sessionMissingAfterHydration) {
        // Still loading data
        return (
            <View testID="session-info-screen" style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="hourglass" size={48} color={theme.colors.text.secondary} />
                <Text style={{ color: theme.colors.text.secondary, fontSize: 17, marginTop: 16, ...Typography.default('semiBold') }}>{t('common.loading')}</Text>
            </View>
        );
    }

    if (!session) {
        // Session has been deleted or doesn't exist
        return (
            <View testID="session-info-screen" style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="trash" size={48} color={theme.colors.text.secondary} />
                <Text style={{ color: theme.colors.text.primary, fontSize: 20, marginTop: 16, ...Typography.default('semiBold') }}>{t('errors.sessionDeleted')}</Text>
                <Text style={{ color: theme.colors.text.secondary, fontSize: 15, marginTop: 8, textAlign: 'center', paddingHorizontal: 32, ...Typography.default() }}>{t('errors.sessionDeletedDescription')}</Text>
            </View>
        );
    }

    return (
        <View testID="session-info-screen" style={{ flex: 1 }}>
            <MemoizedSessionInfoContent
                session={contentSession ?? session}
                sessionServerId={sessionServerId}
                routeScope={routeScope}
            />
        </View>
    );
};
