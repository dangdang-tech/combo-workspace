import * as React from 'react';
import { Pressable, View } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { DropdownMenu } from '@/components/ui/forms/dropdown/DropdownMenu';
import { Avatar } from '@/components/ui/avatar/Avatar';
import { Icon } from '@/components/ui/icons/Icon';
import { Text } from '@/components/ui/text/Text';
import { useChromeSafeAreaInsets } from '@/components/ui/layout/useChromeSafeAreaInsets';
import { useProfile } from '@/sync/domains/state/storage';
import { getAvatarUrl, getDisplayName } from '@/sync/domains/profiles/profile';
import { useAccountLogout } from '@/hooks/auth/useAccountLogout';
import { runGuardedNavigation } from '@/utils/navigation/runGuardedNavigation';
import { fireAndForget } from '@/utils/system/fireAndForget';
import { t } from '@/text';

const styles = StyleSheet.create((theme) => ({
    footer: { flexShrink: 0, backgroundColor: theme.colors.surface.inset,
        borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border.subtle,
        padding: theme.margins.sm },
    trigger: { minHeight: 44, flexDirection: 'row', alignItems: 'center',
        gap: theme.margins.sm, borderRadius: 12, paddingHorizontal: theme.margins.sm },
    compact: { justifyContent: 'center', paddingHorizontal: 0 },
    label: { flex: 1, minWidth: 0, color: theme.colors.text.primary },
    active: { backgroundColor: theme.colors.surface.pressed },
}));

export const AccountMenu = React.memo(function AccountMenu({ compact = false }: { compact?: boolean }) {
    const { theme } = useUnistyles();
    const profile = useProfile();
    const router = useRouter();
    const pathname = usePathname();
    const safeArea = useChromeSafeAreaInsets();
    const { logout, busy } = useAccountLogout();
    const [open, setOpen] = React.useState(false);
    React.useEffect(() => setOpen(false), [pathname, compact]);
    const displayName = getDisplayName(profile) || t('settings.account');
    const navigate = (route: string) => {
        const result = runGuardedNavigation(() => router.push(route));
        if (result !== true) fireAndForget(result, { tag: 'AccountMenu.navigate' });
    };
    return <View testID="navigation-account-footer" style={[styles.footer, { paddingBottom: Math.max(safeArea.bottom, theme.margins.sm) }]}>
        <DropdownMenu open={open} onOpenChange={setOpen} placement="top"
            matchTriggerWidth={false} maxWidthCap={280}
            items={[
                { id: 'account', testID: 'account-menu-settings', title: t('settings.account'), icon: <Icon name="user-circle" size={20} color={theme.colors.text.primary} /> },
                { id: 'settings', testID: 'account-menu-preferences', title: t('settings.title'), icon: <Icon name="sliders-horizontal" size={20} color={theme.colors.text.primary} /> },
                { id: 'logout', testID: 'account-menu-logout', title: t('common.logout'), disabled: busy, icon: <Icon name="sign-out" size={20} color={theme.colors.state.danger.foreground} /> },
            ]}
            onSelect={(id) => {
                if (id === 'logout') void logout();
                else navigate(id === 'account' ? '/settings/account' : '/settings');
            }}
            trigger={({ toggle }) => <Pressable testID="navigation-account-menu" onPress={toggle}
                accessibilityRole="button" accessibilityLabel={t('settings.account')}
                accessibilityState={{ expanded: open, disabled: busy }} disabled={busy}
                style={({ pressed }) => [styles.trigger, compact && styles.compact, (pressed || open) && styles.active]}>
                {profile.id ? <Avatar id={profile.id} size={28} imageUrl={getAvatarUrl(profile)} thumbhash={profile.avatar?.thumbhash} />
                    : <Icon name="user-circle" size={24} color={theme.colors.text.primary} />}
                {!compact && <><Text numberOfLines={1} style={styles.label}>{displayName}</Text><Icon name="caret-up" size={16} color={theme.colors.text.secondary} /></>}
            </Pressable>} />
    </View>;
});
