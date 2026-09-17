import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderScreen, standardCleanup } from '@/dev/testkit';
import type { MessagePinAvailability } from '../messageActions/resolveMessagePinAvailability';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const platformState = vi.hoisted(() => ({
    os: 'web',
}));

const iconCalls = vi.hoisted(() => [] as Array<{ name: string; color: string; size: number }>);

function available(overrides: Partial<Extract<MessagePinAvailability, { status: 'available' }>> = {}): Extract<MessagePinAvailability, { status: 'available' }> {
    return {
        status: 'available',
        pinned: false,
        identityKey: 'route-message-id|s1|tool:call-1|block:2|tool',
        pinTarget: {
            version: 1,
            sessionId: 's1',
            seq: 5,
            transcriptBlockIndex: 2,
            routeMessageId: 'tool:call-1',
            role: 'tool',
            label: null,
        },
        ...overrides,
    };
}

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({
        Platform: {
            get OS() {
                return platformState.os;
            },
            select: (values: Record<string, unknown>) => values[platformState.os] ?? values.default,
        },
    });
});

vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock({
        theme: {
            colors: {
                text: { secondary: '#555555' },
                state: {
                    active: { foreground: '#0b7a75', background: '#ddf5f3' },
                    neutral: { background: '#eeeeee' },
                },
            },
        },
    });
});

vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock({ translate: (key) => key });
});

vi.mock('@/components/sessions/shell/sessionPinIcons', () => ({
    PinIcon: (props: { color: string; size: number }) => {
        iconCalls.push({ name: 'push-pin', color: props.color, size: props.size });
        return React.createElement('PinIcon', props);
    },
    PinSlashIcon: (props: { color: string; size: number }) => {
        iconCalls.push({ name: 'push-pin-slash', color: props.color, size: props.size });
        return React.createElement('PinSlashIcon', props);
    },
}));

describe('ToolCallPinAction', () => {
    afterEach(() => {
        iconCalls.length = 0;
        platformState.os = 'web';
        standardCleanup();
    });

    it.each([
        ['web', false], ['web', true], ['ios', false], ['ios', true],
    ] as const)('omits tool pin presentation on %s even with pinned=%s and a callback', async (os, pinned) => {
        platformState.os = os;
        const { ToolCallPinAction, resolveToolRowPinAction } = await import('./ToolCallPinAction');
        const onTogglePin = vi.fn();
        const availability = available({ pinned });
        const screen = await renderScreen(<ToolCallPinAction availability={availability} onTogglePin={onTogglePin} testID="tool-pin" />);
        expect(screen.findAllByType('Pressable' as React.ElementType)).toHaveLength(0);
        expect(resolveToolRowPinAction({
            sessionId: 's1', seq: 5, transcriptBlockIndex: 2, routeMessageId: 'tool:call-1',
            pins: pinned ? [{ ...availability.pinTarget, pinnedAtMs: 1 }] : [],
            onTogglePin, testID: 'tool-pin',
        })).toBeNull();
        expect(onTogglePin).not.toHaveBeenCalled();
    });
});
