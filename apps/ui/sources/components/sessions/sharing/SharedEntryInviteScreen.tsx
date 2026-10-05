import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Stack, useRouter } from 'expo-router';
import { ScrollView, useWindowDimensions, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Modal } from '@/modal';
import { Typography } from '@/constants/Typography';
import { Text } from '@/components/ui/text/Text';
import { BrandWordmark } from '@/components/onboarding/unauthShell/BrandWordmark';
import { RoundButton } from '@/components/ui/buttons/RoundButton';
import { ActivitySpinner } from '@/components/ui/feedback/ActivitySpinner';
import { PressableSurface } from '@/components/ui/interaction/PressableSurface';
import { useLayoutMaxWidth } from '@/components/ui/layout/layout';
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

const stylesheet = StyleSheet.create((theme) => ({
    screen: { flex: 1, backgroundColor: theme.colors.surface.base },
    scrollContent: { flexGrow: 1, alignItems: 'center', paddingHorizontal: theme.margins.xl, paddingVertical: theme.margins.xl },
    card: {
        width: '100%', gap: theme.margins.xl,
    },
    brand: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    hero: { paddingTop: theme.margins.xl },
    heroPhone: { paddingTop: theme.margins.md },
    publication: { gap: theme.margins.md },
    title: { ...Typography.rowTitle(), lineHeight: 24, color: theme.colors.text.primary },
    heading: { ...Typography.pageTitle(), color: theme.colors.text.primary },
    body: { ...Typography.body(), fontSize: 16, lineHeight: 24, color: theme.colors.text.secondary },
    bodyPhone: { lineHeight: 24 },
    detail: { ...Typography.rowMeta(), color: theme.colors.text.secondary },
    disclosure: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center', paddingHorizontal: theme.margins.sm, borderRadius: 8 },
    disclosureText: { ...Typography.rowMeta(), color: theme.colors.text.secondary },
    explanation: { gap: theme.margins.md },
    resources: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.margins.sm },
    resourcesText: { flex: 1, ...Typography.rowMeta(), color: theme.colors.text.secondary },
    conversation: { paddingVertical: theme.margins.xl, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border.default },
    status: { padding: theme.margins.lg, borderRadius: 12, backgroundColor: theme.colors.surface.inset, gap: theme.margins.sm },
    statusHeading: { flexDirection: 'row', gap: theme.margins.sm, alignItems: 'center' },
    statusTitle: { flex: 1, ...Typography.rowTitle(), color: theme.colors.text.primary },
    action: { minHeight: 52, borderRadius: 26, justifyContent: 'center' },
    exit: { minHeight: 44, paddingHorizontal: theme.margins.md, justifyContent: 'center' },
    exitText: { ...Typography.rowMeta(), color: theme.colors.text.secondary },
}));

function InvitePublication({ title, publisher }: { title: string; publisher?: string | null }) {
    const [expanded, setExpanded] = useState(false);
    // Imported chat titles can contain encoded spaces; keep all content as plain text.
    const displayTitle = title.replace(/&#(?:0*32|x0*20);|&nbsp;/gi, ' ');
    const collapsible = title.length > 80 || title.split(/\r?\n/).length > 3;
    return <View testID="shared-entry-publication" style={stylesheet.publication}>
        <View>
            <Text testID="shared-entry-title" selectable numberOfLines={collapsible && !expanded ? 2 : undefined} style={stylesheet.title}>{displayTitle}</Text>
            {collapsible ? <PressableSurface testID="shared-entry-title-toggle" style={stylesheet.disclosure}
                accessibilityLabel={t(expanded ? 'sharedEntry.inviteCollapseTitle' : 'sharedEntry.inviteExpandTitle')}
                accessibilityState={{ expanded }} onPress={() => setExpanded(value => !value)}>
                <Text style={stylesheet.disclosureText}>{t(expanded ? 'sharedEntry.inviteCollapseTitle' : 'sharedEntry.inviteExpandTitle')}</Text>
            </PressableSurface> : null}
        </View>
        {publisher ? <Text testID="shared-entry-publisher" style={stylesheet.detail}>{t('sharedEntry.publisher')}{' '}{publisher}</Text> : null}
    </View>;
}

export function SharedEntryInviteScreen({ token, serverUrl }: { token: string; serverUrl?: string }) {
    const auth = useAuth();
    const { theme } = useUnistyles();
    const { width } = useWindowDimensions();
    const isNarrow = width < 600;
    const maxWidth = Math.min(useLayoutMaxWidth(), 560);
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
        <ScrollView style={stylesheet.screen} contentContainerStyle={stylesheet.scrollContent}>
            <View testID="shared-entry-invite-card" style={[stylesheet.card, { maxWidth }]}>
                <View style={stylesheet.brand}>
                    <BrandWordmark height={28} />
                    {action?.testID !== 'shared-entry-home' ? <PressableSurface testID="shared-entry-exit" style={stylesheet.exit}
                        accessibilityLabel={t('common.home')} onPress={() => router.replace('/')}>
                        <Text style={stylesheet.exitText}>{t('common.home')}</Text>
                    </PressableSurface> : null}
                </View>
                {!invalidServer && token && (preview || visible?.loaded) ? <View style={[stylesheet.explanation, stylesheet.hero, isNarrow ? stylesheet.heroPhone : null]}>
                    <Text accessibilityRole="header" style={stylesheet.heading}>{t('sharedEntry.inviteTitle')}</Text>
                    <Text testID="shared-entry-purpose" style={[stylesheet.body, isNarrow ? stylesheet.bodyPhone : null]}>{t('sharedEntry.inviteContextDetail')}</Text>
                    {preview?.description?.trim() ? <Text testID="shared-entry-description" style={stylesheet.detail}>{preview.description}</Text> : null}
                    <View style={stylesheet.resources}>
                        <Ionicons name="folder-outline" size={18} color={theme.colors.text.secondary} />
                        <Text style={stylesheet.resourcesText}>{t('sharedEntry.inviteResourcesDetail')}</Text>
                    </View>
                </View> : null}
                {title ? <View style={stylesheet.conversation}><InvitePublication key={title} title={title} publisher={preview?.publisherDisplayName} /></View> : null}
                {status ? <View style={stylesheet.status} accessibilityLiveRegion="polite">
                    <View style={stylesheet.statusHeading}>
                        {status.loading ? <ActivitySpinner size="small" color={theme.colors.text.secondary} /> : null}
                        <Text testID={status.testID} style={stylesheet.statusTitle}>{status.title}</Text>
                    </View>
                    {status.detail ? <Text testID="shared-entry-state-detail" selectable style={stylesheet.detail}>{status.detail}</Text> : null}
                </View> : null}
                {action ? <RoundButton {...action} accessibilityLabel={action.title} size="normal" style={stylesheet.action}
                    disabled={busy || action.disabled === true} loading={busy || action.loading === true} /> : null}
                {access?.status === 'failed' && (recovery === 'restore' || recovery === 'repair-host') ? <PressableSurface
                    testID="shared-entry-preparation-retry" style={stylesheet.exit} accessibilityRole="button"
                    accessibilityLabel={t('common.retry')} disabled={busy} onPress={accept}>
                    <Text style={stylesheet.exitText}>{t('common.retry')}</Text>
                </PressableSurface> : null}
            </View>
        </ScrollView>
    </>;
}
