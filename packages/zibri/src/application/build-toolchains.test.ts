import assert from 'node:assert';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import { transformSync as swcTransform } from '@swc/core';
import ts from '@typescript/typescript6';
import { transformSync as esbuildTransform } from 'esbuild';
import { beforeAll, describe, expect, it } from 'vitest';

// type only on purpose: loading the fixture here would declare its entity and its injectables into
// this process's registries, which is the one thing running each build in a child avoids
import type { ProbeResult } from '../__testing__/build-toolchains/consumer-application.fixture.ts';
import { JsonUtilities } from '../utilities/json.utilities.ts';

/**
 * Which toolchains an application can be built with, checked by building one with each of them.
 *
 * The framework's decorators are TypeScript's pre-standard ones, and two separate things come with
 * that. `experimentalDecorators` is what every decorator here rides on, and every toolchain that
 * compiles TypeScript at all implements it. `emitDecoratorMetadata` is a second, narrower thing:
 * the framework reads what it writes in exactly two places - a constructor parameter that names no
 * token, and the check that a number property's declared type matches the format it names - and
 * esbuild does not implement it at all, which is what made this a lock-in rather than a preference.
 *
 * So the promise is two styles rather than one toolchain, and this file is what makes it a promise:
 * the same application compiled every way below, asserted to behave identically apart from the two things
 * that depend on the metadata. A claim about somebody else's compiler is worth nothing written down
 * in a document, because the day it stops being true nothing says so.
 *
 * Needs `npm run build` to have run, like `optional-peer-dependencies.test.ts` beside it: the
 * fixture imports the framework by name, the way a consumer does, so it loads the built package.
 */

const packageDir: string = path.resolve(import.meta.dirname, '..', '..');
const fixturePath: string = path.join(packageDir, 'src', '__testing__', 'build-toolchains', 'consumer-application.fixture.ts');
const outputDir: string = path.join(packageDir, 'src', '__testing__', 'file-output', 'build-toolchains');

/**
 * A way of turning the application's TypeScript into something node runs.
 */
type Toolchain = {
    /**
     * What to call it in a test name.
     */
    name: string,
    /**
     * Turns the fixture into JavaScript, in the module format `extension` says.
     */
    compile: (fixture: string) => string,
    /**
     * `.cjs` for CommonJS, `.mjs` for an es module, which node 24 also loads through `require`, and
     * `.ts` for TypeScript left to the framework's own loader to compile as it is loaded.
     */
    extension: '.cjs' | '.mjs' | '.ts',
    /**
     * Whether this build writes down the type of a constructor parameter and of a property.
     */
    carriesTypeMetadata: boolean
};

/**
 * Compiles the fixture with TypeScript's own compiler.
 * @param fixture - The fixture's path.
 * @param emitDecoratorMetadata - Whether to write the types down.
 * @returns The CommonJS output.
 */
function withTsc(fixture: string, emitDecoratorMetadata: boolean): string {
    return ts.transpileModule(readFileSync(fixture, 'utf8'), {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2022,
            experimentalDecorators: true,
            emitDecoratorMetadata: emitDecoratorMetadata,
            esModuleInterop: true
        }
    }).outputText;
}

/**
 * Compiles the fixture with TypeScript 7, the native compiler.
 *
 * Through its binary, because 7.0 ships no api. The fixture's import of the framework does not resolve
 * from the folder it is compiled in, so the run reports a type error and emits regardless - the same
 * single file view `transpileModule` gives the row of TypeScript 6.
 * @param fixture - The fixture's path.
 * @returns The CommonJS output.
 */
