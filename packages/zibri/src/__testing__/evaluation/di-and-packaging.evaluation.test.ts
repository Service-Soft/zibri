import { execFile } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import { ZibriApplication } from '../../application/application.ts';
import { ZibriApplicationOptions } from '../../application/application-options.model.ts';
import { AlsUtilities } from '../../context/als.utilities.ts';
import { HttpRequestContext } from '../../context/request/http-request.context.ts';
import { Injectable } from '../../di/decorators/injectable.decorator.ts';
import { DiContainer } from '../../di/di-container.ts';
import { initDiContainer } from '../../di/init-di-container.function.ts';
import { inject } from '../../di/inject.function.ts';
import { defineProvider, DiProvider } from '../../di/models/di-provider.model.ts';
import { InjectionToken } from '../../di/models/injection-token.model.ts';
import { GlobalRegistry } from '../../global/global-registry.ts';
import { HttpRequest } from '../../http/http-request.model.ts';
import { HttpResponse } from '../../http/http-response.model.ts';
import { ZibriPlugin } from '../../plugin/plugin.model.ts';
import { FsPath, FsUtilities } from '../../utilities/fs.utilities.ts';
import { JsonUtilities } from '../../utilities/json.utilities.ts';

/**
 * Executable form of evaluation/05-di-metadata-and-packaging.md and the tooling half of
 * evaluation/06-tooling-ci-and-testing.md.
 *
 * The container assertions below are behavioral. The rest read published artifacts - package.json,
 * tsconfig, the build script, the workflows - which is what a consumer actually receives, and is a
 * different thing from grepping implementation source for how a feature happens to be written.
 *
 * Every expectation describes the fixed behavior, so this file is red until the corresponding
 * finding is closed. See ./README.md for why.
 */

type PackageJson = {
    type?: string,
    exports?: Record<string, unknown>,
    module?: string,
    files?: string[],
    dependencies?: Record<string, string>,
    devDependencies?: Record<string, string>,
    peerDependencies?: Record<string, string>,
    peerDependenciesMeta?: Record<string, { optional?: boolean }>
};

const packageDir: FsPath = FsUtilities.getPath(import.meta.dirname, '..', '..', '..');
const repoRoot: FsPath = FsUtilities.getPath(packageDir, '..', '..');
const zibriPackageJson: FsPath = FsUtilities.getPath(packageDir, 'package.json');
const tsconfigBase: FsPath = FsUtilities.getPath(packageDir, 'tsconfig.base.json');
const ciWorkflow: FsPath = FsUtilities.getPath(repoRoot, '.github', 'workflows', 'ci.yml');
const cdWorkflow: FsPath = FsUtilities.getPath(repoRoot, '.github', 'workflows', 'cd.yml');

async function readPackageJson(): Promise<PackageJson> {
    return JsonUtilities.parse(await FsUtilities.readFile(zibriPackageJson));
}

/**
 * Whether the built package still loads with the given packages missing.
 *
 * In a process of its own, with the resolver patched to refuse them - the same failure a consumer
 * gets, without disturbing the workspace every other suite here depends on. It has to be the built
 * package rather than `src`, because what a top level import compiles to is the whole question.
 *
 * Refused only where the framework's own files ask, because that is the whole of what optional
 * claims: a module this package loads must not reach for one. What another package requires is that
 * package's business and arrives with it either way - `prom-client` requires `@opentelemetry/api`
 * at the top of a file, so it is in every tree the framework is in, whatever this manifest says
 * about it. Refusing that one everywhere would measure prom-client rather than this package.
 * @param names - The packages to leave out.
 * @returns True if `require('zibri')` still answers.
 */
async function loadsWithout(names: string[]): Promise<boolean> {
    // a resolve hook rather than Module._resolveFilename, which only ever sees `require`: the build is
    // es modules, and what it imports at the top of a file never passes through there
    const script: string = `
        import { registerHooks } from 'node:module';
        import { pathToFileURL } from 'node:url';
        const hidden = ${JsonUtilities.stringify(names)};
        const ownFiles = pathToFileURL(process.cwd() + '/dist/').href;
        registerHooks({
            resolve(specifier, context, nextResolve) {
                if (hidden.includes(specifier) && context.parentURL?.startsWith(ownFiles)) {
                    const error = new Error('Cannot find module ' + specifier);
                    error.code = 'MODULE_NOT_FOUND';
                    throw error;
                }
                return nextResolve(specifier, context);
            }
        });
        const { createRequire } = await import('node:module');
        const require = createRequire(process.cwd() + '/index.cjs');
        const zibri = require('zibri');
        console.log(JSON.stringify({ loaded: typeof zibri.ZibriApplication === 'function' }));
    `;
    try {
        const output: string = await new Promise<string>((resolve, reject) => {
            execFile(
                process.execPath,
                ['--input-type=module', '--eval', script],
                { cwd: packageDir, encoding: 'utf8' },
                (error, stdout) => error ? reject(error) : resolve(stdout)
            );
        });
        return JsonUtilities.parse<{ loaded: boolean }>(output).loaded;
    }
    catch {
        return false;
    }
}

