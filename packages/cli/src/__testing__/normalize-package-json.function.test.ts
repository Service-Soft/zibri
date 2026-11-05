import { describe, expect, it } from '@jest/globals';

import { diffFileContents } from './diff-file-contents.function';
import { normalizePackageJson } from './normalize-package-json.function';

type PackageJsonInput = {
    version?: string,
    author?: string,
    dependencies?: Record<string, string>,
    devDependencies?: Record<string, string>
};

/**
 * Normalizes both package.json files and returns only the lines the diff actually marks as
 * changed. Unchanged context lines still contain the dependency names, so asserting on the raw
 * diff would pass even when a version was not collapsed.
 * @param generated - The package.json the generator would produce.
 * @param sandbox - The package.json inside packages/sandbox.
 * @returns The added and removed lines of the diff, joined by newlines.
 */
function changedLines(generated: PackageJsonInput, sandbox: PackageJsonInput): string {
    const normalized: { generated: Buffer, sandbox: Buffer } = normalizePackageJson(
        Buffer.from(JSON.stringify(generated)),
        Buffer.from(JSON.stringify(sandbox))
    );
    return diffFileContents(normalized.generated, normalized.sandbox)
        .split('\n')
        .filter((line: string) => line.startsWith('- ') || line.startsWith('+ '))
        .join('\n');
}

describe('normalizePackageJson', () => {
    it('hides compatible drift and keeps real drift visible', () => {
        const changed: string = changedLines(
            {
                version: '1.0.0',
                dependencies: { zibri: 'file:../../../../../../zibri', 'zibri-tsx': 'file:../../tsx' },
                devDependencies: { autoprefixer: '^10.5.4', tailwindcss: '^3.4.19', typescript: '^5.9.3' }
            },
            {
                version: '1.0.1',
                dependencies: { zibri: '*' },
                devDependencies: { autoprefixer: '^10.4.24', tailwindcss: '^4.0.0', typescript: '^5.8.3' }
            }
        );

        // npm resolved newer patches than the sandbox declares, but the ranges still overlap.
        expect(changed).not.toContain('autoprefixer');
        expect(changed).not.toContain('typescript');
        // the local dev link must never leak the temp directory into the diff.
        expect(changed).not.toContain('file:');
        // a major bump means the sandbox really is out of sync.
        expect(changed).toContain('tailwindcss');
        // the sandbox not declaring zibri-tsx at all is real drift too.
        expect(changed).toContain('zibri-tsx');
        expect(changed).toContain('version');
    });

    it('reports nothing when the two files only order their blocks differently', () => {
        const changed: string = changedLines(
            {
                devDependencies: { typescript: '^5.8.3' },
                dependencies: { 'pg-query-stream': '^4.10.3' }
            },
            {
                dependencies: { 'pg-query-stream': '^4.10.3' },
                devDependencies: { typescript: '^5.8.3' }
            }
        );

        // npm writes a top level key when the first install that needs it runs, so "zi new" - which
        // installs its dev dependencies first - ends up with the two blocks the other way round from
        // packages/sandbox. Nothing about a package.json depends on that order, but a text diff
        // reads it as a moved block and reports every line in it, including the ones both files
        // agree on: a dependency added to both sides showed up as two differences.
        expect(changed).toEqual('');
    });

    it('reports nothing when only the author differs', () => {
        // "zi new" fills the author in from the git configuration of the machine it runs on, the way
        // npm does, so what it writes is whoever ran the test. Nothing packages/sandbox could hold
        // would match that anywhere but on one developer's machine.
        expect(changedLines({ author: 'ci <ci@example.com>' }, { author: 'Tim Fabian' })).toEqual('');
    });

    it('respects caret semantics for 0.x versions', () => {
        // "^0.2.3" allows everything below 0.3.0, so it is not compatible with "^0.3.0".
        expect(changedLines({ dependencies: { a: '^0.2.3' } }, { dependencies: { a: '^0.3.0' } })).toContain('a');
        expect(changedLines({ dependencies: { a: '^0.2.3' } }, { dependencies: { a: '^0.2.9' } })).not.toContain('a');
        // "^0.0.3" allows nothing but 0.0.3 itself.
        expect(changedLines({ dependencies: { a: '^0.0.3' } }, { dependencies: { a: '^0.0.4' } })).toContain('a');
    });

    it('respects tilde and exact versions', () => {
        expect(changedLines({ dependencies: { a: '~1.2.3' } }, { dependencies: { a: '~1.3.0' } })).toContain('a');
        expect(changedLines({ dependencies: { a: '~1.2.3' } }, { dependencies: { a: '~1.2.9' } })).not.toContain('a');
        expect(changedLines({ dependencies: { a: '1.2.3' } }, { dependencies: { a: '1.2.4' } })).toContain('a');
        expect(changedLines({ dependencies: { a: '^1.2.3' } }, { dependencies: { a: '~1.5.0' } })).not.toContain('a');
    });
});