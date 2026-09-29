import { t } from '@/text';
import React from 'react';
import { Pressable, type GestureResponderEvent } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { Icon } from '@/components/ui/icons/Icon';

import { useRecoveryKeyReminder } from '@/hooks/auth/useRecoveryKeyReminder';

export const RecoveryKeyReminderBanner = React.memo(() => {
    const { theme } = useUnistyles();
    const reminder = useRecoveryKeyReminder();
    if (!reminder.visible) return null;
    return (
        <ItemGroup>
            <Item
                testID="recovery-key-reminder"
                title={t('settingsAccount.secretKey')}
                subtitle={t('settingsAccount.backupDescription')}
                icon={<Icon name="key" size={29} color={theme.colors.text.secondary} />}
                onPress={reminder.openBackup}
                showChevron={false}
                rightElement={
                    <Pressable
                        testID="recovery-key-reminder-dismiss"
                        onPress={async (event: GestureResponderEvent) => {
                            event.stopPropagation();
                            await reminder.dismiss();
                        }}
                        hitSlop={12}
                    >
                        <Icon name="x" size={20} color={theme.colors.text.secondary} />
                    </Pressable>
                }
                rightElementOutsidePressable={true}
            />
        </ItemGroup>
    );
});
