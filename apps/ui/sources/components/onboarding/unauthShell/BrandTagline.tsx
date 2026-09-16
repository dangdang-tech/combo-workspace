import * as React from 'react';
import { View } from 'react-native';

import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';

import { useBrandPaneTokens } from './brandPaneTokens';

export type BrandTaglineProps = Readonly<{
    /** Apply tighter sizing for the mobile brand hero variant. */
    mobile?: boolean;
}>;

/** Shared-project headline using the existing scalable display treatment. */
export const BrandTagline = React.memo(function BrandTagline(props: BrandTaglineProps) {
    const tokens = useBrandPaneTokens();
    const baseSize = props.mobile ? 44 : 48;
    const baseStyle = {
        ...Typography.default('semiBold'),
        fontSize: baseSize,
        lineHeight: baseSize * 1.22,
    } as const;
    return (
        <View testID="brand-tagline" accessibilityRole="header">
            <Text style={[baseStyle, { color: tokens.foreground }]}>
                {t('welcome.brandTaglineLine1')}
            </Text>
            <Text style={[baseStyle, { color: tokens.accent }]}>
                {t('welcome.brandTaglineLine2')}
            </Text>
        </View>
    );
});
