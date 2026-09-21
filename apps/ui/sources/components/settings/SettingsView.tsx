import * as React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { BrandWordmark } from '@/components/onboarding/unauthShell/BrandWordmark';
import { Avatar } from '@/components/ui/avatar/Avatar';
import { Icon } from '@/components/ui/icons/Icon';
import { layout } from '@/components/ui/layout/layout';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { ItemList } from '@/components/ui/lists/ItemList';
import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import { useActiveServerSnapshot } from '@/hooks/server/useActiveServerSnapshot';
import { getDisplayName, getAvatarUrl, getBio } from '@/sync/domains/profiles/profile';
import { useProfile } from '@/sync/domains/state/storage';
import { sync } from '@/sync/sync';
import { t } from '@/text';
import { deferOnWeb } from '@/utils/platform/deferOnWeb';
import { navigateWithBlurOnWeb } from '@/utils/platform/navigateWithBlurOnWeb';
import { fireAndForget } from '@/utils/system/fireAndForget';

const stylesheet = StyleSheet.create((theme) => ({
    list: {
        paddingTop: 0,
        backgroundColor: theme.colors.surface.base,
    },
    identityContainer: {
        maxWidth: layout.maxWidth,
        alignSelf: 'center',
        width: '100%',
    },
    identity: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 24,
        paddingHorizontal: 24,
        gap: 16,
    },
    identityText: {
        flex: 1,
        minWidth: 0,
        gap: 4,
    },
    displayName: {
        fontSize: 18,
        color: theme.colors.text.primary,
        ...Typography.default('semiBold'),
    },
    bio: {
        fontSize: 14,
        lineHeight: 20,
        color: theme.colors.text.secondary,
        ...Typography.default(),
    },
    group: {
        borderRadius: 0,
        borderWidth: 0,
        boxShadow: 'none',
        shadowOpacity: 0,
        elevation: 0,
    },
    interactiveRow: {
        minHeight: 48,
    },
}));

export const SettingsView = React.memo(function SettingsView() {
    const { theme } = useUnistyles();
    const styles = stylesheet;
    const router = useRouter();
    const profile = useProfile();
    const { serverUrl } = useActiveServerSnapshot();
    const displayName = getDisplayName(profile);
    const avatarUrl = getAvatarUrl(profile);
    const bio = getBio(profile);
    const pushRoute = React.useCallback((route: Parameters<typeof router.push>[0]) => {
        deferOnWeb(() => {
            navigateWithBlurOnWeb(() => {
                router.push(route);
            });
        });
    }, [router]);

    useFocusEffect(
        React.useCallback(() => {
            fireAndForget(sync.refreshMachinesThrottled({ staleMs: 30_000 }), { tag: 'SettingsView.refreshMachinesThrottled' });
        }, [])
    );

    return (
        <ItemList style={styles.list}>
            <View style={styles.identityContainer}>
                <View style={styles.identity}>
                    {profile.firstName ? (
                        // Signed-in profile
                        <>
                            <Avatar
                                id={profile.id}
                                size={48}
                                imageUrl={avatarUrl}
                                thumbhash={profile.avatar?.thumbhash}
                            />
                            <View style={styles.identityText}>
                                <Text style={styles.displayName}>
                                    {displayName}
                                </Text>
                                {bio && (
                                    <Text style={styles.bio}>
                                        {bio}
                                    </Text>
                                )}
                            </View>
                        </>
                    ) : (
                        // Product identity
                        <>
                            <BrandWordmark height={24} />
                        </>
                    )}
                </View>
            </View>

            <ItemGroup title={t('settings.profileAndAccount')} containerStyle={styles.group}>
                <Item
                    title={t('settings.account')}
                    style={styles.interactiveRow}
                    subtitle={t('settings.accountSubtitle')}
                    icon={<Icon name="user-circle" size={22} color={theme.colors.text.secondary} />}
                    onPress={() => router.push('/settings/account')}
                />
                <Item
                    title={t('settings.machines')}
                    style={styles.interactiveRow}
                    icon={<Icon name="desktop" size={22} color={theme.colors.text.secondary} />}
                    onPress={() => pushRoute('/settings/machines')}
                />
            </ItemGroup>
            <ItemGroup containerStyle={styles.group}>
                <Item
                    title={t('systemStatus.sections.currentServer')}
                    subtitle={serverUrl}
                    mode="info"
                    showChevron={false}
                />
            </ItemGroup>
        </ItemList>
    );
});
