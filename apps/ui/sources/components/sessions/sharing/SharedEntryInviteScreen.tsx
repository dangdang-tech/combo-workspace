import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Stack, useRouter } from 'expo-router';
import { Modal } from '@/modal';
import { RoundButton } from '@/components/ui/buttons/RoundButton';
import { createExternalProviderAuthActions } from '@/auth/flows/createExternalProviderAuthActions';
import { getServerFeaturesSnapshot } from '@/sync/api/capabilities/serverFeaturesClient';
import { resolveRemoteAuthCapabilityOptions } from '@/components/account/auth/useRemoteAuthEntryOptions';
import { useAuth } from '@/auth/context/AuthContext';
import { withAuthReturnTo } from '@/auth/routing/resolveAuthReturnToRoute';
import { t } from '@/text';
import { buildScopedSessionRouteHref } from '@/hooks/session/sessionRouteServerScope';
import { getActiveServerSnapshot } from '@/sync/domains/server/serverProfiles';
import { upsertActivateAndSwitchServer } from '@/sync/domains/server/activeServerSwitch';
import { canonicalizeServerUrl, createServerUrlComparableKey } from '@/sync/domains/server/url/serverUrlCanonical';
import { createSharedEntryClient, SharedEntryError, type SharedEntryAccess, type SharedEntryPreview } from '@/sync/api/social/apiSharedEntries';
import { sharedEntryInviteErrorMessage, sharedEntryInviteRecovery } from './sharedEntryPresentation';
import { useSharedEntryPolling } from './useSharedEntryPolling';
import { SharedEntryInviteSurface } from './SharedEntryInviteSurface';

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
    const run = useCallback(async (operation: () => Promise<void>, reportFailure = false) => {
        if (inFlight.current === scope || !isCurrent()) return;
        inFlight.current = scope;
        setBusyScope(scope);
        setState((previous) => previous.scope === scope ? { ...previous, error: null } : { scope, preview: null, access: null, error: null, loaded: false });
        try { await operation(); } catch (nextError) {
            if (isCurrent()) {
                setState((previous) => ({ ...previous, scope, error: nextError }));
                if (reportFailure) Modal.alert(t('common.error'), sharedEntryInviteErrorMessage(nextError));
            }
        } finally {
            if (inFlight.current === scope) inFlight.current = null;
            if (isCurrent()) setBusyScope(null);
        }
    }, [scope, isCurrent]);
    const loadPreview = useCallback((reportFailure = false) => run(async () => {
        try {
            const next = await client.preview(token);
            if (isCurrent()) setState({ scope, preview: next.preview, access: auth.isAuthenticated ? next.access : null, error: null, loaded: true });
        } catch (error) {
            // Pre-preview servers still support the existing explicit redemption flow.
            // A missing invite is a different refusal and must never use this fallback.
            if (!(error instanceof SharedEntryError) || error.status !== 404 || !['Not Found', 'not_found'].includes(error.code)) throw error;
            if (isCurrent()) setState({ scope, preview: null, access: null, error: null, loaded: true });
        }
    }, reportFailure), [client, token, auth.isAuthenticated, scope, run, isCurrent]);
    useEffect(() => {
        if (!invalidServer && token && !needsServerSwitch) void loadPreview();
    }, [invalidServer, token, needsServerSwitch, loadPreview]);
    const refresh = useCallback(async (reportFailure = false) => {
        if (!access) return;
        await run(async () => {
            const next = await client.access(access.entryId);
            if (isCurrent()) setState((previous) => ({ ...previous, access: next }));
        }, reportFailure);
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
            }, true);
            return;
        }
        void run(async () => {
            const next = await client.redeem(token);
            if (isCurrent()) {
                setState((previous) => ({ ...previous, access: next }));
                if (next.status === 'failed') Modal.alert(t('common.error'), next.errorCode
                    ? sharedEntryInviteErrorMessage(new SharedEntryError(next.errorCode, 409)) : t('sharedEntry.preparationFailed'));
            }
        }, true);
    };
    const preparing = access?.status === 'pending' || access?.status === 'provisioning';
    const preparationError = access?.status === 'failed' && access.errorCode
        ? new SharedEntryError(access.errorCode, 409)
        : null;
    const recovery = sharedEntryInviteRecovery(error ?? preparationError);
    const canRetry = recovery === 'retry';
    const title = preview?.title ?? access?.title;
    const status: { testID: string; title: string; detail?: string; loading?: boolean } | null = invalidServer || !token
        ? { testID: 'shared-entry-invalid', title: t('sharedEntry.inviteInvalid') }
        : error ? { testID: 'shared-entry-error', title: sharedEntryInviteErrorMessage(error) }
        : needsServerSwitch ? { testID: 'shared-entry-server', title: t('sharedEntry.connectServer'), detail: target }
        : access?.status === 'revoked' ? { testID: 'shared-entry-revoked', title: t('sharedEntry.accessDisabled') }
        : access?.status === 'failed' ? { testID: 'shared-entry-preparation-failed', title: preparationError ? sharedEntryInviteErrorMessage(preparationError) : t('sharedEntry.preparationFailed') }
        : preparing ? { testID: 'shared-entry-preparing', title: t('sharedEntry.preparing'), detail: access?.hostOnline ? t('sharedEntry.preparingDetail') : t('sharedEntry.inviteHostOfflineWaiting'), loading: Boolean(access?.hostOnline) }
        : access?.status === 'ready' ? { testID: 'shared-entry-ready', title: t('sharedEntry.inviteOpening'), loading: true }
        : !visible?.loaded ? { testID: 'shared-entry-loading', title: t('sharedEntry.inviteLoading'), loading: true }
        : null;
    let action: React.ComponentProps<typeof RoundButton> | null = null;
    if (!invalidServer && token) {
        if (needsServerSwitch) {
            action = { testID: 'shared-entry-switch-server', title: t('sharedEntry.connectServer'), onPress: () => void run(async () => {
                await upsertActivateAndSwitchServer({ serverUrl: target, source: 'url', scope: 'tab', refreshAuth: auth.refreshFromActiveServer });
                if (mounted.current) setRevision((value) => value + 1);
            }, true) };
        } else if (recovery === 'account' || recovery === 'restore') {
            action = { testID: 'shared-entry-recover', title: recovery === 'account' ? t('sharedEntry.linkGoogle') : t('sharedEntry.restoreKeys'),
                onPress: () => router.push(withAuthReturnTo(recovery === 'account' ? '/settings/account' : '/restore', returnTo)) };
        } else if (!visible?.loaded && error && canRetry) {
            action = { testID: 'shared-entry-preview-retry', title: t('common.retry'), onPress: () => void loadPreview(true) };
        } else if (access?.status === 'ready') {
            action = { testID: 'shared-entry-open', title: t('sharedEntry.inviteOpening'), disabled: true, loading: true };
        } else if (preparing && canRetry) {
            action = { testID: 'shared-entry-refresh', title: t('sharedEntry.refresh'), onPress: () => void refresh(true) };
        } else if (visible?.loaded && canRetry && access?.status !== 'revoked') {
            action = { testID: 'shared-entry-accept', title: auth.isAuthenticated ? (access || error ? t('common.retry') : t('sharedEntry.startConversation')) : t('sharedEntry.signIn'), onPress: accept };
        }
    }
    if (!action && status && !status.loading) {
        action = { testID: 'shared-entry-home', title: t('common.home'), onPress: () => router.replace('/') };
    }
    return <>
        <Stack.Screen options={{ headerShown: false }} />
        <SharedEntryInviteSurface title={title} publisher={preview?.publisherDisplayName} description={preview?.description}
            showExplanation={!invalidServer && Boolean(token) && Boolean(preview || visible?.loaded)}
            status={status} action={action} busy={busy} onExit={() => router.replace('/')}
            onPreparationRetry={access?.status === 'failed' && (recovery === 'restore' || recovery === 'repair-host') ? accept : undefined} />
    </>;
}
