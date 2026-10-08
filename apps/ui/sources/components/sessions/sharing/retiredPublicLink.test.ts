import fs from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';

it('does not build retired public-share URL templates in source files', () => {
    const sourceRoot = path.resolve(__dirname, '../../..');
    const offenders: string[] = [];
    function scan(directory: string) {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            const filePath = path.join(directory, entry.name);
            if (entry.isDirectory()) {
                if (entry.name !== '__tests__') scan(filePath);
            } else if (entry.isFile() && /\.[cm]?[jt]sx?$/.test(entry.name) && !/\.(test|spec)\./.test(entry.name)) {
                if (/\/share\/\$\{/.test(fs.readFileSync(filePath, 'utf8'))) {
                    offenders.push(path.relative(sourceRoot, filePath));
                }
            }
        }
    }
    scan(sourceRoot);
    expect(offenders).toEqual([]);
});
