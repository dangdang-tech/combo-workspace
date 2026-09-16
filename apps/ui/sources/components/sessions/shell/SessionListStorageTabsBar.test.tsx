import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderScreen } from '@/dev/testkit';
import { installNavigationCommonModuleMocks } from '@/components/ui/navigation/navigationTestHelpers';
import { SessionListStorageTabsBar } from './SessionListStorageTabsBar';

installNavigationCommonModuleMocks();

describe('SessionListStorageTabsBar', () => {
    it('labels managed sessions with the product brand while preserving storage selection IDs', async () => {
        const onSelectTab = vi.fn();
        const screen = await renderScreen(<SessionListStorageTabsBar activeTabId="direct" onSelectTab={onSelectTab} />);
        const managedTab = screen.findByTestId('sessions-list-storage-tab:persisted');

        expect(managedTab?.findByType('Text' as never).props.children).toBe('brand.name');
        await screen.pressByTestIdAsync('sessions-list-storage-tab:persisted');
        expect(onSelectTab).toHaveBeenCalledWith('persisted');
        await screen.pressByTestIdAsync('sessions-list-storage-tab:direct');
        expect(onSelectTab).toHaveBeenCalledWith('direct');
    });
});
