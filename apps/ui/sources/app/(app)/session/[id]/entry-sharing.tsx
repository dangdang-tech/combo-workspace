import { usePreferredServerIdForSession } from '@/sync/runtime/orchestration/serverScopedRpc/usePreferredServerIdForSession';
import React from 'react';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useSession } from '@/sync/domains/state/storage';
import { useSessionRouteServerScope } from '@/hooks/session/sessionRouteServerScope';
import { useHydrateSessionForRoute } from '@/hooks/session/useHydrateSessionForRoute';
import { useFeatureEnabled } from '@/hooks/server/useFeatureEnabled';
import { ItemList } from '@/components/ui/lists/ItemList';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { Item } from '@/components/ui/lists/Item';
import { SharedEntryManagement } from '@/components/sessions/sharing/SharedEntryManagement';
import { getSessionName } from '@/utils/sessions/sessionUtils';
import { t } from '@/text';

export default function SharedEntryManagementRoute() {
    const params = useLocalSearchParams<{ id: string; serverId?: string }>();
    const scope = useSessionRouteServerScope(params);
    const sessionId = String(params.id ?? '').trim();
    const session = useSession(sessionId);
    const preferredServerId = usePreferredServerIdForSession(sessionId);
    const serverId = scope.serverId ?? preferredServerId;
    useHydrateSessionForRoute(sessionId, 'SharedEntryManagementRoute', scope.hydrationOptions);
    const enabled = useFeatureEnabled('sharing.sessionEntries', { scopeKind: 'spawn', serverId: serverId ?? null });
    return <>
        <Stack.Screen options={{ title: t('sharedEntry.title') }} />
        <ItemList>
            {enabled && session && !session.accessLevel && !session.metadata?.sharedSessionEntryId ? <SharedEntryManagement key={`${serverId}:${sessionId}`} sourceSessionId={sessionId} machineId={session.metadata?.machineId ?? ''} title={getSessionName(session)} serverId={serverId ?? null} />
                : <ItemGroup><Item title={session?.accessLevel ? t('errors.permissionDenied') : t('sharedEntry.unavailable')} showChevron={false} /></ItemGroup>}
        </ItemList>
    </>;
}