/**
 * Runs the given function as if it were handling a request.
 *
 * A request context is the whole of what a request scope needs - created per request, entered while
 * it is handled, dropped with it - so this needs no port and no data source.
 * @param fn - The function to run.
 * @returns The result of the function.
 */
function asARequest<T>(fn: () => T): T {
    const context: HttpRequestContext = new HttpRequestContext(
        {} as unknown as HttpRequest,
        {} as unknown as HttpResponse
    );
    return AlsUtilities.runWithHttpRequestContext(context, fn);
}

describe('evaluation/05-di-metadata-and-packaging', () => {

    describe('D1 - circular dependencies must produce a diagnostic', () => {
        it('names the cycle instead of recursing until the stack overflows', () => {
            class EvalCycleA {}
            class EvalCycleB {}

            const container: DiContainer = DiContainer.getInstance();
            // resolved through factories rather than constructor parameters, because two classes
            // that reference each other in one module hit the TDZ on the emitted parameter
            // metadata before the container is ever asked
            container.register(defineProvider({
                token: EvalCycleA,
                useFactory: () => {
                    inject(EvalCycleB);
                    return new EvalCycleA();
                }
            }));
            container.register(defineProvider({
                token: EvalCycleB,
                useFactory: () => {
                    inject(EvalCycleA);
                    return new EvalCycleB();
                }
            }));

            // `resolvingStack` is maintained and never checked, and the instance is cached only
            // after construction, so A -> B -> A recurses forever. Today this throws
            // RangeError: Maximum call stack size exceeded, with a trace made entirely of inject
            // frames and no mention of either class - while the README promises "the specifics on
            // why a dependency injection failed".
            expect(() => inject(EvalCycleA)).toThrow(/EvalCycleA/);
        });
    });

    describe('D2 - a request scope must exist', () => {
        // singleton-or-transient was the whole scope model, so anything needing the current user or
        // tenant had to reach into AsyncLocalStorage at call time instead. A request context is all
        // a request scope needs, so this asserts it without listening on a port; the same scope
        // reached over http is in request-context.evaluation.test.ts.
        const perRequest: InjectionToken<object> = new InjectionToken<object>('eval-per-request');

        it('builds one value per request, and keeps it for that request', () => {
            DiContainer.getInstance().register(defineProvider({
                token: perRequest,
                scope: 'request',
                useFactory: () => ({})
            }));

            const [first, again]: object[] = asARequest(() => [inject(perRequest), inject(perRequest)]);
            const second: object = asARequest(() => inject(perRequest));

            expect(first).toBe(again);
            expect(first).not.toBe(second);
        });
    });

    describe('D3 - a provider must not be replaced by something nobody chose', () => {
        // the finding asks for duplicate detection in `register`, which would outlaw the framework's
        // own configuration mechanism: overriding a default is a duplicate registration, and so is
        // `[...sharedProviders, myOverride]`. What has no decision behind it is two plugins claiming
        // one token, where the winner is whichever plugin is listed first.

        const contested: InjectionToken<string> = new InjectionToken<string>('eval-contested-token');

        class EvalFirstPlugin extends ZibriPlugin {
            override providers: DiProvider<unknown>[] = [defineProvider({ token: contested, useFactory: () => 'from the first plugin' })];

            validate(): void {}
        }

        class EvalSecondPlugin extends ZibriPlugin {
            override providers: DiProvider<unknown>[] = [defineProvider({ token: contested, useFactory: () => 'from the second plugin' })];

            validate(): void {}
        }

        function optionsWith(providers: DiProvider<unknown>[]): ZibriApplicationOptions {
            return {
                name: 'eval-provider-collision',
                version: '1.0.0',
                baseUrl: 'http://localhost:3000',
                controllers: [],
                websocketControllers: [],
                dataSources: [],
                defaultAuth: 'public',
                plugins: [new EvalFirstPlugin(), new EvalSecondPlugin()],
                providers
            };
        }

        it('refuses two plugins that both claim a token', () => {
            // nothing here says which implementation is wanted, and the array the two end up in is
            // built from the order of `plugins` - which nobody writes as a precedence list
            expect(() => new ZibriApplication(optionsWith([]))).toThrow(/both provide "eval-contested-token"/);
        });

        it('lets the application settle it', () => {
            // the only test here that gets as far as constructing, and the state machine allows one
            // live application per process - so it hands the state back when it is done
            let app: ZibriApplication | undefined;
            try {
                expect(() => {
                    app = new ZibriApplication(optionsWith([defineProvider({ token: contested, useFactory: () => 'from the application' })]));
                }).not.toThrow();
            }
            finally {
                if (app) {
                    GlobalRegistry.markAppAsShuttingDown();
                    GlobalRegistry.markAppAsOffline();
                }
            }
        });
    });

    describe('D4 - unregister must actually remove the value', () => {
        it('evicts an already constructed instance', () => {
            @Injectable()
            class EvalUnregisterTarget {}

            const container: DiContainer = DiContainer.getInstance();
            expect(inject(EvalUnregisterTarget)).toBeDefined();

            container.unregister(EvalUnregisterTarget);

            // injected first on purpose: `inject` reads the instance cache before it looks at a
            // provider, so deleting the provider alone leaves anything already built live and
            // injectable forever
            expect(() => inject(EvalUnregisterTarget)).toThrow();
        });
    });

    // M4's residue - no deregistration, and a watch-mode restart importing into arrays that hold the
    // previous generation - closed on re-check (2026-10-13). Deregistration is D4 above. The watch
    // mode a project is generated with starts every rebuild in a process of its own and stops the
    // old one, held by packages/cli/src/commands/new/new.command.test.ts ("restarts the server in
    // watch mode as a new process, never in the old one").

    describe('D5 - a parameter that cannot be resolved must say which one it is', () => {
        it('names the class and the position when the type metadata carries no class', () => {
            interface EvalUnnamedDependency {
                value: string
            }

            @Injectable()
            class EvalNeedsAnInterface {
                constructor(readonly dependency: EvalUnnamedDependency) {}
            }

            // emitDecoratorMetadata writes "Object" for an interface, a union, a generic and a
            // primitive alike, and for a class two modules import from each other. All of it used to
            // be injected as though it were a token, so the reader was told there is no provider for
            // "Object" - a token they never wrote, in a class the message does not name.
            expect(() => inject(EvalNeedsAnInterface)).toThrow(/EvalNeedsAnInterface/);
            expect(() => inject(EvalNeedsAnInterface)).toThrow(/Parameter 0/);
        });
    });

    describe('D9 - registration must not depend on module load order', () => {
        it('resolves a class that was decorated after the container was initialized', () => {
            initDiContainer();

            // a class declared here is decorated when this test runs, which is exactly the shape the
            // finding is about: anything loaded lazily - a plugin, a required-on-demand module, a
            // path read from configuration - is decorated after initDiContainer has already read
            // GlobalRegistry.injectables and stopped looking at it
            @Injectable()
            class EvalLateInjectable {}

            expect(() => inject(EvalLateInjectable)).not.toThrow();
        });

        it('does not blame the decorator when the class is decorated', () => {
            initDiContainer();

            @Injectable()
            class EvalLateInjectableForMessage {}

            let message: string = '';
            try {
                inject(EvalLateInjectableForMessage);
            }
            catch (error) {
                message = error instanceof Error ? error.message : String(error);
            }

            // the error says "Did you forget to decorate it with @Injectable()?" about a class that
            // carries the decorator, so the only suggestion it makes is one the reader has already
            // followed. resolve falls back to GlobalRegistry.lazyInjectables (di-container.ts:127)
            // but never to GlobalRegistry.injectables, which is the whole difference.
            expect(message).not.toContain('forget to decorate');
        });
    });

    describe('D6 - providers must be able to initialize asynchronously', () => {
        it('resolves a provider whose factory is asynchronous, and everything it needs first', async () => {
            const secret: InjectionToken<string> = new InjectionToken<string>('eval-vault-secret');
            const connection: InjectionToken<string> = new InjectionToken<string>('eval-connection');

            const container: DiContainer = DiContainer.getInstance();
            // the one that needs the other first, so registration order is the wrong order: what
            // decides is `deps`, which is the only part of a factory the container can see into
            container.register(defineProvider({
                token: connection,
                deps: [secret],
                useAsyncFactory: async (password: string) => Promise.resolve(`db://user:${password}@host`)
            }));
            container.register(defineProvider({
                token: secret,
                useAsyncFactory: async () => Promise.resolve('hunter2')
            }));

            // useFactory was typed to return T, not Promise<T>, so a connection or a secret fetched
            // from a vault could not be expressed as a provider at all - which is why the framework
            // carries a parallel lifecycle (init, beforeAppInit, onAppInit, afterAppInit,
            // onAppStart) to do the work the container could not own.
            expect(await container.injectAsync(connection)).toBe('db://user:hunter2@host');
            // and from here on it is a value like any other, which is what keeps inject() synchronous
            expect(inject(connection)).toBe('db://user:hunter2@host');
        });
    });
});

