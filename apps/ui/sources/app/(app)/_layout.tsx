import { Stack, router } from 'expo-router';
import 'react-native-reanimated';
import * as React from 'react';
import { Keyboard, Platform, Pressable, useWindowDimensions } from 'react-native';
import { isRunningOnMac } from '@/utils/platform/platform';
import { useUnistyles } from 'react-native-unistyles';
import { t } from '@/text';
import { useAuth } from '@/auth/context/AuthContext';
import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import { createAppStackScreenOptions } from '@/components/navigation/createAppStackScreenOptions';
import { MobileBottomChromeHost } from '@/components/navigation/mobile/chrome/MobileBottomChromeHost';
import { AppHeaderCloseButton } from '@/components/navigation/AppHeaderCloseButton';
import { SessionCockpitChromeRegistryProvider } from '@/components/workspaceCockpit/session/SessionCockpitChromeRegistry';
import { safeRouterBack } from '@/utils/navigation/safeRouterBack';
import { RootLayoutNavigationEffects } from '@/components/navigation/root/RootLayoutNavigationEffects';
import { RootLayoutRedirectGate } from '@/components/navigation/root/RootLayoutRedirectGate';
import { isMobileLayoutWidth } from '@/components/sessions/layout/isMobileLayoutWidth';
import {
    isNewSessionFloatingComposerPresentation,
    resolveNewSessionRoutePresentation,
} from '@/components/sessions/new/navigation/newSessionPresentation';

// Module-scope so the options callback hands the navigator the same object on every render.
const NEW_SESSION_TRANSPARENT_CONTENT_STYLE = { backgroundColor: 'transparent' } as const;
const MAIN_TAB_STACK_SCREEN_OPTIONS = { animation: 'none' } as const;
const SESSION_COCKPIT_SURFACE_STACK_SCREEN_OPTIONS = {
    animation: 'none',
    headerShown: false,
} as const;
const UNAUTH_SHELL_STACK_SCREEN_OPTIONS = { headerShown: false } as const;
const NEW_SESSION_HEADER_TITLE_TYPOGRAPHY = Typography.header();

type ModalRouteNavigation = Readonly<{
    canGoBack?: () => boolean;
    goBack?: () => void;
    getState?: () => Readonly<{
        index?: number;
        routes?: ReadonlyArray<unknown>;
    }> | undefined;
}>;

function hasPriorModalStackRoute(navigation: ModalRouteNavigation): boolean {
    const state = navigation.getState?.();
    return typeof state?.index === 'number'
        && state.index > 0
        && Array.isArray(state.routes)
        && state.routes.length > 1;
}

function canDismissNewSessionWithGesture(navigation: ModalRouteNavigation): boolean {
    return Platform.OS !== 'web' || hasPriorModalStackRoute(navigation);
}

function NewSessionModalHeaderCloseButton(props: Readonly<{ navigation: ModalRouteNavigation }>): React.ReactElement | null {
    const { width: windowWidth } = useWindowDimensions();

    if (Platform.OS === 'web' && isMobileLayoutWidth(windowWidth)) {
        return null;
    }

    return (
        <AppHeaderCloseButton
            testID="new-session-cancel"
            onPress={() => safeRouterBack({ router, navigation: props.navigation, fallbackHref: '/' })}
        />
    );
}

function NewSessionKeyboardDismissHeaderTitle(): React.ReactElement {
    const { theme } = useUnistyles();

    return (
        <Pressable
            accessibilityLabel={t('newSession.title')}
            accessibilityRole="button"
            onPress={Keyboard.dismiss}
            testID="new-session-header-keyboard-dismiss"
        >
            <Text
                style={[
                    NEW_SESSION_HEADER_TITLE_TYPOGRAPHY,
                    { color: theme.colors.chrome.header.foreground },
                ]}
            >
                {t('newSession.title')}
            </Text>
        </Pressable>
    );
}

