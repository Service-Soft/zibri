import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from '@jest/globals';

/**
 * The built package, which is the only thing that can answer this question.
 *
 * Whether an import survives to the emitted file is the whole point, so the source tree says
 * nothing about it - and module resolution is process-wide, so the check runs in a child.
 */
const distPath: string = join(__dirname, '..', 'dist');

/**
 * Loads one built entry point with `typescript` hidden from module resolution.
 * @param entry - The entry file, relative to `dist`.
 * @returns What the child reported: the loaded exports it was asked about, or the failure.
 */
function loadWithoutTypescript(entry: string): { loaded: boolean, message: string } {
    const script: string = `
        const Module = require('node:module');
        const resolve = Module._resolveFilename;
        Module._resolveFilename = function (request, ...rest) {
            if (request === 'typescript') {
                throw new Error('resolved typescript');
            }
            return resolve.call(this, request, ...rest);
        };
        try {
            const loaded = require(${JSON.stringify(join(distPath, entry))});
            process.stdout.write(JSON.stringify({
                loaded: true,
                message: '',
                keys: Object.keys(loaded)
            }));
        }
        catch (error) {
            process.stdout.write(JSON.stringify({ loaded: false, message: error.message, keys: [] }));
        }
    `;
    const output: string = execFileSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 30000 });
    return JSON.parse(output) as { loaded: boolean, message: string, keys: string[] };
}

describe('the runtime entry point', () => {
    it('is built', () => {
        // the rest of this file reads `dist`, so a stale or absent build would make it pass by
        // describing nothing.
        expect(existsSync(join(distPath, 'index.js'))).toBe(true);
        expect(existsSync(join(distPath, 'compiler.js'))).toBe(true);
    });

    it('loads without typescript installed', () => {
        // an application imports this entry to render a page, and a compiler is a build-time tool.
        // Reaching one from here would put TypeScript in every deployed bundle - and the reason the
        // parser may use TypeScript at all is that nothing shipped to a running application does.
        expect(loadWithoutTypescript('index.js')).toMatchObject({ loaded: true });
    });

    it('does not expose the compiler', () => {
        // eslint-disable-next-line typescript/no-require-imports, typescript/no-var-requires
        const runtime: Record<string, unknown> = require('../dist/index.js') as Record<string, unknown>;

        expect(runtime['parse']).toBeUndefined();
        expect(runtime['compile']).toBeUndefined();
        expect(runtime['createServerRuntime']).toBeDefined();
        expect(runtime['renderPage']).toBeDefined();
    });

    it('keeps the compiler reachable on its own subpath', () => {
        // eslint-disable-next-line typescript/no-require-imports, typescript/no-var-requires
        const compiler: Record<string, unknown> = require('../dist/compiler.js') as Record<string, unknown>;

        expect(compiler['parseTemplate']).toBeDefined();
        expect(compiler['compile']).toBeDefined();
    });
});