describe('evaluation/05-di-metadata-and-packaging - the published artifact', () => {

    describe('M2 - the compiler settings must match the strictness the README claims', () => {
        it('enables the options that turn the confirmed defects into build failures', async () => {
            const tsconfig: string = await FsUtilities.readFile(tsconfigBase);

            // noUncheckedIndexedAccess is the one the finding argues for: it would have caught
            // logger.ts split('\n')[3], metrics stats[0] and the inverseSide dereference at boot,
            // all confirmed defects. exactOptionalPropertyTypes is deliberately not among these -
            // it is a modelling decision about every optional property in the public API rather
            // than a check on the code, and the finding is closed without it.
            for (const option of [
                'noUncheckedIndexedAccess',
                'noImplicitOverride',
                'noUnusedLocals',
                'noPropertyAccessFromIndexSignature',
                'noFallthroughCasesInSwitch',
                'noImplicitReturns'
            ]) {
                expect(tsconfig).toContain(option);
            }
        });
    });

    describe('P1 / P2 - what package.json promises must be what the build produces', () => {
        it('states one module format, and the one the build emits', async () => {
            const pkg: PackageJson = await readPackageJson();
            const conditions: Record<string, unknown> = (pkg.exports?.['.'] ?? {}) as Record<string, unknown>;

            // the esm half was three defects deep: the entry point named here was never emitted, the
            // output under `dist/esm` was CommonJS because `module: nodenext` reads the format off a
            // `"type"` field that did not exist, and real esm would then have failed because the
            // source writes its relative imports without a file extension. There is one build now, of
            // es modules, and a commonjs consumer reaches it through require(esm) - see
            // ../../published-package.test.ts, which loads it both ways in a process of its own and
            // checks they are the same module.
            expect(pkg.type).toBe('module');
            expect(conditions['import']).toBeUndefined();
            expect(pkg.module).toBeUndefined();
            expect(conditions['default']).toBe('./dist/index.js');
        });
    });

    describe('P3 - peer dependencies must reflect what a consumer actually needs', () => {
        it('marks feature specific peers optional', async () => {
            const pkg: PackageJson = await readPackageJson();
            const meta: Record<string, { optional?: boolean }> = pkg.peerDependenciesMeta ?? {};

            // a plain REST API with no PDFs, websockets, XML or 2FA had to install all four. Each
            // is declared by something now - the invoicing plugin, a websocket controller, the two
            // factor method, a translations folder - and each is checked while the application
            // starts. socket.io-adapter is here because it arrives with socket.io and was the
            // mandatory half of an optional pair. saxes, the xml parser, is checked by the xml body parser,
            // the translations and the invoicing plugin, each of which can be replaced.
            for (const name of ['pdfmake', 'socket.io', 'socket.io-adapter', 'otpauth', 'saxes']) {
                expect(meta[name]?.optional).toBe(true);
            }
        });

        it('does not require a TypeScript compiler at runtime', async () => {
            const pkg: PackageJson = await readPackageJson();

            // worker threads called tsNodeRegister() at startup, so every production worker booted a
            // compiler - the item a container hardening review stops on. It is registered on demand
            // now, only for a worker file that is actually TypeScript.
            //
            // Optional rather than absent, which is not the shape this originally asked for: npm
            // installs a peer unless the meta calls it optional, so `optional` is what keeps it out
            // of a production image, while listing it still tells a consumer who wants to hand the
            // framework TypeScript what to install. Removing it entirely would document nothing.
            // ../../optional-peer-dependencies.test.ts holds the behavior behind this. The compiler is
            // oxc-transform since the framework loads TypeScript itself rather than through ts-node.
            expect(pkg.peerDependenciesMeta?.['oxc-transform']?.optional).toBe(true);
        });

        it('can be loaded without any of the peers it calls optional', async () => {
            const pkg: PackageJson = await readPackageJson();
            const optional: string[] = Object.entries(pkg.peerDependenciesMeta ?? {})
                .filter(([, meta]) => meta.optional === true)
                .map(([name]) => name);

            // three of the four originally listed are imported at the top of a module the barrel
            // exports, so `require('zibri')` is MODULE_NOT_FOUND without them and the word optional
            // is not true of any of them: bcryptjs from bcrypt.hash-strategy, @valkey/valkey-glide
            // from val-key-data-source.model, handlebars from handlebar.utilities. Only `pg` and
            // `ts-node` load the way the manifest says they do.
            expect(await loadsWithout(optional)).toBe(true);
        }, 60000);

        it('describes a dispatcher itself rather than depending on undici-types for it', async () => {
            const pkg: PackageJson = await readPackageJson();

            // `HttpClientOptions.dispatcher` was briefly typed as undici's own `Dispatcher`, on the
            // grounds that `undici-types` reaches every project through `@types/node` and so costs
            // nothing to import. It does reach them - but at a version their `@types/node` major
            // decides. This repository's three workspaces alone carry undici-types 6, 7 and 8, and
            // a `Dispatcher` from one is *not assignable* to a `Dispatcher` from another: v8 widened
            // `UndiciHeaders` to include `OutgoingHttpHeaders`, and variance does the rest.
            //
            // So naming the package means naming a version, and any version chosen is the wrong one
            // for somebody - the option would refuse the very ProxyAgent it exists to accept, for
            // no reason the reader could see. The type is described in
            // `http-client-options.model.ts` instead, to the one member the framework touches:
            // none. It forwards a dispatcher to fetch and never calls it.
            expect(pkg.devDependencies?.['undici-types']).toBeUndefined();
            expect(pkg.dependencies?.['undici-types']).toBeUndefined();
            expect(pkg.peerDependencies?.['undici-types']).toBeUndefined();
        });
    });

    describe('P4 / T2 - what the package publishes', () => {
        it('carves the test material out of the source tree it ships', async () => {
            const pkg: PackageJson = await readPackageJson();

            // the source itself stays: the maps beside `dist` point into it, and a reader who
            // follows a framework method should arrive at what it does rather than at a stripped
            // `.d.ts`. What has no business shipping is everything under it that is not source -
            // 37MB of gitignored coverage report and 232 tests, which a `files` whitelist ships
            // regardless of every ignore file, and which only a `!` entry in `files` removes.
            // ../../published-package.test.ts measures the tarball this produces. The exclusion
            // matches a __testing__ folder at any depth, because fixtures live beside the code they
            // serve as well as in the top level one.
            expect(pkg.files ?? []).toContain('./src');
            expect(pkg.files ?? []).toContain('!src/**/__testing__/**');
            expect(pkg.files ?? []).toContain('!src/**/*.test.ts');
        });

        it('publishes the test harness so consumers can test their own app', async () => {
            const harness: PackageJson & { name?: string } = JsonUtilities.parse(
                await FsUtilities.readFile(FsUtilities.getPath(packageDir, '..', 'testing', 'package.json'))
            );

            // the finding asked for a `./testing` subpath on this package, and it got a package of
            // its own instead. A subpath would have made `testcontainers` an optional peer of the
            // framework and committed it to a test runner; as a separate package those are plain
            // dependencies of something a consumer installs as a devDependency, and the framework's
            // own manifest is untouched.
            expect(harness.name).toBe('zibri-testing');
            expect(Object.keys(harness.exports ?? {})).toContain('.');

            // a peer rather than a dependency, so the harness drives the consumer's copy of the
            // framework - two copies in one process is a boot failure, by design
            expect(Object.keys(harness.peerDependencies ?? {})).toContain('zibri');

            // and the framework does not depend on its own harness, which would put testcontainers
            // in every production install
            const pkg: PackageJson = await readPackageJson();
            expect(Object.keys(pkg.dependencies ?? {})).not.toContain('zibri-testing');
        });
    });

    describe('T1 - the framework must not need private field access to be testable', () => {
        it('offers a public container reset', () => {
            // the harness used to reach into DiContainer['singleton'] and GlobalRegistry['appData']
            // because nothing public could do either. Both are gone now: shutdown() releases the
            // process on its own (02 C7), and this is the seam a consumer's harness needs when it
            // wants a clean container without an application lifecycle around it
            const before: DiContainer = DiContainer.getInstance();

            DiContainer.reset();

            expect(DiContainer.getInstance()).not.toBe(before);
        });

        // The two readonly casts that used to be left of T1 closed differently. The asset folder is
        // the ASSETS_PATH token, and ./static-assets.evaluation.test.ts serves through it - the cast
        // it replaced never reached /assets at all. The data source port stays a write past readonly
        // inside zibri-testing's applyContainerPort, on purpose: a consumer no longer writes it, and
        // both ways to remove it were declined - see evaluation/06-tooling-ci-and-testing.md.
    });
});