function withTsc7(fixture: string): string {
    const outDir: string = path.join(outputDir, 'tsc-7');
    // checked rather than assumed: the row passing under this name while compiling with an older TypeScript
    // would prove nothing about the one it names
    const typescriptPackage: string = createRequire(import.meta.url).resolve('typescript/package.json');
    const { version }: { version: string } = JsonUtilities.parse(readFileSync(typescriptPackage, 'utf8'));
    assert(version.startsWith('7.'), `TypeScript 7 was expected, found ${version}`);
    const tsc7: string = path.join(path.dirname(typescriptPackage), 'bin', 'tsc');
    const options: string[] = [
        '--ignoreConfig',
        '--outDir',
        outDir,
        '--module',
        'commonjs',
        '--target',
        'es2022',
        '--experimentalDecorators',
        '--emitDecoratorMetadata',
        '--esModuleInterop',
        '--skipLibCheck'
    ];
    spawnSync(process.execPath, [tsc7, fixture, ...options], { encoding: 'utf8', timeout: 60_000 });
    return readFileSync(path.join(outDir, `${path.basename(fixture, '.ts')}.js`), 'utf8');
}

/**
 * Builds the fixture the way a generated application is built: with Vite, whose Oxc transform compiles
 * the decorators.
 *
 * In a process of its own, so the build runs on Vite as an application has it rather than inside the test
 * runner's own. A build rather than a transform, because what Oxc emits imports helpers that only exist
 * inside the build.
 * @param fixture - The fixture's path.
 * @returns The es module output.
 */
function withVite(fixture: string): string {
    const script: string = [
        'const { build } = await import(\'vite\');',
        'const result = await build({',
        '    configFile: false,',
        '    logLevel: \'silent\',',
        '    oxc: { decorator: { legacy: true, emitDecoratorMetadata: true } },',
        // the framework stays the published package the fixture imports, as it does for an application
        '    ssr: { external: [\'zibri\'] },',
        `    build: { ssr: ${JsonUtilities.stringify(fixture)}, write: false, target: 'node24' }`,
        '});',
        'process.stdout.write((Array.isArray(result) ? result[0] : result).output[0].code);'
    ].join('\n');
    return execFileSync(process.execPath, ['--input-type=module', '-e', script], {
        cwd: packageDir,
        encoding: 'utf8',
        timeout: 60_000
    });
}

const TOOLCHAINS: Toolchain[] = [
    {
        // the control: what a consumer following the generated tsconfig gets today
        name: 'tsc',
        compile: fixture => withTsc(fixture, true),
        extension: '.cjs',
        carriesTypeMetadata: true
    },
    {
        name: 'tsc without emitDecoratorMetadata',
        compile: fixture => withTsc(fixture, false),
        extension: '.cjs',
        carriesTypeMetadata: false
    },
    {
        name: 'tsc 7',
        compile: fixture => withTsc7(fixture),
        extension: '.cjs',
        carriesTypeMetadata: true
    },
    {
        // behind flags rather than on by default, which is the whole of what it asks for
        name: 'swc',
        compile: fixture => swcTransform(readFileSync(fixture, 'utf8'), {
            filename: 'consumer-application.fixture.ts',
            jsc: {
                parser: { syntax: 'typescript', decorators: true },
                transform: { legacyDecorator: true, decoratorMetadata: true },
                target: 'es2022'
            },
            module: { type: 'commonjs' }
        }).code,
        extension: '.cjs',
        carriesTypeMetadata: true
    },
    {
        // there is no flag to turn on here - esbuild implements the decorators and not the metadata,
        // so this row is the one the whole promise exists for
        name: 'esbuild',
        compile: fixture => esbuildTransform(readFileSync(fixture, 'utf8'), {
            loader: 'ts',
            format: 'cjs',
            target: 'es2022',
            tsconfigRaw: { compilerOptions: { experimentalDecorators: true, target: 'ES2022' } }
        }).code,
        extension: '.cjs',
        carriesTypeMetadata: false
    },
    {
        name: 'vite 8',
        compile: fixture => withVite(fixture),
        extension: '.mjs',
        carriesTypeMetadata: true
    },
    {
        // what a TypeScript worker file and a test cluster instance are compiled with: Oxc like the
        // row above, but with the decorator helpers the loader serves itself rather than Oxc's own
        name: 'the TypeScript loader',
        compile: fixture => readFileSync(fixture, 'utf8'),
        extension: '.ts',
        carriesTypeMetadata: true
    }
];

