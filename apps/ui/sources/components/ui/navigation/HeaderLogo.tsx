import * as React from 'react';
import { View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { BrandMark } from '@/components/ui/icons/BrandMark';

/**
 * Shared header logo component used across all main tabs.
 * Extracted to prevent flickering on tab switches - when each tab
 * had its own HeaderLeft, the component would unmount/remount.
 */
export const HeaderLogo = React.memo(() => {
    const { theme } = useUnistyles();
    return (
        <View style={{
            width: 32,
            height: 32,
            alignItems: 'center',
            justifyContent: 'center',
        }}>
            <BrandMark color={theme.colors.accent.blue} />
        </View>
    );
});
