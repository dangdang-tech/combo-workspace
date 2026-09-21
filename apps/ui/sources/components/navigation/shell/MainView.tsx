import * as React from 'react';
import { View, Pressable } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { ActivitySpinner } from '@/components/ui/feedback/ActivitySpinner';
import {
    useVisibleSessionListPaneState,
} from '@/hooks/session/useVisibleSessionListViewData';
import { useIsTablet } from '@/utils/platform/responsive';
import { usePathname, useRouter } from 'expo-router';
import { SessionGettingStartedGuidance } from '@/components/sessions/guidance/SessionGettingStartedGuidance';
import { HiddenInactiveSessionsEmptyState } from '@/components/sessions/guidance/HiddenInactiveSessionsEmptyState';
import { SessionsListContent } from '@/components/sessions/shell/SessionsList';
import { readSessionIdFromPathname } from '@/components/sessions/shell/readSessionIdFromPathname';
import {
    resolveSessionListSurfaceOwnership,
    resolveSidebarSessionListSurfaceInteractive,
    SESSION_LIST_SURFACE_OWNER_SIDEBAR,
} from '@/components/sessions/shell/surface/sessionListSurfaceOwnership';
import { FABWide } from '@/components/ui/buttons/FABWide';
import { SessionsListWrapper } from '@/components/sessions/shell/SessionsListWrapper';
import { Header } from '@/components/navigation/Header';
import { HeaderLogo } from '@/components/ui/navigation/HeaderLogo';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import { ConnectionStatusControl } from '@/components/navigation/ConnectionStatusControl';
import { Text } from '@/components/ui/text/Text';
import { getFeatureBuildPolicyDecision } from '@/sync/domains/features/featureBuildPolicy';
import type { FeatureId } from '@happier-dev/protocol';
import { Icon } from '@/components/ui/icons/Icon';
import {
    shouldForceFreshNewSessionEntryFromPressEvent,
    useResolveNewSessionOrdinaryEntryRoute,
} from '@/components/sessions/new/navigation/newSessionOrdinaryEntryRoute';


interface MainViewProps {
    variant: 'phone' | 'sidebar';
}

type MainViewLoadedProps = MainViewProps & Readonly<{
    isTablet: boolean;
    pathname: string;
}>;

const styles = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
    },
    sidebarContainer: {
        flex: 1,
        flexBasis: 0,
        flexGrow: 1,
    },
    phoneContainer: {
        flex: 1,
    },
    sidebarContentContainer: {
        flex: 1,
        flexBasis: 0,
        flexGrow: 1,
    },
    loadingContainerWrapper: {
        flex: 1,
        flexBasis: 0,
        flexGrow: 1,
        backgroundColor: theme.colors.background.canvas,
    },
    loadingContainer: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingBottom: 32,
    },
    tabletLoadingContainer: {
        flex: 1,
        flexBasis: 0,
        flexGrow: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    emptyStateContainer: {
        flex: 1,
        flexBasis: 0,
        flexGrow: 1,
        flexDirection: 'column',
        backgroundColor: theme.colors.surface.inset,
    },
    emptyStateContentContainer: {
        flex: 1,
        flexBasis: 0,
        flexGrow: 1,
    },
    sidebarEmptyHintContainer: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'flex-start',
        paddingHorizontal: 16,
        paddingTop: 24,
        gap: 8,
    },
    sidebarEmptyHintTitle: {
        fontSize: 15,
        color: theme.colors.text.primary,
        ...Typography.default('semiBold'),
    },
    sidebarEmptyHintSubtitle: {
        fontSize: 13,
        color: theme.colors.text.secondary,
        textAlign: 'center',
        ...Typography.default(),
    },
    titleContainer: {
        flex: 1,
        alignItems: 'center',
    },
    titleText: {
        fontSize: 15,
        color: theme.colors.chrome.header.foreground,
        ...Typography.default('semiBold'),
    },
    statusContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: -2,
    },
    statusText: {
        fontSize: 11,
        lineHeight: 16,
        ...Typography.default(),
    },
    headerButton: {
        width: 32,
        height: 32,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
    },
    primaryPaneFallback: {
        flex: 1,
        flexBasis: 0,
        flexGrow: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 20,
        backgroundColor: theme.colors.background.canvas,
    },
    primaryPaneFallbackText: {
        textAlign: 'center',
        maxWidth: 520,
        color: theme.colors.text.secondary,
        fontSize: 15,
        ...Typography.default(),
    },
}));

const SESSION_GETTING_STARTED_GUIDANCE_FEATURE_ID = 'app.ui.sessionGettingStartedGuidance' as const satisfies FeatureId;

const HeaderTitle = React.memo(() => (
    <View style={styles.titleContainer}>
        <Text style={styles.titleText}>{t('tabs.sessions')}</Text>
        <ConnectionStatusControl variant="header" />
    </View>
));

const HeaderRight = React.memo(() => {
    const router = useRouter();
    const resolveNewSessionOrdinaryEntryRoute = useResolveNewSessionOrdinaryEntryRoute();
    const { theme } = useUnistyles();
    const handleNewSession = React.useCallback((event?: unknown) => {
        const { draftId, draftOrigin } = resolveNewSessionOrdinaryEntryRoute({
            forceFresh: shouldForceFreshNewSessionEntryFromPressEvent(event),
        });
        router.push({ pathname: '/new', params: { draftId, draftOrigin } });
    }, [resolveNewSessionOrdinaryEntryRoute, router]);

    return (
        <Pressable
            testID="main-header-start-new-session"
            onPress={handleNewSession}
            hitSlop={15}
            style={styles.headerButton}
            accessibilityRole="button"
            accessibilityLabel={t('newSession.title')}
        >
            <Icon name="plus" size={22} color={theme.colors.chrome.header.foreground} />
        </Pressable>
    );
});

