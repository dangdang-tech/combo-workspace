import * as React from 'react';
import { View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { BrandMark } from '@/components/ui/icons/BrandMark';
import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';

export type BrandWordmarkProps = Readonly<{
    /** Mark height in px. The localized wordmark can wrap at larger text sizes. */
    height?: number;
    testID?: string;
}>;

/** Shared, localized product wordmark for welcome and account surfaces. */
export const BrandWordmark = React.memo(function BrandWordmark(props: BrandWordmarkProps) {
    const { theme } = useUnistyles();
    const height = props.height ?? 32;
    const styles = stylesheet;
    return (
        <View
            testID={props.testID ?? 'brand-wordmark'}
            style={styles.wordmark}
        >
            <BrandMark size={height} color={theme.colors.accent.blue} />
            <Text style={[styles.name, { fontSize: Math.round(height * 0.75), lineHeight: height }]}>
                {t('brand.name')}
            </Text>
        </View>
    );
});

const stylesheet = StyleSheet.create((theme) => ({
    wordmark: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        maxWidth: '100%',
    },
    name: {
        ...Typography.logo(),
        color: theme.colors.text.primary,
        flexShrink: 1,
    },
}));
