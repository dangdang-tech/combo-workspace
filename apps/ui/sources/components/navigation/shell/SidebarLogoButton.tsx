import * as React from 'react';
import { Pressable, type StyleProp, type ViewStyle } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { BrandMark } from '@/components/ui/icons/BrandMark';

import { t } from '@/text';

type SidebarLogoButtonProps = Readonly<{
    onPress: () => void;
    style?: StyleProp<ViewStyle>;
    testID?: string;
}>;

export const SidebarLogoButton = React.memo((props: SidebarLogoButtonProps) => {
    const { theme } = useUnistyles();

    return (
        <Pressable
            testID={props.testID}
            onPress={props.onPress}
            hitSlop={15}
            accessibilityRole="button"
            accessibilityLabel={t('common.home')}
            style={props.style}
        >
            <BrandMark color={theme.colors.chrome.header.foreground} />
        </Pressable>
    );
});
