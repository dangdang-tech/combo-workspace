import * as React from 'react';
import { Platform } from 'react-native';
import Svg, { Path } from 'react-native-svg';

export type BrandMarkProps = Readonly<{
    size?: number;
    color: string;
}>;

/** Original COMBO C mark. Callers own its theme and accessible name. */
export const BrandMark = React.memo(function BrandMark({ size = 24, color }: BrandMarkProps) {
    return (
        <Svg
            width={size}
            height={size}
            viewBox="0 0 32 32"
            {...(Platform.OS === 'web' ? { 'aria-hidden': true, focusable: false } : { accessible: false })}
        >
            <Path
                d="M25 8a11.31 11.31 0 1 0 0 16"
                fill="none"
                stroke={color}
                strokeWidth={3}
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </Svg>
    );
});
