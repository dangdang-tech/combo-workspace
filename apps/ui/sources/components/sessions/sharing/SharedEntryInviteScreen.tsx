import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Stack, useRouter } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { iOSUIKit } from 'react-native-typography';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Modal } from '@/modal';
import { Typography } from '@/constants/Typography';
import { Text } from '@/components/ui/text/Text';
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
    scrollContent: { flexGrow: 1, alignItems: 'center', padding: theme.margins.lg },
    card: {
        width: '100%', padding: theme.margins.xl, gap: theme.margins.xl,
        backgroundColor: theme.colors.surface.base, borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.border.default, borderRadius: 16,
    },
    brand: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: theme.margins.md },
    brandName: { ...Typography.rowTitle(), color: theme.colors.text.primary },
    eyebrow: { ...Typography.rowMeta(), color: theme.colors.text.secondary },
    publication: { gap: theme.margins.md },
    title: { fontSize: iOSUIKit.title3Object.fontSize, lineHeight: iOSUIKit.title3Object.lineHeight, ...Typography.header(), color: theme.colors.text.primary },
    body: { fontSize: iOSUIKit.bodyObject.fontSize, lineHeight: iOSUIKit.bodyObject.lineHeight, ...Typography.body(), color: theme.colors.text.primary },
    detail: { ...Typography.rowMeta(), color: theme.colors.text.secondary },
    disclosure: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center', paddingHorizontal: theme.margins.sm, borderRadius: 8 },
    disclosureText: { ...Typography.rowMeta(), color: theme.colors.text.secondary },
    explanation: { gap: theme.margins.md },
    resources: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.margins.sm },
    resourcesText: { flex: 1, ...Typography.rowMeta(), color: theme.colors.text.secondary },
    progress: { flexDirection: 'row', gap: theme.margins.sm },
    step: { flex: 1, alignItems: 'center', gap: theme.margins.sm },
    stepNumber: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surface.inset },
    stepActive: { backgroundColor: theme.colors.button.primary.background },
    stepNumberText: { ...Typography.rowMeta(), color: theme.colors.text.secondary },
    stepNumberActive: { color: theme.colors.button.primary.tint },
    stepLabel: { ...Typography.rowMeta(), color: theme.colors.text.secondary, textAlign: 'center' },
    stepLabelActive: { ...Typography.default('semiBold'), color: theme.colors.text.primary },
    status: { padding: theme.margins.lg, borderRadius: 12, backgroundColor: theme.colors.surface.inset, gap: theme.margins.sm },
    statusHeading: { flexDirection: 'row', gap: theme.margins.sm, alignItems: 'center' },
    statusTitle: { flex: 1, ...Typography.rowTitle(), color: theme.colors.text.primary },
    action: { minHeight: 48, justifyContent: 'center' },
}));

function InvitePublication({ title, description, publisher }: { title: string; description?: string | null; publisher?: string | null }) {
    const [expanded, setExpanded] = useState(false);
    const collapsible = title.length > 80 || title.split(/\r?\n/).length > 3;
    return <View testID="shared-entry-publication" style={stylesheet.publication}>
        <View>
            <Text testID="shared-entry-title" accessibilityRole="header" selectable numberOfLines={collapsible && !expanded ? 3 : undefined} style={stylesheet.title}>{title}</Text>
            {collapsible ? <PressableSurface testID="shared-entry-title-toggle" style={stylesheet.disclosure}
                accessibilityLabel={t(expanded ? 'sharedEntry.inviteCollapseTitle' : 'sharedEntry.inviteExpandTitle')}
                accessibilityState={{ expanded }} onPress={() => setExpanded(value => !value)}>
                <Text style={stylesheet.disclosureText}>{t(expanded ? 'sharedEntry.inviteCollapseTitle' : 'sharedEntry.inviteExpandTitle')}</Text>
            </PressableSurface> : null}
        </View>
        {description?.trim() ? <Text testID="shared-entry-description" style={stylesheet.body}>{description}</Text> : null}
        {publisher ? <Text testID="shared-entry-publisher" style={stylesheet.detail}>{t('sharedEntry.publisher')}{' '}{publisher}</Text> : null}
    </View>;
}

export function SharedEntryInviteScreen({ token, serverUrl }: { token: string; serverUrl?: string }) {
    const auth = useAuth();
    const { theme } = useUnistyles();
    const maxWidth = Math.min(useLayoutMaxWidth(), 640);
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
    const stepTitle = access?.status === 'ready' ? t('sharedEntry.inviteStepOpen')
        : auth.isAuthenticated && !needsServerSwitch ? t('sharedEntry.inviteStepPrepare')
        : t('sharedEntry.inviteStepSignIn');
    const phase = access?.status === 'ready' ? 2 : auth.isAuthenticated && !needsServerSwitch ? 1 : 0;
    const steps = [t('sharedEntry.inviteProgressSignIn'), t('sharedEntry.inviteProgressPrepare'), t('sharedEntry.inviteProgressChat')];
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
        <Stack.Screen options={{ title: t('sharedEntry.inviteTitle') }} />
        <ScrollView style={stylesheet.screen} contentContainerStyle={stylesheet.scrollContent}>
            <View testID="shared-entry-invite-card" style={[stylesheet.card, { maxWidth }]}>
                <View style={stylesheet.brand}>
                    <Text style={stylesheet.brandName}>{t('brand.name')}</Text>
                    <Text style={stylesheet.eyebrow}>{t('sharedEntry.inviteTitle')}</Text>
                </View>
                {title ? <InvitePublication key={title} title={title} description={preview?.description} publisher={preview?.publisherDisplayName} /> : null}
                {!invalidServer && token && (preview || visible?.loaded) ? <View style={stylesheet.explanation}>
                    <Text style={stylesheet.body}>{t('sharedEntry.inviteContextDetail')}</Text>
                    <View style={stylesheet.resources}>
                        <Ionicons name="folder-outline" size={18} color={theme.colors.text.secondary} />
                        <Text style={stylesheet.resourcesText}>{t('sharedEntry.inviteResourcesDetail')}</Text>
                    </View>
                </View> : null}
                {!invalidServer && token && !needsServerSwitch && visible?.loaded ? <View testID="shared-entry-progress" accessible accessibilityLabel={stepTitle} style={stylesheet.progress}>
                    {steps.map((label, index) => <View key={index} style={stylesheet.step}>
                        <View style={[stylesheet.stepNumber, phase === index ? stylesheet.stepActive : null]}>
                            {phase > index ? <Ionicons name="checkmark" size={16} color={theme.colors.text.secondary} />
                                : <Text style={[stylesheet.stepNumberText, phase === index ? stylesheet.stepNumberActive : null]}>{index + 1}</Text>}
                        </View>
                        <Text style={[stylesheet.stepLabel, phase === index ? stylesheet.stepLabelActive : null]}>{label}</Text>
                    </View>)}
                </View> : null}
                {status ? <View style={stylesheet.status} accessibilityLiveRegion="polite">
                    <View style={stylesheet.statusHeading}>
                        {status.loading ? <ActivitySpinner size="small" color={theme.colors.text.secondary} /> : null}
                        <Text testID={status.testID} style={stylesheet.statusTitle}>{status.title}</Text>
                    </View>
                    {status.detail ? <Text testID="shared-entry-state-detail" selectable style={stylesheet.detail}>{status.detail}</Text> : null}
                </View> : null}
                {action ? <RoundButton {...action} accessibilityLabel={action.title} size="normal" style={stylesheet.action}
                    disabled={busy || action.disabled === true} loading={busy || action.loading === true} /> : null}
            </View>
        </ScrollView>
    </>;
}
