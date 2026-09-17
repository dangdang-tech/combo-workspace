import type * as React from 'react';
import type { PersistedSessionMessagePinV1 } from '@/sync/domains/messages/pins/sessionMessagePins';
import type { SessionMessagePinRole } from '@/sync/domains/messages/pins/sessionMessagePinIdentity';
import type { MessagePinAvailability } from '../messageActions/resolveMessagePinAvailability';

export type ToolRowPinAction = Readonly<{
    node: React.ReactNode;
    pinned: boolean;
}>;

/** Shared transcript tool chrome has no pin action in the sharing product. */
export function ToolCallPinAction(_props: Readonly<{
    availability: MessagePinAvailability;
    onTogglePin?: (pin: PersistedSessionMessagePinV1) => void;
    testID?: string;
}>): React.ReactElement | null {
    return null;
}

export function resolveToolRowPinAction(_params: Readonly<{
    sessionId: string;
    seq: number | null | undefined;
    transcriptBlockIndex: number | null | undefined;
    routeMessageId: string | null | undefined;
    role?: SessionMessagePinRole;
    pins?: readonly PersistedSessionMessagePinV1[];
    readOnlyContext?: boolean;
    onTogglePin?: (pin: PersistedSessionMessagePinV1) => void;
    testID: string;
}>): ToolRowPinAction | null {
    return null;
}
