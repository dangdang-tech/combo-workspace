import * as React from 'react';
import { Animated, Platform, View, type LayoutChangeEvent } from 'react-native';
import { router as expoRouter, usePathname, useRouter } from 'expo-router';

import { useAuth } from '@/auth/context/AuthContext';
import { useSessionCockpitBottomChromeHeightSetter } from '@/components/workspaceCockpit/session/SessionCockpitChromeRegistry';
import { motionTokens } from '@/components/ui/motion/motionTokens';
import { TabBar, type TabType } from '@/components/ui/navigation/TabBar';
import { TabBarNewSessionButton } from '@/components/ui/navigation/TabBarNewSessionButton';
import { useKeyboardHeight } from '@/hooks/ui/useKeyboardHeight';
import { useReducedMotionPreference } from '@/hooks/ui/useReducedMotionPreference';
import { useTabState } from '@/hooks/ui/useTabState';
import {
    isOverlaySurfaceRoutePathname,
    normalizeSurfaceRoutePathname,
} from '@/components/sessions/shell/surface/sessionSurfaceAnchorPathname';
import { useDeviceType } from '@/utils/platform/responsive';
import { fireAndForget } from '@/utils/system/fireAndForget';

type TabRouteHref = Parameters<typeof expoRouter.replace>[0];
type MainAppTab = Extract<TabType, 'sessions' | 'settings'>;

const TAB_ROUTES = {
    sessions: '/',
    settings: '/settings',
} satisfies Record<MainAppTab, TabRouteHref>;

function createInitialMainTabRoutes(): Record<MainAppTab, TabRouteHref> {
    return { ...TAB_ROUTES };
}

export function resolveMobileBottomChromeActiveTab(pathname: string): MainAppTab | null {
    if (pathname === '/') return 'sessions';
    if (pathname === '/settings' || pathname.startsWith('/settings/')) return 'settings';
    return null;
}

function resolveRememberedMainTabRoute(
    tab: MainAppTab,
    rememberedRoute: TabRouteHref | undefined,
): TabRouteHref {
    if (
        typeof rememberedRoute === 'string'
        && resolveMobileBottomChromeActiveTab(rememberedRoute) === tab
    ) {
        return rememberedRoute as TabRouteHref;
    }
    return TAB_ROUTES[tab];
}

type BottomChromeItem = Readonly<{
    key: string;
    signature: string;
    node: React.ReactElement;
}>;

