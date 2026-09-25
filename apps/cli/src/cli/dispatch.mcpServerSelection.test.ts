import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { createEnvKeyScope } from '@/testkit/env/envScope';
import { withTempDir } from '@/testkit/fs/tempDir';

const boundary = vi.hoisted(() => ({
  readCredentials: vi.fn(),
  bootstrapAccountSettingsContext: vi.fn(),
  ensureMachineIdForCredentials: vi.fn(async () => ({ machineId: 'fixture-machine' })),
  createExternalMcpServer: vi.fn(() => ({ mcp: {}, toolNames: [] })),
  connectMcpStdio: vi.fn(async () => {}),
}));

// Keep dispatch, the command registry, MCP handler, server selection, and config real.
// Stop only at credential/network/stdio boundaries; no real account is loaded.
vi.mock('@/cli/commands/mcp/deps', () => ({
  resolveMcpCommandDeps: () => boundary,
}));

import { dispatchCli } from './dispatch';
import { configuration, reloadConfiguration } from '@/configuration';
import { addServerProfile } from '@/server/serverProfiles';
import { deriveServerIdFromUrl } from '@/server/serverId';
import { disableMcpStdioConsolePatch } from '@/mcp/server/mcpStdioConsolePatch';

const selectionKeys = [
  'HAPPIER_SERVER_URL', 'HAPPIER_LOCAL_SERVER_URL', 'HAPPIER_PUBLIC_SERVER_URL',
  'HAPPIER_WEBAPP_URL', 'HAPPIER_ACTIVE_SERVER_ID',
] as const;
const envScope = createEnvKeyScope(['HAPPIER_HOME_DIR', ...selectionKeys]);
const credentials = { token: 'fixture-token', encryption: { type: 'legacy', secret: new Uint8Array(32) } };

function readSelection() {
  return {
    serverUrl: configuration.serverUrl,
    apiServerUrl: configuration.apiServerUrl,
    webappUrl: configuration.webappUrl,
    activeServerId: configuration.activeServerId,
  };
}

async function dispatchMcp(args: string[]) {
  await dispatchCli({ args, rawArgv: ['happier', ...args], terminalRuntime: null });
  expect(boundary.connectMcpStdio).toHaveBeenCalledTimes(1);
}

async function withSavedHome(run: (home: string, saved: ReturnType<typeof readSelection>) => Promise<void>) {
  await withTempDir('happier-mcp-selection-', async (home) => {
    envScope.patch({ HAPPIER_HOME_DIR: home, ...Object.fromEntries(selectionKeys.map((key) => [key, undefined])) });
    reloadConfiguration();
    await addServerProfile({ name: 'saved', serverUrl: 'https://saved.example.test', webappUrl: 'https://saved-ui.example.test', use: true });
    reloadConfiguration();
    const saved = readSelection();
    await run(home, saved);
  });
}

function contaminateAmbientSelection() {
  envScope.patch({
    HAPPIER_SERVER_URL: 'https://ambient.example.test',
    HAPPIER_LOCAL_SERVER_URL: 'http://ambient-local.example.test',
    HAPPIER_PUBLIC_SERVER_URL: 'https://ambient-public.example.test',
    HAPPIER_WEBAPP_URL: 'https://ambient-ui.example.test',
    HAPPIER_ACTIVE_SERVER_ID: 'ambient',
  });
}

describe('dispatch → MCP serve server selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    boundary.readCredentials.mockImplementation(async () => credentials);
    boundary.bootstrapAccountSettingsContext.mockImplementation(async () => ({ settings: { actionsSettingsV1: null } }));
  });

  afterEach(() => {
    disableMcpStdioConsolePatch();
    envScope.restore();
    reloadConfiguration();
  });

  it('uses explicit URL flags for credentials and settings without persisting them', async () => {
    await withSavedHome(async (home) => {
      const before = await readFile(join(home, 'settings.json'), 'utf8');
      contaminateAmbientSelection();
      const observed: ReturnType<typeof readSelection>[] = [];
      boundary.readCredentials.mockImplementation(async () => { observed.push(readSelection()); return credentials; });
      boundary.bootstrapAccountSettingsContext.mockImplementation(async () => { observed.push(readSelection()); return { settings: { actionsSettingsV1: null } }; });

      await dispatchMcp(['--server-url', 'https://selected.example.test/', '--webapp-url', 'https://selected-ui.example.test/', 'mcp', 'serve']);

      const selected = {
        serverUrl: 'https://selected.example.test', apiServerUrl: 'https://selected.example.test',
        webappUrl: 'https://selected-ui.example.test', activeServerId: deriveServerIdFromUrl('https://selected.example.test'),
      };
      expect(observed).toEqual([selected, selected]);
      expect(await readFile(join(home, 'settings.json'), 'utf8')).toBe(before);
    });
  });

  it('retains an explicitly selected profile and local API through the bridge alias', async () => {
    await withSavedHome(async (home) => {
      const profile = await addServerProfile({ name: 'selected', serverUrl: 'https://selected.example.test', localServerUrl: 'http://127.0.0.1:49321', webappUrl: 'https://selected-ui.example.test' });
      const before = await readFile(join(home, 'settings.json'), 'utf8');
      contaminateAmbientSelection();
      let credentialSelection: ReturnType<typeof readSelection> | undefined;
      boundary.readCredentials.mockImplementation(async () => { credentialSelection = readSelection(); return credentials; });

      await dispatchMcp(['--server', profile.id, 'bridge', 'serve']);

      expect(credentialSelection).toEqual({ serverUrl: profile.serverUrl, apiServerUrl: profile.localServerUrl, webappUrl: profile.webappUrl, activeServerId: profile.id });
      expect(await readFile(join(home, 'settings.json'), 'utf8')).toBe(before);
    });
  });

  it('still ignores ambient selection and uses the saved profile when flags are absent', async () => {
    await withSavedHome(async (_home, saved) => {
      contaminateAmbientSelection();
      let credentialSelection: ReturnType<typeof readSelection> | undefined;
      boundary.readCredentials.mockImplementation(async () => { credentialSelection = readSelection(); return credentials; });

      await dispatchMcp(['mcp', 'serve']);

      expect(credentialSelection).toEqual(saved);
      for (const key of selectionKeys) expect(process.env[key]).toBeUndefined();
    });
  });
});