const RootLayoutShell = React.memo(function RootLayoutShell(): React.ReactElement {
    const auth = useAuth();
    const { theme } = useUnistyles();
    const newSessionVariant = 'simple';
    const newSessionPresentation = resolveNewSessionRoutePresentation({
        variant: newSessionVariant,
        platformOs: Platform.OS,
    });
    const newSessionRendersFloatingComposer = isNewSessionFloatingComposerPresentation({
        variant: newSessionVariant,
        platformOs: Platform.OS,
    });

    // Use custom header on Android and Mac Catalyst, native header on iOS (non-Catalyst)
    const shouldUseCustomHeader = Platform.OS === 'android' || isRunningOnMac() || Platform.OS === 'web';
    const baseStackScreenOptions = React.useMemo(() => createAppStackScreenOptions({
        headerBackTitle: t('common.back'),
        shouldUseCustomHeader,
        theme,
    }), [shouldUseCustomHeader, theme]);
    const mixedUseRouteScreenOptions = React.useMemo(() => {
        if (!auth.isAuthenticated) {
            return {
                terminal: UNAUTH_SHELL_STACK_SCREEN_OPTIONS,
                restore: UNAUTH_SHELL_STACK_SCREEN_OPTIONS,
                restoreManual: UNAUTH_SHELL_STACK_SCREEN_OPTIONS,
                restoreLostAccess: UNAUTH_SHELL_STACK_SCREEN_OPTIONS,
            };
        }

        return {
            terminal: {
                headerShown: true,
                headerTitle: t('terminal.connectTerminal'),
                headerBackTitle: t('common.back'),
            },
            restore: {
                headerShown: true,
                headerTitle: t('connect.restoreAccount'),
                headerBackTitle: t('common.back'),
            },
            restoreManual: {
                headerShown: true,
                headerTitle: t('navigation.restoreWithSecretKey'),
                headerBackTitle: t('common.back'),
            },
            restoreLostAccess: {
                headerShown: true,
                headerTitle: t('connect.lostAccessTitle'),
                headerBackTitle: t('common.back'),
            },
        };
    }, [auth.isAuthenticated]);

    return (
        <SessionCockpitChromeRegistryProvider>
            <Stack screenOptions={baseStackScreenOptions}>
            <Stack.Screen
                name="index"
                options={{
                    ...MAIN_TAB_STACK_SCREEN_OPTIONS,
                    headerShown: false,
                    headerTitle: '',
                }}
            />
            <Stack.Screen
                name="oauth/[provider]"
                options={UNAUTH_SHELL_STACK_SCREEN_OPTIONS}
            />
            <Stack.Screen
                name="setup"
                options={UNAUTH_SHELL_STACK_SCREEN_OPTIONS}
            />
            <Stack.Screen
                name="settings"
                options={{
                    ...MAIN_TAB_STACK_SCREEN_OPTIONS,
                    headerShown: false,
                }}
            />
            <Stack.Screen
                name="session/[id]/info"
                options={{
                    headerShown: true,
                    headerTitle: '',
                    headerBackTitle: t('common.back'),
                }}
            />
            <Stack.Screen
                name="session/[id]/transcript"
                options={{
                    headerShown: true,
                    headerTitle: '',
                    headerBackTitle: t('common.back'),
                }}
            />
            <Stack.Screen
                name="session/[id]/details"
                options={SESSION_COCKPIT_SURFACE_STACK_SCREEN_OPTIONS}
            />
            <Stack.Screen
                name="session/[id]/index"
                options={SESSION_COCKPIT_SURFACE_STACK_SCREEN_OPTIONS}
            />
            <Stack.Screen
                name="session/[id]/message/[messageId]"
                options={{
                    headerShown: true,
                    headerTitle: '',
                    headerBackTitle: t('common.back'),
                }}
            />
            <Stack.Screen
                name="session/recent"
                options={{
                    headerShown: true,
                    headerTitle: t('sessionHistory.title'),
                    headerBackTitle: t('common.back'),
                }}
            />
            <Stack.Screen
                name="session/archived"
                options={{
                    headerShown: true,
                    headerTitle: t('sessionHistory.title'),
                    headerBackTitle: t('common.back'),
                }}
            />
            <Stack.Screen
                name="terminal/connect"
                options={mixedUseRouteScreenOptions.terminal}
            />
            <Stack.Screen
                name="terminal/index"
                options={mixedUseRouteScreenOptions.terminal}
            />
            <Stack.Screen
                name="scan/terminal"
                options={{
                    headerShown: false,
                }}
            />
            <Stack.Screen
                name="scan/account"
                options={{
                    headerShown: false,
                }}
            />
            <Stack.Screen
                name="restore/index"
                options={mixedUseRouteScreenOptions.restore}
            />
            <Stack.Screen
                name="restore/show-qr"
                options={UNAUTH_SHELL_STACK_SCREEN_OPTIONS}
            />
            <Stack.Screen
                name="restore/manual"
                options={mixedUseRouteScreenOptions.restoreManual}
            />
            <Stack.Screen
                name="restore/lost-access"
                options={mixedUseRouteScreenOptions.restoreLostAccess}
            />

            <Stack.Screen
                name="new/pick/machine"
                options={{
                    headerTitle: '',
                    headerBackTitle: t('common.back'),
                }}
            />
            <Stack.Screen
                name="new/pick/path"
                options={{
                    headerTitle: '',
                    headerBackTitle: t('common.back'),
                }}
            />
            <Stack.Screen
                name="new/index"
                options={({ navigation }) => {
                    const canDismissWithGesture = canDismissNewSessionWithGesture(navigation);
                    if (newSessionRendersFloatingComposer) {
                        return {
                            // The composer paints its own backdrop and owns its own close control,
                            // so the navigator contributes no chrome at all.
                            headerShown: false,
                            presentation: newSessionPresentation,
                            // No native transition at all: the screen owns both directions in
                            // Reanimated. UIKit's cross-dissolve is the only modal transition whose
                            // timing tracks the presentation, but its duration is not settable
                            // (`animationDuration` is inert for every modal presentation), and it
                            // was too slow and too soft to read as a composer arriving. Owning it
                            // buys the snap and the slide; the mistiming that made a JS entrance
                            // unusable before is solved by starting it from the composer's first
                            // layout rather than from mount.
                            animation: 'none',
                            // native-stack already omits its own opaque background for the two
                            // transparent presentations, but `createAppStackScreenOptions` supplies
                            // `surface.base` for every screen and is applied after it.
                            contentStyle: NEW_SESSION_TRANSPARENT_CONTENT_STYLE,
                            // `UIModalPresentationOverFullScreen` has no sheet presentation
                            // controller, so there is no interactive pull-to-dismiss to enable.
                            gestureEnabled: false,
                            fullScreenGestureEnabled: false,
                        };
                    }
                    return {
                        headerShown: true,
                        headerBackTitle: t('common.cancel'),
                        presentation: newSessionPresentation,
                        // Expo Router's web modal closes its Vaul drawer before calling goBack().
                        // With a direct /new entry there is no route to pop, so keep the drawer open
                        // and use the explicit close affordance's deterministic fallback instead.
                        gestureEnabled: canDismissWithGesture,
                        fullScreenGestureEnabled: canDismissWithGesture,
                        // Swipe-to-dismiss is not consistently available across platforms; always provide a close button.
                        headerBackVisible: false,
                        headerTitle: Platform.OS === 'web'
                            ? t('newSession.title')
                            : NewSessionKeyboardDismissHeaderTitle,
                        headerLeft: () => null,
                        headerRight: () => <NewSessionModalHeaderCloseButton navigation={navigation} />,
                    };
                }}
            />
            </Stack>
            <MobileBottomChromeHost newSessionRendersFloatingComposer={newSessionRendersFloatingComposer} />
        </SessionCockpitChromeRegistryProvider>
    );
});

export default function RootLayout(): React.ReactElement {
    // Composition root: subscribes to nothing that changes per navigation, so the
    // `<RootLayoutShell />` element reference stays stable and its Stack subtree is not
    // re-rendered when the route changes. Navigation/auth side effects live in the null-rendering
    // `<RootLayoutNavigationEffects />` sibling; the unauthenticated redirect check lives in the
    // `<RootLayoutRedirectGate />`, the only navigation-subscribing owner in this render path.
    return (
        <>
            <RootLayoutNavigationEffects />
            <RootLayoutRedirectGate>
                <RootLayoutShell />
            </RootLayoutRedirectGate>
        </>
    );
}
