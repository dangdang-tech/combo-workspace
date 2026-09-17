import { describe, expect, it } from 'vitest';

import { normalizeRawMessage } from './normalize';
import { readUnsupportedContentMeta } from '../domains/messages/unsupportedContentMeta';
import { createReducer, reducer } from '../reducer/reducer';

describe('normalizeRawMessage unsupported-content meta marking', () => {
    it('materializes legacy shared context assistant text as a visible transcript message', () => {
        // Producer shape from provisionSharedSession in 4221e0d, before its assistant envelope fix.
        const raw = {
            role: 'agent',
            content: { type: 'text', text: 'ACK COMBO_SHARED_CONTEXT_fixture' },
            meta: { source: 'cli', sentFrom: 'cli' },
        };
        const normalized = normalizeRawMessage('stored-row', 'shared-entry:member-1:context:1', 1000, raw, { seq: 2, messageRole: 'agent' });
        expect(normalized).not.toBeNull();
        const result = reducer(createReducer(), normalized ? [normalized] : []);
        expect(result.messages).toHaveLength(1);
        expect(result.messages[0]).toMatchObject({ kind: 'agent-text', text: raw.content.text, seq: 2 });
        expect(readUnsupportedContentMeta(result.messages[0].meta)).toBeNull();
        expect(raw.content).toEqual({ type: 'text', text: 'ACK COMBO_SHARED_CONTEXT_fixture' });
    });

    it.each([null, 'ordinary-message', 'shared-entry::context:1', 'shared-entry:member-1:context:-1', 'shared-entry:member-1:context:1:extra'])
    ('does not broaden agent text support outside reserved shared context ids (%s)', (localId) => {
        const normalized = normalizeRawMessage('stored-row', localId, 1000, {
            role: 'agent', content: { type: 'text', text: 'unsupported text' },
        });
        expect(readUnsupportedContentMeta(normalized?.meta)).toBe('unparsed-agent-message');
    });

    it('does not reinterpret malformed shared context content as assistant text', () => {
        const normalized = normalizeRawMessage('stored-row', 'shared-entry:member-1:context:1', 1000, {
            role: 'agent', content: { type: 'text', text: { invalid: true } },
        });
        expect(readUnsupportedContentMeta(normalized?.meta)).toBe('unparsed-agent-message');
    });

    it('marks a Zod parse failure for a user record as unparsed-user-message', () => {
        const raw = {
            role: 'user',
            // `content.type` outside the known 'output' | 'event' | 'codex' | 'acp' union fails schema validation.
            content: { type: 'totally-unknown-content-type' },
        };

        const normalized = normalizeRawMessage('msg-1', null, 1000, raw);
        expect(normalized).not.toBeNull();
        if (!normalized) return;
        expect(normalized.role).toBe('user');
        expect(readUnsupportedContentMeta(normalized.meta)).toBe('unparsed-user-message');
    });

    it('marks a Zod parse failure for an agent record as unparsed-agent-message', () => {
        const raw = {
            role: 'agent',
            content: { type: 'totally-unknown-content-type' },
        };

        const normalized = normalizeRawMessage('msg-2', null, 1000, raw);
        expect(normalized).not.toBeNull();
        if (!normalized) return;
        expect(normalized.role).toBe('agent');
        expect(readUnsupportedContentMeta(normalized.meta)).toBe('unparsed-agent-message');
    });

    it('marks an unrecognized output payload as unsupported-agent-output', () => {
        const raw = {
            role: 'agent',
            content: {
                type: 'output',
                data: { type: 'some_future_output_type' },
            },
        };

        const normalized = normalizeRawMessage('msg-3', null, 1000, raw);
        expect(normalized).not.toBeNull();
        if (!normalized) return;
        expect(normalized.role).toBe('agent');
        expect(readUnsupportedContentMeta(normalized.meta)).toBe('unsupported-agent-output');
    });

    it('marks an unrecognized ACP data payload as unsupported-transcript-record', () => {
        const raw = {
            role: 'agent',
            content: {
                type: 'acp',
                provider: 'some-provider',
                data: { type: 'some_future_acp_type' },
            },
        };

        const normalized = normalizeRawMessage('msg-4', null, 1000, raw);
        expect(normalized).not.toBeNull();
        if (!normalized) return;
        expect(normalized.role).toBe('agent');
        expect(readUnsupportedContentMeta(normalized.meta)).toBe('unsupported-transcript-record');
    });
});
