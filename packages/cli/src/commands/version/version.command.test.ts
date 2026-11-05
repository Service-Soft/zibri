import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it, jest } from '@jest/globals';

import { VersionCommand } from './version.command';

describe('VersionCommand', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('prints the version from this package\'s own package.json', async () => {
        // eslint-disable-next-line typescript/no-unsafe-assignment
        const pkg: { version: string } = JSON.parse(
            readFileSync(join(__dirname, '..', '..', '..', 'package.json'), 'utf8')
        );
        const logSpy: jest.SpiedFunction<typeof console.log> = jest.spyOn(console, 'log').mockImplementation(() => {});

        await new VersionCommand().start([]);

        const output: string = logSpy.mock.calls.map(call => call.join(' ')).join('\n');
        expect(output).toContain(pkg.version);
    });
});