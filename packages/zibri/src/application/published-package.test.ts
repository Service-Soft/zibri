import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from '@jest/globals';

import { JsonUtilities } from '../utilities/json.utilities';

/**
 * What a consumer receives, checked against the built package rather than against `src`.
 *
 * Every other suite here imports TypeScript through ts-jest, which cannot see any of this: whether
 * the files `package.json` advertises are the files the tarball contains, whether they load, and
 * whether `require` and `import` reach the same module. The three defects this replaces were all of
 * that kind - an entry point that pointed at a file the build never produced, output that said `esm`
 * and contained CommonJS, and a post build step whose failures were swallowed by `catch {}`.
 *
 * Needs `npm run build` to have run. CI builds before it tests; locally this fails with the command
 * to run rather than a stack trace about a missing file.
 */

const packageDir: string = path.resolve(__dirname, '..', '..');
const repoRoot: string = path.resolve(packageDir, '..', '..');
const builtEntry: string = path.join(packageDir, 'dist', 'cjs', 'index.js');
const packCache: string = path.join(tmpdir(), 'zibri-npm-pack-cache');

/**
 * What `npm publish` would upload, without publishing anything.
 */
type PackedTarball = {
    /**
     * Every path the tarball would contain, relative to the package root.
     */
    files: string[],
    /**
     * What those files weigh once installed, in bytes.
     */
    unpackedSize: number
};

/**
 * Runs `npm pack` without publishing.
 * @returns The tarball's contents and installed size.
 */
function packed(): PackedTarball {
    // a cache of its own: `npm pack` writes to one, and reading the tarball a manifest describes
    // has nothing to do with whatever the machine's shared cache happens to hold or allow
    const output: string = execFileSync('npm', ['pack', '--dry-run', '--json', '--cache', packCache], {
        cwd: packageDir,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore']
    });
    const parsed: { files: { path: string }[], unpackedSize: number }[] = JsonUtilities.parse(output);
    // `npm pack --json` reports one entry per tarball, and one tarball was asked for
    const [packed] = parsed;
    assert(packed, 'npm pack reported no tarball');
    return { files: packed.files.map(f => f.path), unpackedSize: packed.unpackedSize };
}

/**
 * Loads the package the way a consumer does, in a process of its own.
 *
 * Out of process on purpose: resolving `zibri` inside jest would hand back the copy ts-jest already
 * compiled from `src`, and loading the built one beside it would put two of every decorator registry
 * in one process. A child sees only what an installed package offers.
 * @param script - The body of an ES module to run, which must print one line of json.
 * @returns Whatever the script printed, parsed.
 */
function inConsumerProcess<T>(script: string): T {
    const output: string = execFileSync(process.execPath, ['--input-type=module', '--eval', script], {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
    });
    return JsonUtilities.parse(output);
}

describe('the published package', () => {

    it('has been built', () => {
        // not a finding of its own - it is what makes the failures below readable
        expect(existsSync(builtEntry)).toBe(true);
    });

    it('ships every file it advertises', () => {
        const files: string[] = packed().files;

        // `exports`, `main` and `types` are promises about the tarball, and nothing checked that the
        // build had kept any of them. The entry point the esm condition named was never emitted at
        // all, so `import ... from 'zibri'` was ERR_MODULE_NOT_FOUND for every consumer of it.
        expect(files).toContain('dist/cjs/index.js');
        expect(files).toContain('dist/cjs/index.d.ts');
        expect(files).toContain('package.json');
    });

    it('ships the sources its maps point at', () => {
        const files: string[] = packed().files;

        // `declarationMap` and `sourceMap` are on, so every `.d.ts` carries a map into `src`.
        // Publishing the maps without the sources would leave a reader who follows a framework
        // method looking at a stripped `.d.ts` instead of what it does.
        expect(files).toContain('src/index.ts');
        expect(files).toContain('dist/cjs/index.d.ts.map');
    });

    it('builds into an empty directory', () => {
        const pkg: { scripts?: Record<string, string> } = JsonUtilities.parse(
            readFileSync(path.join(packageDir, 'package.json'), 'utf8')
        );

        // `tsc` overwrites what it emits and removes nothing else, while `files` ships the
        // directory rather than the build's output - so every file any earlier build left behind
        // goes out with the next one. It put 93 compiled test files and 5MB into a tarball whose
        // build compiled none of them, and the test below could not see it coming: CI builds into
        // a fresh checkout, so the only machine where dist has a history is a developer's.
        expect(pkg.scripts?.['build']).toContain('build:clean');
    });

    it('ships no test material', () => {
        const files: string[] = packed().files;

        // `files` is a whitelist and it beats every ignore rule underneath it, so naming `./src`
        // published the framework's own coverage report - written into `src/__testing__/coverage`,
        // gitignored, and 37 of the tarball's 50MB - along with every test beside it. Only a `!`
        // entry in `files` itself carves anything back out; `.npmignore` and `.gitignore` are both
        // inert here, and each was measured saying so.
        const testMaterial: string[] = files.filter(f => f.includes('__testing__')
            || f.endsWith('.test.ts')
            || f.endsWith('.cases.ts')
            || f.includes('.test.worker.')
            || f.includes('/test/'));

        expect(testMaterial).toEqual([]);
    });

    it('installs at a size a consumer would accept', () => {
        const megabytes: number = packed().unpackedSize / 1024 / 1024;

        // `dist` is 7.6MB and the sources behind it 4.5MB, 12.1 all told, and the ceiling sits just above
        // that: growing past it is a reason to look at what grew, which once found test cases, fonts
        // twice over and comments in code that runs. The number this was first written against is 50MB.
        expect(megabytes).toBeLessThan(13);
    });

    it('ships its comments once in the sources and the declarations, not in the code that runs', () => {
        const code: string = readFileSync(path.join(packageDir, 'dist', 'cjs', 'application', 'application.js'), 'utf8');
        const declarations: string = readFileSync(path.join(packageDir, 'dist', 'cjs', 'application', 'application.d.ts'), 'utf8');

        // a third of the JavaScript was comments, which nothing reads: an editor shows the JSDoc of
        // the declarations, and a source map leads to the sources
        expect(code).not.toContain('/**');
        expect(declarations).toContain('/**');
    });

    it('advertises no entry point that the build does not produce', () => {
        const advertised: string[] = [
            'dist/cjs/index.js',
            'dist/cjs/index.d.ts'
        ];

        for (const entry of advertised) {
            expect(existsSync(path.join(packageDir, entry))).toBe(true);
        }
    });

    it('answers both a require and an import, with the same module', () => {
        const res: { sameClass: boolean, namedExports: number, typeofApplication: string } = inConsumerProcess(`
            import { createRequire } from 'node:module';
            const require = createRequire(process.cwd() + '/index.cjs');
            const cjs = require('zibri');
            const esm = await import('zibri');
            console.log(JSON.stringify({
                sameClass: cjs.ZibriApplication === esm.ZibriApplication,
                namedExports: Object.keys(esm).length,
                typeofApplication: typeof esm.ZibriApplication
            }));
        `);

        expect(res.typeofApplication).toBe('function');
        // through the __exportStar chain, which is what makes a single CommonJS build serve an esm
        // consumer without an esm build behind it
        expect(res.namedExports).toBeGreaterThan(400);
        // the dual package hazard, and the reason there is one build rather than two. `GlobalRegistry`
        // and `DiContainer` are module level singletons, so a consumer whose graph reached the
        // package both ways would hold two of each - every `inject()` on one side blind to
        // everything registered on the other.
        expect(res.sameClass).toBe(true);
    }, 60000);
});