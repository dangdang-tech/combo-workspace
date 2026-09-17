import * as React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useUnistyles } from 'react-native-unistyles';

import { BrandWordmark } from '@/components/onboarding/unauthShell/BrandWordmark';
import { Avatar } from '@/components/ui/avatar/Avatar';
import { Icon } from '@/components/ui/icons/Icon';
import { layout } from '@/components/ui/layout/layout';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { ItemList } from '@/components/ui/lists/ItemList';
import { Text } from '@/components/ui/text/Text';
import { useActiveServerSnapshot } from '@/hooks/server/useActiveServerSnapshot';
import { getDisplayName, getAvatarUrl, getBio } from '@/sync/domains/profiles/profile';
import { useProfile } from '@/sync/domains/state/storage';
import { sync } from '@/sync/sync';
import { t } from '@/text';
import { deferOnWeb } from '@/utils/platform/deferOnWeb';
import { navigateWithBlurOnWeb } from '@/utils/platform/navigateWithBlurOnWeb';
import { fireAndForget } from '@/utils/system/fireAndForget';

export const SettingsView = React.memo(function SettingsView() {
    const { theme } = useUnistyles();
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
        <ItemList style={{ paddingTop: 0 }}>
            <View style={{ maxWidth: layout.maxWidth, alignSelf: 'center', width: '100%' }}>
                <View style={{ alignItems: 'center', paddingVertical: 24, backgroundColor: theme.colors.surface.base, marginTop: 16, borderRadius: 12, marginHorizontal: 16 }}>
                    {profile.firstName ? (
                        // Signed-in profile
                        <>
                            <View style={{ marginBottom: 12 }}>
                                <Avatar
                                    id={profile.id}
                                    size={90}
                                    imageUrl={avatarUrl}
                                    thumbhash={profile.avatar?.thumbhash}
                                />
                            </View>
                            <Text style={{ fontSize: 20, fontWeight: '600', color: theme.colors.text.primary, marginBottom: bio ? 4 : 8 }}>
                                {displayName}
                            </Text>
                            {bio && (
                                <Text style={{ fontSize: 14, color: theme.colors.text.secondary, textAlign: 'center', marginBottom: 8, paddingHorizontal: 16 }}>
                                    {bio}
                                </Text>
                            )}
                        </>
                    ) : (
                        // Product identity
                        <>
                            <BrandWordmark height={40} />
                        </>
                    )}
                </View>
            </View>

            <ItemGroup title={t('settings.profileAndAccount')}>
                <Item
                    title={t('settings.account')}
                    subtitle={t('settings.accountSubtitle')}
                    icon={<Icon name="user-circle" size={29} color={theme.colors.accent.blue} />}
                    onPress={() => router.push('/settings/account')}
                />
                <Item
                    title={t('settings.machines')}
                    icon={<Icon name="desktop" size={29} color={theme.colors.accent.orange} />}
                    onPress={() => pushRoute('/settings/machines')}
                />
            </ItemGroup>
            <ItemGroup>
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
