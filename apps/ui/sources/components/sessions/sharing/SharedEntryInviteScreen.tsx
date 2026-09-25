import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Stack, useRouter } from 'expo-router';
import { createExternalProviderAuthActions } from '@/auth/flows/createExternalProviderAuthActions';
import { getServerFeaturesSnapshot } from '@/sync/api/capabilities/serverFeaturesClient';
import { resolveRemoteAuthCapabilityOptions } from '@/components/account/auth/useRemoteAuthEntryOptions';
import { useAuth } from '@/auth/context/AuthContext';
import { withAuthReturnTo } from '@/auth/routing/resolveAuthReturnToRoute';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { ItemList } from '@/components/ui/lists/ItemList';
import { t } from '@/text';
import { buildScopedSessionRouteHref } from '@/hooks/session/sessionRouteServerScope';
import { getActiveServerSnapshot } from '@/sync/domains/server/serverProfiles';
import { upsertActivateAndSwitchServer } from '@/sync/domains/server/activeServerSwitch';
import { canonicalizeServerUrl, createServerUrlComparableKey } from '@/sync/domains/server/url/serverUrlCanonical';
import { createSharedEntryClient, SharedEntryError, type SharedEntryAccess, type SharedEntryPreview } from '@/sync/api/social/apiSharedEntries';
import { sharedEntryInviteErrorMessage, sharedEntryInviteRecovery } from './sharedEntryPresentation';
import { useSharedEntryPolling } from './useSharedEntryPolling';

