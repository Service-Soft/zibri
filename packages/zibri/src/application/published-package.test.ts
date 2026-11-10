import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from '@jest/globals';

import { PACKAGES_LEFT_TO_THE_APPLICATION } from '../__testing__/packages-left-to-the-application';
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

/**
 * The sections of a manifest that decide what a consumer has installed beside the package.
 */
type InstalledBeside = {
    /**
     * What is installed with the package.
     */
    dependencies?: Record<string, string>,
    /**
     * What the consumer installs, the package asking for it.
     */
    peerDependencies?: Record<string, string>
};

/**
 * The fields of a manifest that tell TypeScript where a package's declarations are.
 */
type PackageManifest = {
    /**
     * The file a require of the package loads.
     */
    main?: string,
    /**
     * The declarations of the main file.
     */
    types?: string,
    /**
     * The older name of `types`.
     */
    typings?: string,
    /**
     * The declarations per version of TypeScript.
     */
    typesVersions?: unknown,
    /**
     * The entry points, each of which may name its declarations.
     */
    exports?: unknown
};

/**
 * The packages the built declarations import, by the name a consumer installs them under.
 * @returns The names, without node's own modules and without the package itself.
 */
function findDeclarationImports(): string[] {
    const declarations: string[] = readdirSync(path.join(packageDir, 'dist', 'cjs'), { recursive: true, encoding: 'utf8' })
        .filter(file => file.endsWith('.d.ts'));
    const names: Set<string> = new Set();
    for (const file of declarations) {
        const source: string = readFileSync(path.join(packageDir, 'dist', 'cjs', file), 'utf8');
        for (const [, specifier = ''] of source.matchAll(/(?:from |import\()'([^'.][^']*)'/g)) {
            // a scoped package is named by its first two segments, any other by its first
            const name: string = specifier.split('/').slice(0, specifier.startsWith('@') ? 2 : 1)
                .join('/');
            if (!name.startsWith('node:') && !builtinModules.includes(name) && name !== 'zibri') {
                names.add(name);
            }
        }
    }
    return [...names].sort();
}

/**
 * Whether a package carries declarations of its own, rather than leaving them to `@types`.
 * @param name - The package.
 * @returns True when its manifest names its declarations, or it has an `index.d.ts`.
 */
function hasOwnDeclarations(name: string): boolean {
    // looked up the way node looks for a package rather than resolved, which a package's `exports`
    // can refuse for its manifest
    const manifestPath: string | undefined = [packageDir, repoRoot]
        .map(directory => path.join(directory, 'node_modules', name, 'package.json'))
        .find(candidate => existsSync(candidate));
    assert(manifestPath, `${name} is not installed`);
    const manifest: PackageManifest = JsonUtilities.parse(readFileSync(manifestPath, 'utf8'));
    const main: string = path.join(path.dirname(manifestPath), manifest.main ?? 'index.js');
    // where TypeScript looks for them: what the manifest names, and otherwise beside the main file
    return manifest.types != undefined
        || manifest.typings != undefined
        || manifest.typesVersions != undefined
        || JsonUtilities.stringify(manifest.exports ?? {}).includes('"types"')
        || existsSync(main.replace(/\.c?js$/, '.d.ts'))
        || existsSync(path.join(main, 'index.d.ts'));
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
        // what a generated project's webpack config and tsconfig name
        expect(files).toContain('dist/cjs/webpack/index.js');
        expect(files).toContain('dist/cjs/webpack/index.d.ts');
        expect(files).toContain('tsconfig.application.json');
        // what the sibling packages and data source drivers import, apart from the public api
        expect(files).toContain('dist/cjs/internal.js');
        expect(files).toContain('dist/cjs/internal.d.ts');
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
        // a json under src is a fixture or a recorded baseline: the sources cannot import one, since
        // nothing but the application's tsconfig resolves json modules
        const testMaterial: string[] = files.filter(f => f.includes('__testing__')
            || f.endsWith('.test.ts')
            || f.endsWith('.cases.ts')
            || f.endsWith('.instance-options.ts')
            || f.includes('.test.worker.')
            || f.includes('/test/')
            || f.startsWith('src/jest.')
            || (f.startsWith('src/') && f.endsWith('.json')));

        expect(testMaterial).toEqual([]);
    });

    it('installs at a size a consumer would accept', () => {
        const megabytes: number = packed().unpackedSize / 1024 / 1024;

        // measured 2026-11-01: `dist` is 10.9MB, of which 4 is the code that runs and the rest its
        // declarations and the maps of both, and the sources the maps lead into are 6.8MB, 17.7 all
        // told. The ceiling sits just above that: growing past it is a reason to look at what grew,
        // which once found test cases, fonts twice over and comments in code that runs, and once the
        // postgres layer that replaced typeorm. The number this was first written against is 50MB.
        expect(megabytes).toBeLessThan(18);
    });

    it('ships its comments once in the sources and the declarations, not in the code that runs', () => {
        const code: string = readFileSync(path.join(packageDir, 'dist', 'cjs', 'application', 'application.js'), 'utf8');
        const declarations: string = readFileSync(path.join(packageDir, 'dist', 'cjs', 'application', 'application.d.ts'), 'utf8');

        // a third of the JavaScript was comments, which nothing reads: an editor shows the JSDoc of
        // the declarations, and a source map leads to the sources
        expect(code).not.toContain('/**');
        expect(declarations).toContain('/**');
    });

    it('has a consumer install the declarations of every package its own declarations import', () => {
        const manifest: InstalledBeside = JsonUtilities.parse(readFileSync(path.join(packageDir, 'package.json'), 'utf8'));
        const installed: Set<string> = new Set([
            ...Object.keys(manifest.dependencies ?? {}),
            ...Object.keys(manifest.peerDependencies ?? {}),
            // such as the webpack whose configuration `zibri/webpack` answers, which the application builds with
            ...PACKAGES_LEFT_TO_THE_APPLICATION
        ]);
        const missing: string[] = findDeclarationImports().filter(name => {
            // DefinitelyTyped writes a scoped package's name without its @ and with __ for its /
            const typesPackage: string = `@types/${name.replace(/^@/, '').replace('/', '__')}`;
            return hasOwnDeclarations(name) ? !installed.has(name) : !installed.has(typesPackage);
        });

        // a consumer's build skips the declarations of its libraries, so an import of a package it
        // never installed is no error there: every type built from it silently becomes `any`. Only a
        // template looping over such a type with an untyped callback showed it, as the generated
        // project's build failing on implicit `any`s. This workspace hoists every package, so nothing
        // else here can see it
        expect(missing).toStrictEqual([]);
    });

    it('advertises no entry point that the build does not produce', () => {
        const advertised: string[] = [
            'dist/cjs/index.js',
            'dist/cjs/index.d.ts',
            'dist/cjs/webpack/index.js',
            'dist/cjs/webpack/index.d.ts',
            'dist/cjs/internal.js',
            'dist/cjs/internal.d.ts',
            'tsconfig.application.json'
        ];

        for (const entry of advertised) {
            expect(existsSync(path.join(packageDir, entry))).toBe(true);
        }
    });

    it('answers a require of its webpack configuration on its own, the way a webpack config makes one', () => {
        const res: { typeofFactory: string } = inConsumerProcess(`
            import { createRequire } from 'node:module';
            const require = createRequire(process.cwd() + '/index.cjs');
            const { resolveWebpackConfiguration } = require('zibri/webpack');
            console.log(JSON.stringify({ typeofFactory: typeof resolveWebpackConfiguration }));
        `);

        // nothing has loaded the main entry point first in that process, and the decorators of the
        // framework classes the build reaches for need what it loads
        expect(res.typeofFactory).toBe('function');
    }, 60000);

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

    it('answers an import of its internals with the modules the main entry point loads', () => {
        const res: { registries: number, typeofContainer: string } = inConsumerProcess(`
            import { createRequire } from 'node:module';
            const require = createRequire(process.cwd() + '/index.cjs');
            require('zibri');
            const internal = require('zibri/internal');
            console.log(JSON.stringify({
                registries: Object.keys(require.cache).filter(file => file.endsWith('global-registry.js')).length,
                typeofContainer: typeof internal.DiContainer
            }));
        `);

        expect(res.typeofContainer).toBe('function');
        // a second copy of the module level singletons behind the second entry point would leave
        // whatever registers through one of them invisible to the other
        expect(res.registries).toBe(1);
    }, 60000);
});

describe('the packages released together', () => {
    // npm shows a package's README as its page, and the repository's README links each one,
    // so an empty one is the first thing a reader of the package meets
    it.each(['zibri', 'cli', 'tsx', 'tsx-compiler', 'mdx', 'testing'])('give %s a README saying how to install it and where its documentation is', name => {
        const readme: string = readFileSync(path.join(repoRoot, 'packages', name, 'README.md'), 'utf8');

        expect(readme).toMatch(/^# /m);
        expect(readme).toMatch(/npm i(nstall)? /);
        expect(readme).toContain('https://service-soft.github.io/zibri');
    });
});