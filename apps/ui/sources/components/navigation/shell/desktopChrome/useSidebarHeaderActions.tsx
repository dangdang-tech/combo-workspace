import { useRouter } from 'expo-router';
import * as React from 'react';
import { View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { t } from '@/text';
import type { ItemAction } from '@/components/ui/lists/itemActions';
import { runGuardedNavigation } from '@/utils/navigation/runGuardedNavigation';
import { fireAndForget } from '@/utils/system/fireAndForget';
import { desktopSidebarChromeStyles } from './desktopSidebarChromeStyles';
import { Icon, ICON_SIZE } from '@/components/ui/icons/Icon';
import {
    shouldForceFreshNewSessionEntryFromPressEvent,
    useResolveNewSessionOrdinaryEntryRoute,
} from '@/components/sessions/new/navigation/newSessionOrdinaryEntryRoute';

type SidebarHeaderActionsResult = Readonly<{
    headerActions: ItemAction[];
    topUtilityActions: ItemAction[];
    renderHeaderOverflowVisual: () => React.ReactNode;
}>;

export function useSidebarHeaderActions(): SidebarHeaderActionsResult {
    const styles = desktopSidebarChromeStyles;
    const { theme } = useUnistyles();
    const router = useRouter();
    const resolveNewSessionOrdinaryEntryRoute = useResolveNewSessionOrdinaryEntryRoute();

    const navigate = React.useCallback((pathname: string, tag: string) => {
        const result = runGuardedNavigation(() => router.push(pathname));
        if (result !== true) {
            fireAndForget(result, { tag });
        }
    }, [router]);
    const navigateToNewSession = React.useCallback((event?: unknown) => {
        const { draftId, draftOrigin } = resolveNewSessionOrdinaryEntryRoute({
            forceFresh: shouldForceFreshNewSessionEntryFromPressEvent(event),
        });
        const result = runGuardedNavigation(() => router.push({
            pathname: '/new',
            params: { draftId, draftOrigin },
        }));
        if (result !== true) {
            fireAndForget(result, { tag: 'SidebarView.nav.newSession' });
        }
    }, [resolveNewSessionOrdinaryEntryRoute, router]);

    const headerActions = React.useMemo((): ItemAction[] => {
        const out: ItemAction[] = [];

        out.push({
            id: 'settings',
            title: t('settings.title'),
            inlineTestID: 'nav-settings',
            icon: (
                <View style={styles.iconButton}>
                    <Icon name="sliders-horizontal" size={ICON_SIZE.md} color={theme.colors.chrome.header.foreground} />
                </View>
            ),
            onPress: () => navigate('/settings', 'SidebarView.nav.settings'),
        });

        out.push({
            id: 'newSession',
            title: t('newSession.title'),
            inlineTestID: 'nav-new-session',
            icon: (
                <View style={styles.trailingIconButton}>
                    <Icon name="plus" size={ICON_SIZE.md} color={theme.colors.chrome.header.foreground} />
                </View>
            ),
            onPress: navigateToNewSession,
        });

        return out;
    }, [
        navigate,
        navigateToNewSession,
        styles.iconButton,
        styles.trailingIconButton,
        theme.colors.chrome.header.foreground,
    ]);

    const topUtilityActions = React.useMemo((): ItemAction[] => {
        const out: ItemAction[] = [];

        out.push({
            id: 'settings',
            title: t('settings.title'),
            inlineTestID: 'nav-settings',
            icon: 'sliders-horizontal' as const,
            onPress: () => navigate('/settings', 'SidebarView.nav.settings'),
        });

        return out;
    }, [navigate]);

    const renderHeaderOverflowVisual = React.useCallback(() => {
        return (
            <View style={[styles.iconButton, styles.notificationButton]}>
                <Icon name="dots-three" size={ICON_SIZE.md} color={theme.colors.chrome.header.foreground} />
            </View>
        );
    }, [
        styles.iconButton,
        styles.notificationButton,
        theme.colors.chrome.header.foreground,
    ]);

    return {
        headerActions,
        topUtilityActions,
        renderHeaderOverflowVisual,
    };
}
