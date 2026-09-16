import * as React from 'react';
import { Platform } from 'react-native';
import Svg, { Path } from 'react-native-svg';

export type BrandMarkProps = Readonly<{
    size?: number;
    color: string;
}>;

/** Original interlocking D monogram. Callers own its theme and accessible name. */
export const BrandMark = React.memo(function BrandMark({ size = 24, color }: BrandMarkProps) {
    return (
        <Svg
            width={size}
            height={size}
            viewBox="0 0 32 32"
            {...(Platform.OS === 'web' ? { 'aria-hidden': true, focusable: false } : { accessible: false })}
        >
            <Path
                d="M4 6h5a10 10 0 0 1 0 20H4V6Z M19 6h1a10 10 0 0 1 0 20h-1V6Z"
                fill="none"
                stroke={color}
                strokeWidth={3}
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </Svg>
    );
});