export const MobileBottomChromeHost = React.memo(function MobileBottomChromeHost(props: Readonly<{
    /** Canonical pre-push presentation decision from the app stack owner. */
    newSessionRendersFloatingComposer?: boolean;
}>) {
    const pathname = usePathname();
    const router = useRouter();
    const auth = useAuth();
    const deviceType = useDeviceType();
    // Composer positioning uses its own keyboard scaffold; this read only hides main navigation.
    const keyboardHeightPx = useKeyboardHeight();
    const softwareKeyboardVisible = deviceType === 'phone' && keyboardHeightPx > 0;
    const setBottomChromeHeight = useSessionCockpitBottomChromeHeightSetter();
    const reduceMotion = useReducedMotionPreference();
    const { setActiveTab } = useTabState();
    const activeTab = auth.isAuthenticated === true && typeof pathname === 'string'
        ? resolveMobileBottomChromeActiveTab(pathname)
        : null;
    const mainTabRoutesRef = React.useRef<Record<MainAppTab, TabRouteHref>>(createInitialMainTabRoutes());
    if (activeTab && typeof pathname === 'string') {
        mainTabRoutesRef.current[activeTab] = pathname as TabRouteHref;
    }
    const handleTabPress = React.useCallback((tab: TabType) => {
        if (tab !== 'sessions' && tab !== 'settings') return;
        const targetRoute = resolveRememberedMainTabRoute(tab, mainTabRoutesRef.current[tab]);
        if (activeTab === tab) {
            if (typeof pathname === 'string' && pathname !== TAB_ROUTES[tab]) {
                router.navigate(TAB_ROUTES[tab]);
            }
            return;
        }

        router.navigate(targetRoute);
        if (tab !== 'settings') {
            fireAndForget(setActiveTab(tab));
        }
    }, [activeTab, pathname, router, setActiveTab]);

    const buildMainChrome = React.useCallback((tab: MainAppTab): BottomChromeItem => ({
        key: 'mainAppTabs',
        signature: `mainAppTabs:${tab}`,
        node: (
            <TabBar
                activeTab={tab}
                onTabPress={handleTabPress}
                // Session creation belongs to the sessions surface.
                trailingAccessory={tab === 'sessions' ? <TabBarNewSessionButton /> : undefined}
            />
        ),
    }), [handleTabPress]);

    // The new-session overlay is presented over the current screen rather than
    // replacing it, so it should not change which bar the chrome host is showing — it simply covers
    // it. Recomputing here treated `/new` as "no tab, no session" and tore the bar down, so closing
    // the composer had to build it back afterwards and the two reads as a sequence instead of one
    // surface lifting away. Freezing the last real chrome keeps the bar mounted and untouched
    // underneath, which is also why it can come back with no animation at all.
    const overlayRouteActive = typeof pathname === 'string' && isOverlaySurfaceRoutePathname(pathname);
    const androidFloatingNewSessionActive = Platform.OS === 'android'
        && normalizeSurfaceRoutePathname(pathname) === '/new'
        && props.newSessionRendersFloatingComposer === true;
    const frozenChromeRef = React.useRef<BottomChromeItem | null>(null);

    const resolvedChrome = React.useMemo((): BottomChromeItem | null => {
        if (deviceType !== 'phone') {
            return null;
        }

        if (overlayRouteActive) {
            return frozenChromeRef.current;
        }

        if (activeTab) {
            if (softwareKeyboardVisible) {
                return null;
            }

            return buildMainChrome(activeTab);
        }

        return null;
    }, [activeTab, buildMainChrome, overlayRouteActive, deviceType, softwareKeyboardVisible]);

    if (!overlayRouteActive) {
        frozenChromeRef.current = resolvedChrome;
    }

    const [renderedChrome, setRenderedChrome] = React.useState<Readonly<{
        current: BottomChromeItem | null;
        previous: BottomChromeItem | null;
    }>>({
        current: resolvedChrome,
        previous: null,
    });
    const renderedChromeRef = React.useRef(renderedChrome);
    const progress = React.useRef(new Animated.Value(1)).current;
    const activeAnimationRef = React.useRef<Animated.CompositeAnimation | null>(null);
    // Latest desired chrome, tracked so the cross-fade completion always settles on
    // the freshest node even if the signature changed mid-transition.
    const latestResolvedChromeRef = React.useRef(resolvedChrome);
    latestResolvedChromeRef.current = resolvedChrome;

    const setRenderedChromeState = React.useCallback((nextChrome: typeof renderedChrome) => {
        renderedChromeRef.current = nextChrome;
        setRenderedChrome(nextChrome);
    }, []);

    const stopChromeAnimation = React.useCallback(() => {
        activeAnimationRef.current?.stop();
        activeAnimationRef.current = null;
        (progress as Animated.Value & { stopAnimation?: () => void }).stopAnimation?.();
    }, [progress]);

    const handleChromeLayout = React.useCallback((event: LayoutChangeEvent) => {
        setBottomChromeHeight(event.nativeEvent.layout.height);
    }, [setBottomChromeHeight]);

    React.useLayoutEffect(() => {
        const currentRenderedChrome = renderedChromeRef.current.current;

        if (!resolvedChrome) {
            if (!currentRenderedChrome) {
                stopChromeAnimation();
                progress.setValue(1);
                setRenderedChromeState({ current: null, previous: null });
                return;
            }

            // Chrome going away used to be the one transition this host cut rather than animated:
            // every bar-to-bar change cross-faded, but bar-to-nothing snapped. That path is taken
            // whenever an overlay route opens (`/new`) or the keyboard comes up, so the abrupt
            // frame was in the most-repeated flows in the app. The bar leaves the same way it
            // arrives — dissolving in place — only faster, because attention is already moving on.
            stopChromeAnimation();
            setRenderedChromeState({ current: null, previous: currentRenderedChrome });

            if (reduceMotion) {
                progress.setValue(1);
                setRenderedChromeState({ current: null, previous: null });
                return;
            }

            progress.setValue(0);
            const exitAnimation = Animated.timing(progress, {
                toValue: 1,
                duration: motionTokens.overlay.modal.exitMs,
                easing: motionTokens.easing.standard,
                useNativeDriver: Platform.OS !== 'web',
            });
            activeAnimationRef.current = exitAnimation;
            exitAnimation.start(({ finished }) => {
                if (activeAnimationRef.current !== exitAnimation) {
                    return;
                }
                activeAnimationRef.current = null;
                if (!finished) {
                    return;
                }
                progress.setValue(1);
                setRenderedChromeState({ current: null, previous: null });
            });
            return;
        }

        if (!currentRenderedChrome) {
            stopChromeAnimation();
            progress.setValue(1);
            setRenderedChromeState({ current: resolvedChrome, previous: null });
            return;
        }

        if (currentRenderedChrome.key === resolvedChrome.key) {
            if (currentRenderedChrome.signature === resolvedChrome.signature) {
                return;
            }
            // Same bar, selected tab changed. If a cross-fade is
            // in flight, just swap the node and let the animation finish instead of
            // snapping to the final frame (which reads as a flicker).
            if (activeAnimationRef.current) {
                setRenderedChromeState({ current: resolvedChrome, previous: renderedChromeRef.current.previous });
                return;
            }
            stopChromeAnimation();
            progress.setValue(1);
            setRenderedChromeState({ current: resolvedChrome, previous: null });
            return;
        }

        stopChromeAnimation();
        setRenderedChromeState({
            current: resolvedChrome,
            previous: currentRenderedChrome,
        });

        if (reduceMotion) {
            progress.setValue(1);
            setRenderedChromeState({ current: resolvedChrome, previous: null });
            return;
        }

        progress.setValue(0);
        const animation = Animated.timing(progress, {
            toValue: 1,
            duration: motionTokens.durationMs.base,
            easing: motionTokens.easing.standard,
            useNativeDriver: Platform.OS !== 'web',
        });
        activeAnimationRef.current = animation;
        animation.start(({ finished }) => {
            if (activeAnimationRef.current !== animation) {
                return;
            }
            activeAnimationRef.current = null;
            if (!finished) {
                return;
            }
            progress.setValue(1);
            setRenderedChromeState({ current: latestResolvedChromeRef.current ?? resolvedChrome, previous: null });
        });
    }, [progress, reduceMotion, resolvedChrome, setRenderedChromeState, stopChromeAnimation]);

    React.useLayoutEffect(() => () => {
        stopChromeAnimation();
    }, [stopChromeAnimation]);

    React.useLayoutEffect(() => {
        if (!renderedChrome.current) {
            setBottomChromeHeight(0);
        }
    }, [renderedChrome.current, setBottomChromeHeight]);

    // `previous` outlives `current` while the bar dissolves on its way out, so the host keeps
    // rendering until BOTH are gone. The published chrome height already dropped to 0 above, so
    // the surfaces that pad by it reclaim their space immediately rather than waiting for the fade.
    if (!renderedChrome.current && !renderedChrome.previous) {
        return null;
    }

    // Android's transparent native-stack screen and this global chrome host are sibling native
    // views. The host is mounted after the Stack, so keeping its pixels rendered places them above
    // the composer's app-painted scrim even though its frozen model is conceptually "under" the
    // modal. Keep that model intact for an immediate return, but contribute no sibling pixels while
    // the floating composer is active. Other presentations keep the normal frozen-underlay path.
    if (androidFloatingNewSessionActive) {
        return null;
    }

    // Incoming bar stays fully opaque; the outgoing bar dissolves over it. This
    // avoids two translucent glass layers cross-fading at once (their backgrounds
    // would compound at the midpoint, which reads as a flicker).
    const previousStyle = {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        opacity: progress.interpolate({
            inputRange: [0, 1],
            outputRange: [1, 0],
        }),
    } as const;

    // Main navigation floats above the list; the shared height lets list content clear it.
    return (
        <View
            onLayout={handleChromeLayout}
            pointerEvents="box-none"
            style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}
        >
            {renderedChrome.current?.node ?? null}
            {renderedChrome.previous ? (
                <Animated.View pointerEvents="none" style={previousStyle}>
                    {renderedChrome.previous.node}
                </Animated.View>
            ) : null}
        </View>
    );
});
