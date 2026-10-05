import * as React from 'react';
import { View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { ActivitySpinner } from '@/components/ui/feedback/ActivitySpinner';
import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import { RoundButton } from '@/components/ui/buttons/RoundButton';
import { PressableSurface } from '@/components/ui/interaction/PressableSurface';
import { useLocalSetting } from '@/sync/store/hooks';
import { t } from '@/text';

import type { RemoteAuthEntryOptions } from './useRemoteAuthEntryOptions';
import { useReturningGreeting } from './useReturningGreeting';
import { Icon, type IconName } from '@/components/ui/icons/Icon';

export type RemoteWelcomeDecisionPanelLayout = 'portrait' | 'landscape';
type AuthActionResult = void | Promise<void>;

export type RemoteWelcomeDecisionPanelProps = Readonly<{
    options: RemoteAuthEntryOptions;
    layout: RemoteWelcomeDecisionPanelLayout;
    isDesktopShell: boolean;
    onOpenSetup: () => void;
    onRestore: () => void;
    onProviderSignup: (providerId: string) => AuthActionResult;
    onAnonymousSignup: () => AuthActionResult;
    onMtlsLogin: () => AuthActionResult;
    onKeylessProviderLogin: (providerId: string) => AuthActionResult;
    onChangeRelay: () => void;
}>;

type DecisionActionRowProps = Readonly<{
    testID: string;
    title: string;
    subtitle?: string;
    primary?: boolean;
    iconName?: IconName;
    onPress: () => AuthActionResult;
}>;

function resolvePrimaryAction(
    options: RemoteAuthEntryOptions,
    props: Pick<
        RemoteWelcomeDecisionPanelProps,
        'onAnonymousSignup' | 'onKeylessProviderLogin' | 'onMtlsLogin' | 'onProviderSignup'
    >,
): (() => AuthActionResult) | null {
    switch (options.primaryAction?.kind) {
        case 'provider-keyed':
            return () => {
                if (options.providerId) props.onProviderSignup(options.providerId);
            };
        case 'mtls':
            return props.onMtlsLogin;
        case 'keyless':
            return () => {
                if (options.keylessProviderId) props.onKeylessProviderLogin(options.keylessProviderId);
            };
        case 'anonymous':
            return props.onAnonymousSignup;
        case undefined:
            return null;
    }
}

/** Composition belongs here; feedback and keyboard focus belong to existing primitives. */
function DecisionActionRow(props: DecisionActionRowProps): React.ReactElement {
    const { theme } = useUnistyles();
    const styles = stylesheet;
    if (props.primary) {
        return <View style={styles.primaryActionGroup}>
            <RoundButton testID={props.testID} title={props.title} size="normal"
                accessibilityLabel={props.title} onPress={() => { void props.onPress(); }}
                style={styles.primaryActionButton} />
            {props.subtitle ? <Text testID={`${props.testID}-subtitle`} style={styles.decisionActionSubtitle}>{props.subtitle}</Text> : null}
        </View>;
    }
    return <PressableSurface testID={props.testID} accessibilityRole="button" accessibilityLabel={props.title}
        onPress={() => { void props.onPress(); }} style={styles.decisionActionRow} focusRingRadius={12}>
        <View testID={`${props.testID}-text`} style={styles.decisionActionTextBlock}>
            <Text testID={`${props.testID}-title`} style={styles.decisionActionTitle}>{props.title}</Text>
            {props.subtitle ? <Text testID={`${props.testID}-subtitle`} style={styles.decisionActionSubtitle}>{props.subtitle}</Text> : null}
        </View>
        {props.iconName ? <Icon testID={`${props.testID}-icon`} name={props.iconName} size={20} color={theme.colors.text.secondary} /> : null}
    </PressableSurface>;
}

export function RemoteWelcomeDecisionPanel(props: RemoteWelcomeDecisionPanelProps): React.ReactElement {
    const { options } = props;
    const { theme } = useUnistyles();
    const styles = stylesheet;
    const primarySignupAction = resolvePrimaryAction(options, props);
    // Returning users (those who have authenticated on this device before) get
    // a warmer copy variant — a randomly-rotating warm greeting + an inverted
    // button hierarchy (Login becomes primary because that's the most likely
    // intent for a returning visit). The flag is flipped in
    // AuthContext.loginWithCredentials and preserved on logout, so it remains
    // true across re-installs of the session — exactly like the brand-hero
    // seen flag.
    const isReturningUser = useLocalSetting('hasCompletedAuthOnce');
    const returningGreeting = useReturningGreeting();
    // First-time visitors see the "Happier is the control room… your account is
    // a private key" explainer body. Returning users don't need it — they
    // already know what they're signing into — so we hide it for them.
    const shouldRenderFirstTimeCopy = options.serverAvailability !== 'loading'
        && options.showAuthActions
        && options.showAnonymousSignup
        && !isReturningUser;

    if (options.serverAvailability === 'unavailable' || options.serverAvailability === 'incompatible') {
        return (
            <View testID="welcome-decision-panel" style={styles.decisionPanel}>
                <View testID="welcome-server-unavailable" style={styles.serverUnavailableBlock}>
                    <Text testID="welcome-server-unavailable-title" style={styles.serverUnavailableTitle}>
                        {options.serverAvailability === 'incompatible'
                            ? t('welcome.serverIncompatibleTitle')
                            : t('welcome.serverUnavailableTitle')}
                    </Text>
                    <Text style={styles.serverStatusBody}>
                        {options.serverAvailability === 'incompatible'
                            ? t('welcome.serverIncompatibleBody', { serverUrl: options.serverUrlForCopy })
                            : t('welcome.serverUnavailableBody', { serverUrl: options.serverUrlForCopy })}
                    </Text>
                </View>
                <View style={styles.actionStack}>
                    <DecisionActionRow
                        testID="welcome-change-relay"
                        title={t('setupOnboarding.changeRelayAction')}
                        iconName="graph"
                        onPress={props.onChangeRelay}
                    />
                    <DecisionActionRow
                        testID="welcome-retry-server"
                        title={t('common.retry')}
                        iconName="arrow-clockwise"
                        onPress={options.retryServerCheck}
                    />
                </View>
            </View>
        );
    }

    return (
        <View testID="welcome-decision-panel" style={styles.decisionPanel}>
            <View style={styles.headingBlock}>
                <Text testID="welcome-question-title" accessibilityRole="header" style={styles.questionTitle}>
                    {isReturningUser ? returningGreeting.title : t('welcome.welcomeQuestionTitle')}
                </Text>
                <Text testID="welcome-question-subtitle" style={styles.questionSubtitleTitle}>
                    {isReturningUser ? returningGreeting.subtitle : t('welcome.welcomeQuestionSubtitle')}
                </Text>
                {shouldRenderFirstTimeCopy ? (
                    <Text testID="welcome-private-key-copy" style={styles.questionBody}>
                        {t('welcome.welcomeQuestionBody')}
                    </Text>
                ) : null}
            </View>
            {options.showTerminalConnectIntent ? (
                <View testID="welcome-terminal-connect-intent" style={styles.intentBlock}>
                    <Text style={styles.intentTitle}>{t('terminal.connectTerminal')}</Text>
                    <Text style={styles.intentBody}>{t('modals.pleaseSignInFirst')}</Text>
                </View>
            ) : null}
            {options.showSetupIntent ? (
                <View testID="welcome-setup-intent" style={styles.intentBlock}>
                    <Text style={styles.intentTitle}>{t('setupOnboarding.resumeIntentTitle')}</Text>
                    <Text style={styles.intentBody}>{t('setupOnboarding.resumeIntentBody')}</Text>
                </View>
            ) : null}
            {options.showAuthActions && options.primaryAction === null ? (
                <Text testID="welcome-signup-disabled" style={[styles.serverStatusBody, styles.signupDisabledNotice]}>
                    {t('errors.signupDisabled')}
                </Text>
            ) : null}
            {options.serverAvailability === 'loading' ? (
                <View style={styles.serverLoadingBlock}>
                    <ActivitySpinner />
                    <Text testID="welcome-server-loading" style={styles.serverLoadingText}>
                        {t('common.loading')}
                    </Text>
                </View>
            ) : null}
            {options.showAuthActions ? (
                <View style={styles.actionStack}>
                    {(() => {
                        // First-time visitors see Start fresh as the primary CTA
                        // (the expected action when arriving for the first time).
                        // Returning users see Login as the primary CTA — they
                        // almost certainly want to sign back into their existing
                        // account, so we give the primary slot to Login and
                        // demote Start fresh to the secondary row below.
                        // When the server disables every signup method, the
                        // primary slot stays empty and Login carries the panel.
                        const startFreshButton = options.primaryAction === null || primarySignupAction === null
                            ? null
                            : options.showAnonymousSignup ? (
                            <DecisionActionRow
                                testID="welcome-primary-start"
                                primary={!isReturningUser}
                                title={isReturningUser ? t('welcome.welcomeReturningStartFreshButton') : t('welcome.welcomePrimaryButton')}
                                subtitle={isReturningUser ? t('welcome.welcomeReturningStartFreshSubtitle') : t('welcome.welcomePrimarySubtitle')}
                                iconName="arrow-right"
                                onPress={props.onAnonymousSignup}
                            />
                        ) : (
                            <DecisionActionRow
                                testID={
                                    options.primaryAction.kind === 'provider-keyed'
                                        ? 'welcome-signup-provider'
                                        : 'welcome-create-account'
                                }
                                primary
                                title={options.primaryAction.title}
                                iconName={options.primaryAction.kind === 'mtls' ? 'shield-check' : 'arrow-right'}
                                onPress={primarySignupAction}
                            />
                        );
                        const loginButton = (
                            <DecisionActionRow
                                testID="welcome-secondary-login"
                                primary={(isReturningUser && options.showAnonymousSignup) || options.primaryAction === null}
                                title={isReturningUser && options.showAnonymousSignup
                                    ? t('welcome.welcomeReturningLoginButton')
                                    : t('welcome.welcomeSecondaryButton')}
                                subtitle={t('welcome.welcomeSecondarySubtitle')}
                                iconName="qr-code"
                                onPress={props.onRestore}
                            />
                        );
                        const inlineExtras = (
                            <>
                                {options.showMtlsLogin && !options.mtlsPrimary ? (
                                    <DecisionActionRow
                                        testID="welcome-mtls-login"
                                        title={options.mtlsTitle}
                                        iconName="shield-check"
                                        onPress={props.onMtlsLogin}
                                    />
                                ) : null}
                                {options.showProviderSignup && options.showAnonymousSignup && options.providerId ? (
                                    <DecisionActionRow
                                        testID="welcome-signup-provider"
                                        title={options.providerSignupTitle}
                                        iconName="arrow-right"
                                        onPress={() => props.onProviderSignup(options.providerId!)}
                                    />
                                ) : null}
                                {options.showKeylessProviderLogin && !options.keylessPrimary && options.keylessProviderId ? (
                                    <DecisionActionRow
                                        testID="welcome-login-provider"
                                        title={options.providerKeylessTitle}
                                        iconName="arrow-right"
                                        onPress={() => props.onKeylessProviderLogin(options.keylessProviderId!)}
                                    />
                                ) : null}
                            </>
                        );
                        // Returning anonymous: Login first (primary), extras,
                        // then Start fresh as a bordered secondary. Anything
                        // else keeps the original first-time ordering with
                        // Login last.
                        return isReturningUser && options.showAnonymousSignup ? (
                            <>
                                {loginButton}
                                {inlineExtras}
                                {startFreshButton}
                            </>
                        ) : (
                            <>
                                {startFreshButton}
                                {inlineExtras}
                                {loginButton}
                            </>
                        );
                    })()}
                </View>
            ) : null}
        </View>
    );
}

const stylesheet = StyleSheet.create((theme) => ({
    decisionPanel: {
        width: '100%',
        alignItems: 'center',
        gap: theme.margins.xxl,
    },
    headingBlock: {
        width: '100%',
        maxWidth: 520,
    },
    questionTitle: {
        ...Typography.contentTitle(),
        color: theme.colors.text.primary,
        textAlign: 'left',
    },
    questionSubtitleTitle: {
        ...Typography.bodyText(),
        marginTop: 12,
        color: theme.colors.text.secondary,
        textAlign: 'left',
    },
    questionBody: {
        ...Typography.bodyText(),
        color: theme.colors.text.secondary,
        marginTop: theme.margins.lg,
        maxWidth: 440,
    },
    intentBlock: {
        width: '100%',
        maxWidth: 560,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: theme.colors.border.default,
        backgroundColor: theme.colors.surface.base,
        paddingHorizontal: 14,
        paddingVertical: 12,
        marginBottom: 20,
    },
    intentTitle: {
        ...Typography.default('semiBold'),
        fontSize: 16,
        color: theme.colors.text.primary,
        textAlign: 'center',
        marginBottom: 6,
    },
    intentBody: {
        ...Typography.default(),
        fontSize: 14,
        color: theme.colors.text.secondary,
        textAlign: 'center',
        lineHeight: 20,
    },
    serverUnavailableBlock: {
        width: '100%',
        maxWidth: 560,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: theme.colors.border.default,
        backgroundColor: theme.colors.surface.base,
        paddingHorizontal: 14,
        paddingVertical: 12,
        marginBottom: 20,
    },
    serverUnavailableTitle: {
        ...Typography.default('semiBold'),
        fontSize: 22,
        lineHeight: 28,
        color: theme.colors.text.primary,
        textAlign: 'center',
        marginBottom: 8,
    },
    serverStatusBody: {
        ...Typography.default(),
        fontSize: 14,
        color: theme.colors.text.secondary,
        textAlign: 'center',
        lineHeight: 20,
    },
    serverLoadingBlock: {
        width: '100%',
        maxWidth: 560,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 20,
    },
    serverLoadingText: {
        ...Typography.default(),
        fontSize: 14,
        color: theme.colors.text.secondary,
        textAlign: 'center',
        marginTop: 10,
    },
    signupDisabledNotice: {
        width: '100%',
        maxWidth: 520,
        textAlign: 'left',
    },
    actionStack: {
        width: '100%',
        maxWidth: 520,
        gap: theme.margins.md,
    },
    primaryActionGroup: { gap: theme.margins.sm },
    primaryActionButton: { minHeight: 48 },
    decisionActionRow: {
        minHeight: 60,
        borderRadius: 12,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.border.default,
        backgroundColor: theme.colors.surface.base,
        paddingHorizontal: theme.margins.lg,
        paddingVertical: theme.margins.md,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: theme.margins.lg,
    },
    decisionActionTextBlock: { flex: 1, gap: theme.margins.xs },
    decisionActionTitle: { ...Typography.rowTitle(), color: theme.colors.text.primary },
    decisionActionSubtitle: { ...Typography.rowMeta(), color: theme.colors.text.secondary },
}));
