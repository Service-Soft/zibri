import { join } from 'node:path';

import { describe, expect, it } from '@jest/globals';
import ts from 'typescript';

import packageJson from '../package.json';

describe('the compiler', () => {
    it('admits the TypeScript it runs on as its peer', () => {
        const majors: (string | undefined)[] = packageJson.peerDependencies.typescript
            .split('||')
            .map(range => /^\^(\d+)\./.exec(range.trim())?.[1]);

        // the compiler runs on the application's own TypeScript, and this suite runs once per major
        // (jest.typescript-6.config.mjs). A major it passes on and the range refuses is an application
        // npm will not install beside it
        expect(majors).toContain(ts.version.split('.')[0]);
    });

    it.each(Object.keys(packageJson.exports).filter(subpath => subpath !== '.' && !subpath.endsWith('.json')))(
        'declares the types of %s to a consumer that resolves without "exports"',
        subpath => {
            // a file of a project beside this package, which reaches it through node_modules like any other
            const consumer: string = join(__dirname, '..', '..', '..', 'consumer.ts');
            const resolved: ts.ResolvedModuleFull | undefined = ts.resolveModuleName(
                `zibri-tsx-compiler/${subpath.slice(2)}`,
                consumer,
                { moduleResolution: ts.ModuleResolutionKind.Node10 },
                ts.sys
            ).resolvedModule;

            // what `"module": "commonjs"` resolves by, zibri's own build among them: it reads `types` and
            // `typesVersions` and never `exports`
            expect(resolved?.resolvedFileName).toMatch(/\.d\.ts$/);
        }
    );
});