export function SharedEntryInviteScreen({ token, serverUrl }: { token: string; serverUrl?: string }) {
    const auth = useAuth();
    const router = useRouter();
    const [, setRevision] = useState(0);
    const snapshot = getActiveServerSnapshot();
    const client = useMemo(() => createSharedEntryClient(snapshot.serverId), [snapshot.serverId]);
    const scope = useMemo(() => ({ serverId: snapshot.serverId, serverUrl: snapshot.serverUrl, generation: snapshot.generation, token, requestedServer: serverUrl, authenticated: auth.isAuthenticated, credentialToken: auth.credentials?.token }),
        [snapshot.serverId, snapshot.serverUrl, snapshot.generation, token, serverUrl, auth.isAuthenticated, auth.credentials?.token]);
    const currentScope = useRef(scope);
    currentScope.current = scope;
    const [state, setState] = useState<{ scope: typeof scope; preview: SharedEntryPreview | null; access: SharedEntryAccess | null; error: unknown; loaded: boolean }>({ scope, preview: null, access: null, error: null, loaded: false });
    const visible = state.scope === scope ? state : null;
    const access = visible?.access ?? null;
    const preview = visible?.preview ?? null;
    const error = visible?.error ?? null;
    const [busyScope, setBusyScope] = useState<typeof scope | null>(null);
    const busy = busyScope === scope;
    const inFlight = useRef<typeof scope | null>(null);
    const mounted = useRef(true);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    const isCurrent = useCallback(() => {
        const active = getActiveServerSnapshot();
        return mounted.current && currentScope.current === scope
            && active.serverId === scope.serverId && active.serverUrl === scope.serverUrl && active.generation === scope.generation;
    }, [scope]);
    const target = serverUrl ? canonicalizeServerUrl(serverUrl) : '';
    const invalidServer = Boolean(serverUrl && !target);
    const returnTo = `/invite/${encodeURIComponent(token)}${target ? `?server=${encodeURIComponent(target)}` : ''}`;
    const needsServerSwitch = Boolean(target && ![snapshot.serverUrl, snapshot.activeShareableServerUrl, snapshot.activeLocalRelayUrl]
        .some(url => url && createServerUrlComparableKey(url) === createServerUrlComparableKey(target)));
    const run = useCallback(async (operation: () => Promise<void>) => {
        if (inFlight.current === scope || !isCurrent()) return;
        inFlight.current = scope;
        setBusyScope(scope);
        setState((previous) => previous.scope === scope ? { ...previous, error: null } : { scope, preview: null, access: null, error: null, loaded: false });
        try { await operation(); } catch (nextError) {
            if (isCurrent()) setState((previous) => ({ ...previous, scope, error: nextError }));
        } finally {
            if (inFlight.current === scope) inFlight.current = null;
            if (isCurrent()) setBusyScope(null);
        }
    }, [scope, isCurrent]);
    const loadPreview = useCallback(() => run(async () => {
        try {
            const next = await client.preview(token);
            if (isCurrent()) setState({ scope, preview: next.preview, access: auth.isAuthenticated ? next.access : null, error: null, loaded: true });
        } catch (error) {
            // Pre-preview servers still support the existing explicit redemption flow.
            // A missing invite is a different refusal and must never use this fallback.
            if (!(error instanceof SharedEntryError) || error.status !== 404 || !['Not Found', 'not_found'].includes(error.code)) throw error;
            if (isCurrent()) setState({ scope, preview: null, access: null, error: null, loaded: true });
        }
    }), [client, token, auth.isAuthenticated, scope, run, isCurrent]);
    useEffect(() => {
        if (!invalidServer && token && !needsServerSwitch) void loadPreview();
    }, [invalidServer, token, needsServerSwitch, loadPreview]);
    const refresh = useCallback(async () => {
        if (!access) return;
        await run(async () => {
            const next = await client.access(access.entryId);
            if (isCurrent()) setState((previous) => ({ ...previous, access: next }));
        });
    }, [access?.entryId, client, run, isCurrent]);
    useSharedEntryPolling(refresh, Boolean(access && ['pending', 'provisioning'].includes(access.status) && !error));
    useEffect(() => {
        if (isCurrent() && access?.status === 'ready' && access.sessionId) {
            router.replace(buildScopedSessionRouteHref({ sessionId: access.sessionId, serverId: scope.serverId }));
        }
    }, [access?.status, access?.sessionId, router, scope, isCurrent]);
    const accept = () => {
        if (!auth.isAuthenticated) {
            void run(async () => {
                const features = await getServerFeaturesSnapshot();
                if (!isCurrent()) return;
                if (features.status === 'error') throw new SharedEntryError('operation_failed', 503);
                if (features.status !== 'ready') throw new SharedEntryError('google_auth_unavailable', 503);
                const options = resolveRemoteAuthCapabilityOptions(features.features);
                const actions = createExternalProviderAuthActions({ returnTo });
                if (options.signupOptions.providerIds.includes('google')) {
                    await actions.createAccountViaProvider('google');
                } else if (options.loginOptions.keylessProviderIds.includes('google')) {
                    await actions.loginWithKeylessProvider('google');
                } else {
                    throw new SharedEntryError('google_auth_unavailable', 409);
                }
            });
            return;
        }
        void run(async () => {
            const next = await client.redeem(token);
            if (isCurrent()) setState((previous) => ({ ...previous, access: next }));
        });
    };
    const preparing = access?.status === 'pending' || access?.status === 'provisioning';
    const preparationError = access?.status === 'failed' && access.errorCode
        ? new SharedEntryError(access.errorCode, 409)
        : null;
    const recovery = sharedEntryInviteRecovery(error ?? preparationError);
    const canRetry = recovery === 'retry';
    const stepTitle = access?.status === 'ready' ? t('sharedEntry.inviteStepOpen')
        : auth.isAuthenticated && !needsServerSwitch ? t('sharedEntry.inviteStepPrepare')
        : t('sharedEntry.inviteStepSignIn');
    return <>
        <Stack.Screen options={{ title: preview?.title ?? t('sharedEntry.title') }} />
        <ItemList>
            <ItemGroup title={preview ? undefined : access?.title ?? t('sharedEntry.title')} footer={t('sharedEntry.description')}>
                {preview ? <Item testID="shared-entry-publication" title={preview.title} titleLines={0} subtitle={preview.description ?? undefined} subtitleLines={0} showChevron={false} /> : null}
                {preview?.publisherDisplayName ? <Item testID="shared-entry-publisher" title={t('sharedEntry.publisher')} subtitle={preview.publisherDisplayName} showChevron={false} /> : null}
                <Item testID="shared-entry-progress" title={stepTitle} subtitle={t('sharedEntry.inviteSteps')} showChevron={false} />
                {invalidServer || !token ? <Item title={t('sharedEntry.inviteInvalid')} showChevron={false} /> : needsServerSwitch ?
                    <Item testID="shared-entry-switch-server" title={t('sharedEntry.connectServer')} subtitle={target} disabled={busy} onPress={() => void run(async () => {
                        await upsertActivateAndSwitchServer({ serverUrl: target, source: 'url', scope: 'tab', refreshAuth: auth.refreshFromActiveServer });
                        if (mounted.current) setRevision((value) => value + 1);
                    })} /> : <>
                        {preparing && canRetry ? <Item testID="shared-entry-preparing" title={t('sharedEntry.preparing')} subtitle={access?.hostOnline ? t('sharedEntry.preparingDetail') : t('sharedEntry.inviteHostOfflineWaiting')} showChevron={false} /> : null}
                        {access?.status === 'revoked' ? <Item title={t('sharedEntry.accessDisabled')} showChevron={false} /> : null}
                        {access?.status === 'failed' ? <Item testID="shared-entry-preparation-failed" title={preparationError ? sharedEntryInviteErrorMessage(preparationError) : t('sharedEntry.preparationFailed')} showChevron={false} /> : null}
                        {visible?.loaded && !preparing && canRetry && access?.status !== 'revoked' && access?.status !== 'ready' ? <Item testID="shared-entry-accept" title={busy ? t('common.loading') : auth.isAuthenticated ? (access || error ? t('common.retry') : t('sharedEntry.prepareCopy')) : t('sharedEntry.signIn')} disabled={busy} onPress={accept} /> : null}
                        {!visible?.loaded && !error ? <Item title={t('common.loading')} showChevron={false} /> : null}
                        {!visible?.loaded && error && canRetry ? <Item testID="shared-entry-preview-retry" title={t('common.retry')} disabled={busy} onPress={() => void loadPreview()} /> : null}
                        {preparing && canRetry ? <Item testID="shared-entry-refresh" title={t('sharedEntry.refresh')} disabled={busy} onPress={() => void refresh()} /> : null}
                        {recovery === 'account' || recovery === 'restore' ? <Item
                            testID="shared-entry-recover"
                            title={recovery === 'account' ? t('sharedEntry.linkGoogle') : t('sharedEntry.restoreKeys')}
                            disabled={busy}
                            onPress={() => router.push(withAuthReturnTo(recovery === 'account' ? '/settings/account' : '/restore', returnTo))}
                        /> : null}
                    </>}
                {error ? <Item testID="shared-entry-error" title={sharedEntryInviteErrorMessage(error)} showChevron={false} /> : null}
            </ItemGroup>
        </ItemList>
    </>;
}
