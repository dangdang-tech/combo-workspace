import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const appRoot = path.resolve(__dirname, '../app');
const redirectPath = path.resolve(__dirname, '../components/navigation/root/RemovedFeatureRoute.tsx');
// Exercise Metro's consumed config; only the filesystem resolution boundary is supplied.
const config = require('../../metro.config.js');
const { resolve: metroResolve } = require('metro-resolver');
const { getContextModuleTemplate } = require('metro/private/lib/contextModuleTemplates');

function realFileContext() {
    return {
        originModulePath: path.join(appRoot, '_ctx.js'),
        resolveRequest: metroResolve,
        assetExts: new Set(config.resolver.assetExts),
        sourceExts: config.resolver.sourceExts,
        mainFields: config.resolver.resolverMainFields,
        preferNativePlatform: false,
        getPackageForModule: () => null,
        doesFileExist: fs.existsSync,
        fileSystemLookup: (filePath: string) => {
            if (!fs.existsSync(filePath)) return { exists: false };
            return { exists: true, type: fs.statSync(filePath).isDirectory() ? 'd' : 'f', realPath: fs.realpathSync(filePath) };
        },
    };
}

function resolveRoute(relativePath: string, platform: string) {
    const filePath = path.join(appRoot, relativePath);
    return config.resolver.resolveRequest({
        originModulePath: path.join(appRoot, '_ctx.js'),
        resolveRequest: () => ({ type: 'sourceFile', filePath }),
    }, `./${relativePath}`, platform);
}

describe('Metro core sharing route dependencies', () => {
    it('keeps real context URL keys while resolving obsolete modules to the redirect', () => {
        const removed = '(app)/settings/features.tsx';
        const shared = '(app)/session/[id]/entry-sharing.tsx';
        const routes = [removed, shared, '_layout.tsx'];
        const module = { exports: {} as ((key: string) => string) & { keys: () => string[] } };
        vm.runInNewContext(getContextModuleTemplate('sync', appRoot, routes.map(route => path.join(appRoot, route))), {
            module,
            require: (absolutePath: string) => config.resolver.resolveRequest(realFileContext(), absolutePath, 'web').filePath,
        });
        expect(module.exports.keys().sort()).toEqual(routes.map(route => `./${route}`).sort());
        expect(module.exports(`./${removed}`)).toBe(redirectPath);
        expect(module.exports(`./${shared}`)).toBe(path.join(appRoot, shared));
        expect(module.exports('./_layout.tsx')).toBe(path.join(appRoot, '_layout.tsx'));
    });

    it('preserves the real native intent entrypoint through Metro filesystem resolution', () => {
        const filePath = path.join(appRoot, '+native-intent.tsx');
        expect(config.resolver.resolveRequest(realFileContext(), filePath, 'ios')).toEqual({ type: 'sourceFile', filePath });
    });

    it.each(['web', 'ios', 'android'])('replaces removed route implementations with a home redirect on %s', (platform) => {
        for (const route of [
            '(app)/automations/index.tsx', '(app)/dev/index.tsx', '(app)/inbox/index.tsx',
            '(app)/settings/voice.tsx', '(app)/settings/prompts/_layout.tsx',
            '(app)/session/[id]/files.tsx', '(app)/session/[id]/sharing.tsx',
            '(app)/new/pick/profile.tsx', '(app)/desktop/pet-overlay.tsx',
        ]) {
            expect(resolveRoute(route, platform), route).toEqual({ type: 'sourceFile', filePath: redirectPath });
        }
        expect(fs.existsSync(redirectPath)).toBe(true);
    });

    it.each(['web', 'ios', 'android'])('preserves core screens, layouts and intent entrypoints on %s', (platform) => {
        for (const route of [
            '_layout.tsx', '+native-intent.tsx', '+not-found.tsx', '(app)/_layout.tsx',
            '(app)/index.tsx', '(app)/settings/_layout.tsx', '(app)/setup/_layout.tsx',
            '(app)/new/index.tsx', '(app)/new/pick/machine.tsx', '(app)/new/pick/path.tsx',
            '(app)/settings/account.tsx', '(app)/settings/machines/add.tsx',
            '(app)/machine/[id].tsx', '(app)/session/[id]/index.tsx',
            '(app)/session/[id]/entry-sharing.tsx', '(app)/session/[id]/message/[messageId].tsx',
            '(app)/invite/[token].tsx', '(app)/oauth/[provider].tsx',
            '(app)/restore/lost-access.tsx', '(app)/terminal/connect.tsx',
        ]) {
            expect(resolveRoute(route, platform), route).toEqual({ type: 'sourceFile', filePath: path.join(appRoot, route) });
        }
    });

    it('keeps shared components outside the route tree available', () => {
        const filePath = path.resolve(__dirname, '../components/sessions/SessionView.tsx');
        expect(config.resolver.resolveRequest({
            resolveRequest: () => ({ type: 'sourceFile', filePath }),
        }, './SessionView', 'web')).toEqual({ type: 'sourceFile', filePath });
    });
});