describe('evaluation/06-tooling-ci-and-testing', () => {

    describe('CI1 - the supported runtime range must be tested', () => {
        it('runs the suite on every node version it declares, and on more than one os', async () => {
            const ci: string = await FsUtilities.readFile(ciWorkflow);

            // `engines` said >=22 while CI tested exactly 22. Raising the floor fixed the arithmetic
            // and not the defect: a `>=` range promises versions that do not exist yet, so the
            // matrix is read off node's own release schedule instead of being written down. The
            // assertions that hold the shape of that live in ../../ci-workflows.test.ts.
            expect(ci).toMatch(/matrix/);
            expect(ci).toMatch(/supported-node-majors/);
            expect(ci).toMatch(/windows-latest/);
            expect(ci).toMatch(/macos-latest/);
        });
    });

    describe('CI2 - the dependency surface must be scanned', () => {
        it('runs a security scan', async () => {
            // a framework whose pitch is "batteries included" owns a maximal transitive dependency
            // surface on the consumer's behalf, and had no automated supply-chain gate at all.
            // `npm audit` covers the tree a consumer receives, codeql the code the framework is.
            expect(await FsUtilities.readFile(ciWorkflow)).toMatch(/npm audit/i);
            expect(await FsUtilities.exists(FsUtilities.getPath(repoRoot, '.github', 'workflows', 'codeql.yml'))).toBe(true);
        });
    });

    describe('CI4 - the published artifact must be smoke tested', () => {
        it('runs a suite that loads the built package the way a consumer does', async () => {
            // held by ../../published-package.test.ts rather than by a step in the workflow, so that
            // it also runs before a push rather than only after one. What matters is that it runs in
            // CI at all: every other suite imports TypeScript through vitest's transform and can therefore not
            // see a single thing about what gets published.
            const ci: string = await FsUtilities.readFile(ciWorkflow);

            expect(ci).toMatch(/npm run build:prod -w zibri/);
            expect(ci).toMatch(/npm run test:ci -w zibri/);
        });
    });

    describe('CD1 / CD2 - releases must be reproducible and gated', () => {
        it('installs from the lockfile in the publishing job', async () => {
            // `npm i` resolves against ranges, so the artifact that reaches npm is built from a
            // dependency tree that was never tested
            expect(await FsUtilities.readFile(cdWorkflow)).not.toMatch(/^\s*-\s*run:\s*npm i\s*$/m);
        });

        it('has no entrance to the release path other than the protected branch', async () => {
            const cd: string = await FsUtilities.readFile(cdWorkflow);

            // what gates a release is the branch protection rule on `release`: nothing reaches that
            // branch without passing CI on dev first. That rule lives in the repository's settings
            // rather than in the repository, so what this file can hold is the other half of it -
            // that a merged pull request into that branch is the only thing that publishes. A
            // `workflow_dispatch` or a `push` trigger here would be a second door, and the rule
            // does not cover it.
            expect(cd).toMatch(/^\s*pull_request:/m);
            expect(cd).not.toMatch(/^\s*workflow_dispatch:/m);
            expect(cd).not.toMatch(/^\s*push:/m);
        });

        it('publishes with provenance, since OIDC is already requested', async () => {
            expect(await FsUtilities.readFile(cdWorkflow)).toContain('--provenance');
        });
    });
});