import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Stack, useRouter } from 'expo-router';
import { useAuth } from '@/auth/context/AuthContext';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { ItemList } from '@/components/ui/lists/ItemList';
import { t } from '@/text';
import { buildScopedSessionRouteHref } from '@/hooks/session/sessionRouteServerScope';
import { getActiveServerSnapshot } from '@/sync/domains/server/serverProfiles';
import { upsertActivateAndSwitchServer } from '@/sync/domains/server/activeServerSwitch';
import { canonicalizeServerUrl, createServerUrlComparableKey } from '@/sync/domains/server/url/serverUrlCanonical';
import { createSharedEntryClient, type SharedEntryAccess } from '@/sync/api/social/apiSharedEntries';
import { sharedEntryErrorMessage } from './sharedEntryPresentation';
import { useSharedEntryPolling } from './useSharedEntryPolling';

export function SharedEntryInviteScreen({ token, serverUrl }: { token: string; serverUrl?: string }) {
    const auth = useAuth();
    const router = useRouter();
    const [revision, setRevision] = useState(0);
    const snapshot = getActiveServerSnapshot();
    const client = useMemo(() => createSharedEntryClient(snapshot.serverId), [snapshot.serverId]);
    const [access, setAccess] = useState<SharedEntryAccess | null>(null);
    const [error, setError] = useState<unknown>(null);
    const [busy, setBusy] = useState(false);
    const inFlight = useRef(false);
    const mounted = useRef(true);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    const target = serverUrl ? canonicalizeServerUrl(serverUrl) : '';
    const invalidServer = Boolean(serverUrl && !target);
    const needsServerSwitch = Boolean(target && ![snapshot.serverUrl, snapshot.activeShareableServerUrl, snapshot.activeLocalRelayUrl]
        .some(url => url && createServerUrlComparableKey(url) === createServerUrlComparableKey(target)));
    const run = useCallback(async (operation: () => Promise<void>) => {
        if (inFlight.current) return;
        inFlight.current = true;
        setBusy(true);
        setError(null);
        try { await operation(); } catch (nextError) { if (mounted.current) setError(nextError); }
        finally { inFlight.current = false; if (mounted.current) setBusy(false); }
    }, []);
    const refresh = useCallback(async () => {
        if (!access) return;
        await run(async () => {
            const next = await client.access(access.entryId);
            if (mounted.current) setAccess(next);
        });
    }, [access?.entryId, client, run]);
    useSharedEntryPolling(refresh, Boolean(access && ['pending', 'provisioning'].includes(access.status) && !error));
    useEffect(() => {
        if (access?.status === 'ready' && access.sessionId) {
            router.replace(buildScopedSessionRouteHref({ sessionId: access.sessionId, serverId: snapshot.serverId }));
        }
    }, [access?.status, access?.sessionId, router, snapshot.serverId]);
    const accept = () => {
        if (!auth.isAuthenticated) {
            const returnTo = `/invite/${encodeURIComponent(token)}${target ? `?server=${encodeURIComponent(target)}` : ''}`;
            router.push({ pathname: '/', params: { returnTo } });
            return;
        }
        void run(async () => {
            const next = await client.redeem(token);
            if (mounted.current) setAccess(next);
        });
    };
    const preparing = access?.status === 'pending' || access?.status === 'provisioning';
    return <>
        <Stack.Screen options={{ title: t('sharedEntry.title') }} />
        <ItemList>
            <ItemGroup title={access?.title ?? t('sharedEntry.title')} footer={t('sharedEntry.description')}>
                {invalidServer || !token ? <Item title={t('sharedEntry.inviteInvalid')} showChevron={false} /> : needsServerSwitch ?
                    <Item testID="shared-entry-switch-server" title={t('sharedEntry.connectServer')} subtitle={target} disabled={busy} onPress={() => void run(async () => {
                        await upsertActivateAndSwitchServer({ serverUrl: target, source: 'url', scope: 'tab', refreshAuth: auth.refreshFromActiveServer });
                        if (mounted.current) setRevision(revision + 1);
                    })} /> : <>
                        {preparing ? <Item testID="shared-entry-preparing" title={t('sharedEntry.preparing')} subtitle={access?.hostOnline ? t('sharedEntry.preparingDetail') : t('sharedEntry.hostOffline')} showChevron={false} /> : null}
                        {access?.status === 'revoked' ? <Item title={t('sharedEntry.accessDisabled')} showChevron={false} /> : null}
                        {access?.status === 'failed' ? <Item title={t('sharedEntry.preparationFailed')} showChevron={false} /> : null}
                        {!preparing && access?.status !== 'revoked' && access?.status !== 'ready' ? <Item testID="shared-entry-accept" title={busy ? t('common.loading') : auth.isAuthenticated ? (access ? t('common.retry') : t('sharedEntry.accept')) : t('sharedEntry.signIn')} disabled={busy} onPress={accept} /> : null}
                        {preparing ? <Item testID="shared-entry-refresh" title={t('sharedEntry.refresh')} disabled={busy} onPress={() => void refresh()} /> : null}
                    </>}
                {error ? <Item testID="shared-entry-error" title={sharedEntryErrorMessage(error)} showChevron={false} /> : null}
            </ItemGroup>
        </ItemList>
    </>;
}