const SidebarMainViewContent = React.memo(function SidebarMainViewContent({
    isTablet,
    pathname,
}: Readonly<{
    isTablet: boolean;
    pathname: string;
}>) {
    const { theme } = useUnistyles();
    const storageKind = 'persisted' as const;
    const router = useRouter();
    const resolveNewSessionOrdinaryEntryRoute = useResolveNewSessionOrdinaryEntryRoute();
    const activeSessionId = React.useMemo(() => readSessionIdFromPathname(pathname), [pathname]);
    const surfaceOwnership = React.useMemo(
        () => resolveSessionListSurfaceOwnership({
            ownerKey: SESSION_LIST_SURFACE_OWNER_SIDEBAR,
            interactiveOwnerKey: SESSION_LIST_SURFACE_OWNER_SIDEBAR,
            visible: true,
            interactive: resolveSidebarSessionListSurfaceInteractive(pathname),
        }),
        [pathname],
    );
    const {
        sessionListViewData,
        visibleSessionCount,
        hasHiddenInactiveSessions,
    } = useVisibleSessionListPaneState(storageKind, {
        activeSessionId,
        sessionListSurfaceDataActive: surfaceOwnership.dataActive,
    });

    const handleNewSession = React.useCallback((event?: unknown) => {
        const { draftId, draftOrigin } = resolveNewSessionOrdinaryEntryRoute({
            forceFresh: shouldForceFreshNewSessionEntryFromPressEvent(event),
        });
        router.push({ pathname: '/new', params: { draftId, draftOrigin } });
    }, [resolveNewSessionOrdinaryEntryRoute, router]);

    let content: React.ReactNode;
    if (sessionListViewData === null) {
        content = (
            <View style={styles.sidebarContainer}>
                <View style={styles.sidebarContentContainer}>
                    <View style={styles.tabletLoadingContainer}>
                        <ActivitySpinner size="small" color={theme.colors.text.secondary} />
                    </View>
                </View>
            </View>
        );
    } else if (visibleSessionCount === 0) {
        const suppressSidebarGuidance = isTablet && pathname === '/';
        content = (
            <View style={styles.sidebarContainer}>
                <View style={styles.sidebarContentContainer}>
                    <View style={styles.emptyStateContainer}>
                        {hasHiddenInactiveSessions ? (
                            <HiddenInactiveSessionsEmptyState />
                        ) : suppressSidebarGuidance ? (
                            <View style={styles.sidebarEmptyHintContainer}>
                                <Text style={styles.sidebarEmptyHintTitle}>{t('components.emptySessionsTablet.noActiveSessions')}</Text>
                                <Text style={styles.sidebarEmptyHintSubtitle}>{t('components.emptySessionsTablet.startNewSessionDescription')}</Text>
                            </View>
                        ) : (
                            <SessionGettingStartedGuidance variant="sidebar" />
                        )}
                    </View>
                </View>
            </View>
        );
    } else {
        content = (
            <View style={styles.sidebarContainer}>
                <View style={styles.sidebarContentContainer}>
                    <SessionsListContent
                        storageKind={storageKind}
                        data={sessionListViewData}
                        pathname={pathname}
                        surfaceOwnership={surfaceOwnership}
                    />
                </View>
            </View>
        );
    }

    return (
        <>
            {content}
            <FABWide onPress={handleNewSession} />
        </>
    );
});

const PhoneMainViewContent = React.memo(function PhoneMainViewContent({ isTablet }: Readonly<{ isTablet: boolean }>) {
    const { theme } = useUnistyles();

    if (isTablet) {
        const buildPolicyDecision = getFeatureBuildPolicyDecision(SESSION_GETTING_STARTED_GUIDANCE_FEATURE_ID);
        if (buildPolicyDecision !== 'deny') {
            return <SessionGettingStartedGuidance variant="primaryPane" />;
        }
        return (
            <View testID="mainview-tablet-primary-pane-fallback" style={styles.primaryPaneFallback}>
                <Text style={styles.primaryPaneFallbackText}>
                    {t('components.emptyMainScreen.readyToCode')}
                </Text>
            </View>
        );
    }

    return (
        <View style={styles.phoneContainer}>
            <View style={{ backgroundColor: theme.colors.background.canvas }}>
                <Header
                    title={<HeaderTitle />}
                    headerRight={() => <HeaderRight />}
                    headerLeft={() => <HeaderLogo />}
                    headerShadowVisible={false}
                    headerTransparent={true}
                />
            </View>
            <SessionsListWrapper pathname="/" />
        </View>
    );
});

const MainViewLoaded = React.memo(({ variant, isTablet, pathname }: MainViewLoadedProps) => {
    if (variant === 'sidebar') {
        return <SidebarMainViewContent isTablet={isTablet} pathname={pathname} />;
    }
    return <PhoneMainViewContent isTablet={isTablet} />;
});

export const MainView = React.memo((props: MainViewProps) => {
    const pathname = usePathname();
    const isTablet = useIsTablet();
    return <MainViewLoaded {...props} pathname={pathname} isTablet={isTablet} />;
});
