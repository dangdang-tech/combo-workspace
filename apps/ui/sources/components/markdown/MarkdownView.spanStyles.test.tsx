import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderScreen } from '@/dev/testkit';
import { flattenTestStyle } from '@/dev/testkit/harness/popoverHarness';
import { lightTheme } from '@/theme';


declare global {
    // eslint-disable-next-line no-var
    var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('./MermaidRenderer', () => ({
    MermaidRenderer: () => null,
}));

describe('MarkdownView (span styles)', () => {
    it('passes bold/italic/code typography through the enriched markdown style contract', async () => {
        const { MarkdownView } = await import('./MarkdownView');

        const markdown = '**Exploring Reasoning Options** *Considering tools* `git diff`';
        const textStyle = {
            fontStyle: 'italic' as const,
            fontSize: 14,
            lineHeight: 20,
            color: 'rgb(120, 120, 120)',
            marginTop: 0,
            marginBottom: 0,
        };

        const screen = await renderScreen(<MarkdownView markdown={markdown} profile="transcript" textStyle={textStyle} />);

        const enrichedRun = screen.findByType('EnrichedMarkdownText');
        const markdownStyle = enrichedRun.props.markdownStyle;

        expect(markdownStyle.strong.fontFamily).toBe('Inter-SemiBold');
        expect(markdownStyle.em.fontFamily).toBe('Inter-Italic');
        expect(markdownStyle.code.fontFamily).toBe('IBMPlexMono-Regular');
        expect(markdownStyle.code.fontSize).toBeLessThan(markdownStyle.paragraph.fontSize);
        expect(markdownStyle.code.color).toBe(lightTheme.colors.text.primary);
        expect(markdownStyle.code.borderColor).toBe('transparent');
        expect(markdownStyle.inlineMath.color).toBe(markdownStyle.paragraph.color);
        expect(markdownStyle.math.fontSize).toBe(markdownStyle.paragraph.fontSize);
        expect(markdownStyle.math.color).toBe(markdownStyle.paragraph.color);
        expect(markdownStyle.math.backgroundColor).toBe('transparent');
        expect(markdownStyle.list.marginLeft).toBeGreaterThan(0);
        expect(markdownStyle.paragraph.marginTop).toBe(0);
        expect(markdownStyle.paragraph.marginBottom).toBe(8);
        expect(markdownStyle.paragraph.lineHeight).toBe(20);
        expect(markdownStyle.h2.fontSize).toBeGreaterThan(markdownStyle.paragraph.fontSize);
        expect(markdownStyle.h2.marginTop).toBe(16);
        expect(markdownStyle.h2.marginBottom).toBe(8);
        expect(markdownStyle.math.marginTop).toBe(8);
        expect(markdownStyle.math.marginBottom).toBe(8);
    }, 60_000);

    it.each(['default', 'thinking'] as const)('keeps legacy %s list links and markers on the bubble foreground while pairing inline code with its own surface', async (variant) => {
        const { MarkdownBlockView } = await import('./MarkdownBlockView');
        const foreground = lightTheme.colors.message.user.foreground;
        const screen = await renderScreen(<MarkdownBlockView
            block={{ type: 'list', items: [{ depth: 0, spans: [
                { text: 'link', url: 'https://example.com', styles: [] },
                { text: 'command', url: null, styles: ['code'] },
            ] }] }}
            first last selectable
            onLinkPress={() => {}}
            textStyle={{ color: foreground }}
            profile={variant === 'thinking' ? 'thinking' : 'transcript'}
            variant={variant}
            streamingReveal={false}
            agentTexMath={false}
        />);
        const text = (value: string) => screen.findAllByType('Text').find((node) => node.props.children === value)!;
        expect(flattenTestStyle(text('link').props.style).color).toBe(foreground);
        expect(flattenTestStyle(text('link').props.style).textDecorationLine).toBe('underline');
        expect(flattenTestStyle(screen.findByTestId('markdown-list-item-marker')?.props.style).color).toBe(foreground);
        expect(flattenTestStyle(text('command').props.style).color).toBe(variant === 'thinking' ? foreground : lightTheme.colors.text.primary);
    });

    it('pairs option-card text with the option surface while preserving caller text metrics', async () => {
        const { MarkdownBlockView } = await import('./MarkdownBlockView');
        const screen = await renderScreen(<MarkdownBlockView
            block={{ type: 'options', items: ['Option'] }}
            first last selectable
            textStyle={{ color: lightTheme.colors.message.user.foreground, fontSize: 18 }}
            profile="transcript"
            variant="default"
            streamingReveal={false}
            agentTexMath={false}
        />);
        const option = screen.findAllByType('Text').find((node) => node.props.children === 'Option')!;
        expect(flattenTestStyle(option.props.style).color).toBe(lightTheme.colors.text.primary);
        expect(flattenTestStyle(option.props.style).fontSize).toBe(18);
    });
});