const builtLoader: string = path.join(packageDir, 'dist', 'utilities', 'typescript-loader', 'typescript-loader.utilities.js');

const probes: Map<string, ProbeResult> = new Map();

/**
 * Builds the application with the given toolchain and asks the result about itself.
 *
 * In a process of its own because declaring an entity or an injectable registers it globally, so
 * four copies of one application in this process would be four generations in the same arrays. Kept
 * once built, so that each toolchain compiles and boots one time however many things are asked of it.
 * @param toolchain - How to compile it.
 * @returns What the loaded application answered.
 */
function probeOf(toolchain: Toolchain): ProbeResult {
    const known: ProbeResult | undefined = probes.get(toolchain.name);
    if (known != undefined) {
        return known;
    }

    const compiledPath: string = path.join(outputDir, `${toolchain.name.replaceAll(' ', '-')}${toolchain.extension}`);
    writeFileSync(compiledPath, toolchain.compile(fixturePath), 'utf8');

    const registering: string = toolchain.extension === '.ts'
        ? `require(${JsonUtilities.stringify(builtLoader)}).TypeScriptLoaderUtilities.register('The fixture');`
        : '';
    const output: string = execFileSync(
        process.execPath,
        ['-e', `${registering}console.log(JSON.stringify(require(${JsonUtilities.stringify(compiledPath)}).probe()));`],
        {
            // the package, so that `zibri` resolves the way it does for anything else in the repo
            cwd: packageDir,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
            // the test runner cannot interrupt a synchronous child, so one that never settles would
            // hang the whole run rather than fail this test
            timeout: 60_000
        }
    );
    // the last line rather than the whole of it: anything the framework prints while loading comes
    // first, and the answer is what was printed last
    const result: ProbeResult = JsonUtilities.parse(output.trim()
        .split('\n')
        .at(-1) ?? '');
    probes.set(toolchain.name, result);
    return result;
}

