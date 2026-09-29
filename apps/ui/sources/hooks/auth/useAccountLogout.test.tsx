import React from 'react';
import { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderScreen } from '@/dev/testkit';
import { installNavigationShellCommonModuleMocks } from '@/components/navigation/shell/navigationShellTestHelpers';

const state = vi.hoisted(() => ({ logout: vi.fn(), confirm: vi.fn(), replace: vi.fn(), alert: vi.fn() }));
installNavigationShellCommonModuleMocks({
    router: async () => {
        const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
        return createExpoRouterMock({ router: { replace: state.replace } }).module;
    },
    modal: async () => {
        const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
        return createModalModuleMock({ spies: { confirm: state.confirm, alert: state.alert } }).module;
    },
});
// Auth context is the boundary to persisted credentials and server connections.
vi.mock('@/auth/context/AuthContext', () => ({ useAuth: () => ({ logout: state.logout }) }));
let useAccountLogout: typeof import('./useAccountLogout').useAccountLogout;
let current: ReturnType<typeof useAccountLogout>;
function Probe() { current = useAccountLogout(); return null; }

describe('account logout', () => {
    beforeEach(async () => { ({ useAccountLogout } = await import('./useAccountLogout')); vi.clearAllMocks(); state.confirm.mockResolvedValue(true); state.logout.mockResolvedValue(undefined); });
    it('keeps the account when confirmation is cancelled', async () => {
        state.confirm.mockResolvedValue(false);
        await renderScreen(<Probe />);
        await act(async () => { await current.logout(); });
        expect(state.logout).not.toHaveBeenCalled();
        expect(state.replace).not.toHaveBeenCalled();
        expect(current.busy).toBe(false);
    });
    it('returns home only after credentials have been cleared', async () => {
        let finish!: () => void;
        state.logout.mockReturnValue(new Promise<void>(resolve => { finish = resolve; }));
        await renderScreen(<Probe />);
        let pending!: Promise<void>;
        await act(async () => { pending = current.logout(); });
        expect(current.busy).toBe(true);
        expect(state.replace).not.toHaveBeenCalled();
        await act(async () => { finish(); await pending; });
        expect(state.replace).toHaveBeenCalledWith('/');
    });
    it('keeps a failed exit recoverable and prevents duplicate requests', async () => {
        state.logout.mockRejectedValueOnce(new Error('offline'));
        await renderScreen(<Probe />);
        await act(async () => { await Promise.all([current.logout(), current.logout()]); });
        expect(state.logout).toHaveBeenCalledTimes(1);
        expect(state.alert).toHaveBeenCalled();
        expect(state.replace).not.toHaveBeenCalled();
        expect(current.busy).toBe(false);
        await act(async () => { await current.logout(); });
        expect(state.replace).toHaveBeenCalledWith('/');
    });
});
