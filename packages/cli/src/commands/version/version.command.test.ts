import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi, MockInstance } from 'vitest';

import { VersionCommand } from './version.command.ts';

describe('VersionCommand', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('prints the version from this package\'s own package.json', async () => {
        // eslint-disable-next-line typescript/no-unsafe-assignment
        const pkg: { version: string } = JSON.parse(
            readFileSync(join(import.meta.dirname, '..', '..', '..', 'package.json'), 'utf8')
        );
        const logSpy: MockInstance<typeof console.log> = vi.spyOn(console, 'log').mockImplementation(() => {});

        await new VersionCommand().start([]);

        const output: string = logSpy.mock.calls.map(call => call.join(' ')).join('\n');
        expect(output).toContain(pkg.version);
    });
});