describe('build toolchains', () => {

    beforeAll(() => {
        // emptied rather than only created, so a killed run cannot leave a stale build behind for
        // the next one to load
        rmSync(outputDir, { recursive: true, force: true });
        mkdirSync(outputDir, { recursive: true });
    });

    it.each(TOOLCHAINS)('builds an application with $name', toolchain => {
        const result: ProbeResult = probeOf(toolchain);

        // the whole decorator surface, one shape at a time: a class decorator that registers an
        // injectable, a parameter decorator that names a token, a property decorator that describes
        // a column, a method decorator that declares a route, and a parameter decorator on that
        // route. None of them needs a type written down - they are handed everything they record.
        expect(result.tagged).toBe('hello');
        expect(result.entityProperties).toContain('reference');
        expect(result.entityProperties).toContain('total');
        expect(result.entityProperties).toContain('lastStatus');
        expect(result.routes).toEqual(['GET /:reference']);
        expect(result.handler).toEqual({ reference: 'inv-1', greeting: 'hello' });
    });

    it.each(TOOLCHAINS)('describes the application the same way as tsc does when built with $name', toolchain => {
        const control: ProbeResult = probeOf(TOOLCHAINS[0] as Toolchain);
        const result: ProbeResult = probeOf(toolchain);

        // the two metadata-dependent answers are what the styles differ over, and everything else is
        // what the promise is about - so this compares the rest as a whole rather than property by
        // property, which is what catches the thing nobody thought to assert
        // the enum parameter's message names what was recorded, which is what the toolchains differ over;
        // that each of them refuses it is asserted below
        const unlike: Partial<ProbeResult> = {
            untagged: undefined,
            ownEmptyConstructor: undefined,
            contradictedFormat: undefined,
            enumParameter: undefined
        };
        expect({ ...result, ...unlike }).toEqual({ ...control, ...unlike });
    });

    it.each(TOOLCHAINS)('refuses a parameter typed as an enum from another module with $name', toolchain => {
        // nothing can inject an enum value, whatever the compiler recorded for it - Number, nothing, or
        // the enum object - so each of them is refused with the remedy rather than looked up as a token
        const result: ProbeResult = probeOf(toolchain);

        expect(result.enumParameter.name).toBe('UninjectableParameterError');
        expect(result.enumParameter.message).toContain('EnumParameterService');
        expect(result.enumParameter.message).toContain('@Inject');
    });

    it.each(TOOLCHAINS)('builds a class with the constructor it inherits with $name', toolchain => {
        // the parent names its tokens, which needs nothing recorded - so the subclass, declaring no
        // constructor and reporting an arity of 0, is built with what the parent asks for
        expect(probeOf(toolchain).inherited).toEqual({ name: 'it resolved', message: 'hello' });
    });

    it.each(TOOLCHAINS.filter(t => t.carriesTypeMetadata))('builds a class declaring a constructor that takes nothing with $name', toolchain => {
        // the recorded, empty parameter list is what says the class declares a constructor of its own
        expect(probeOf(toolchain).ownEmptyConstructor).toEqual({ name: 'it resolved', message: 'hello' });
    });

    it.each(TOOLCHAINS.filter(t => !t.carriesTypeMetadata))('refuses a class declaring a constructor that takes nothing with $name', toolchain => {
        const result: ProbeResult = probeOf(toolchain);

        // chosen, and the cost of the second style: without anything recorded, a declared
        // constructor taking nothing looks exactly like an inherited one, and building it as if it
        // were inherited would hand its parent undefined without a word. Refused, with the remedy
        // that works under every build
        expect(result.ownEmptyConstructor.name).toBe('UninjectableParameterError');
        expect(result.ownEmptyConstructor.message).toContain('"SelfSupplyingService", taken from the constructor of "UntaggedGreetingBase"');
        expect(result.ownEmptyConstructor.message).toContain('@Inject');
    });

    it.each(TOOLCHAINS.filter(t => t.carriesTypeMetadata))('injects by declared type with $name', toolchain => {
        // injection by declared type is what the metadata buys, and it keeps working where it is there
        expect(probeOf(toolchain).untagged).toEqual({ name: 'it resolved', message: 'hello' });
    });

    it.each(TOOLCHAINS.filter(t => !t.carriesTypeMetadata))('says what to do about an untagged parameter with $name', toolchain => {
        const result: ProbeResult = probeOf(toolchain);

        // the error is the whole of the migration story for somebody moving an existing application
        // onto a toolchain that emits no metadata: it has to name the class and the position, say
        // that nothing was recorded, and offer naming the token rather than leaving "turn the option
        // on" as the only advice - which is advice esbuild cannot take.
        expect(result.untagged.name).toBe('UninjectableParameterError');
        expect(result.untagged.message).toContain('UntaggedService');
        expect(result.untagged.message).toContain('@Inject');
        expect(result.untagged.message).toContain('esbuild');
    });

    it.each(TOOLCHAINS.filter(t => t.carriesTypeMetadata))('refuses a contradicted number format with $name', toolchain => {
        expect(probeOf(toolchain).contradictedFormat).toContain('The format "bignumber" is held by BigNumber');
    });

    it.each(TOOLCHAINS.filter(t => !t.carriesTypeMetadata))('cannot see a contradicted number format with $name', toolchain => {
        // named rather than worked around, because it is the cost of the second style and the only
        // one: the check reads the declared type, and a build that records no types has nothing for
        // it to read. The value is still checked against the format on the way in, so what is lost
        // is when the contradiction is found, not whether a wrong value can be stored.
        expect(probeOf(toolchain).contradictedFormat).toBe('it was accepted');
    });
});