import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from '@jest/globals';

/**
 * What a consumer has to install, checked by not installing it.
 *
 * `peerDependenciesMeta` is a claim about packages the framework can do without, and nothing here
 * ever tested the claim - every suite runs in a workspace where all of them are present, so a top
 * level `import` of an optional peer resolves and the promise stays unfalsifiable until somebody
 * deploys without it.
 *
 * `ts-node` is the one this file started with. A production image runs compiled JavaScript, and a
 * framework that pulls a TypeScript compiler into it is carrying a build tool's dependency tree
 * through container hardening review for a capability that image will never use. `socket.io-adapter`
 * is here for the same reason and is checked the same way; the manifest side of the claim is in
 * `di-and-packaging.evaluation.test.ts`.
 *
 * Needs `npm run build` to have run, like `published-package.test.ts` beside it.
 */

const packageDir: string = path.resolve(__dirname, '..', '..');
const builtWorker: string = path.join(
    packageDir, 'dist', 'cjs', 'multithreading', 'services', 'worker', 'thread-job.worker.js'
);
const fixtureDir: string = path.join(packageDir, 'src', 'multithreading', 'services');
const builtRegister: string = path.join(packageDir, 'dist', 'cjs', 'utilities', 'register-ts-node.function.js');
const builtXlfTransform: string = path.join(
    packageDir, 'dist', 'cjs', 'localization', 'xlf', 'transform-source-translation-tokens.function.js'
);

/**
 * The peers the manifest says a consumer may leave out.
 * @returns Their package names.
 */
function optionalPeers(): string[] {
    const manifest: { peerDependenciesMeta?: Record<string, { optional?: boolean }> } = JSON.parse(
        readFileSync(path.join(packageDir, 'package.json'), 'utf8')
    ) as { peerDependenciesMeta?: Record<string, { optional?: boolean }> };
    return Object.entries(manifest.peerDependenciesMeta ?? {})
        .filter(([, meta]) => meta.optional === true)
        .map(([name]) => name);
}

/**
 * Makes the given packages unresolvable, the way not installing them would.
 *
 * Patching the resolver rather than moving folders about: it is the same failure a consumer gets -
 * `MODULE_NOT_FOUND` from the first thing that reaches for the package - and it leaves the
 * workspace every other suite depends on alone.
 * @param names - The packages to hide.
 * @returns The prelude to put in front of a script.
 */
function hiding(names: string[]): string {
    return `
        import Module from 'node:module';
        const hidden = ${JSON.stringify(names)};
        const resolve = Module._resolveFilename;
        Module._resolveFilename = function (request, ...rest) {
            if (hidden.includes(request)) {
                const error = new Error(\`Cannot find module '\${request}'\`);
                error.code = 'MODULE_NOT_FOUND';
                throw error;
            }
            return resolve.call(this, request, ...rest);
        };
    `;
}

/**
 * Runs an es module in a process of its own, the way `published-package.test.ts` does.
 * @param script - The body to run, which must print one line of json.
 * @returns Whatever it printed, parsed.
 */
function inConsumerProcess<T>(script: string): T {
    const output: string = execFileSync(process.execPath, ['--input-type=module', '--eval', script], {
        // the package rather than the repository root, so a TypeScript worker file is compiled
        // against the tsconfig it was written under
        cwd: packageDir,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        // jest cannot interrupt a synchronous child, so a script that never settles would hang the
        // whole run rather than fail this test
        timeout: 60_000
    });
    return JSON.parse(output) as T;
}

/**
 * A script that runs one worker file through the built worker and prints what the job reported.
 * @param filePath - The worker file the job names.
 * @param data - The rest of the job's worker data.
 * @returns The script body.
 */
function runningJob(filePath: string, data: Record<string, unknown> = {}): string {
    return `
        import { Worker } from 'node:worker_threads';
        const worker = new Worker(${JSON.stringify(builtWorker)}, { workerData: {} });
        const result = await new Promise((resolve, reject) => {
            worker.on('message', message => {
                if (message.type === 'initialization') {
                    worker.postMessage({ ...${JSON.stringify(data)}, filePath: ${JSON.stringify(filePath)} });
                    return;
                }
                if (message.type === 'completion') {
                    resolve(message.result);
                }
                if (message.type === 'error') {
                    reject(new Error(JSON.stringify(message.error)));
                }
            });
            worker.on('error', reject);
        });
        await worker.terminate();
        console.log(JSON.stringify({ result }));
    `;
}

describe('ts-node', () => {

    it('is an optional peer dependency', () => {
        // it was listed as a peer and left out of the meta, which made it mandatory - so installing
        // `zibri` installed a TypeScript compiler, in every environment, whether or not anything
        // would ever hand it a TypeScript file.
        expect(optionalPeers()).toContain('ts-node');
    });

    it('can be looked for without being loaded', () => {
        const res: { installed: boolean, hidden: boolean } = inConsumerProcess(`
            const { createRequire } = await import('node:module');
            const require = createRequire(process.cwd() + '/index.cjs');
            const { isTsNodeInstalled } = require(${JSON.stringify(builtRegister)});
            const installed = isTsNodeInstalled();
            ${hiding(['ts-node'])}
            console.log(JSON.stringify({ installed, hidden: isTsNodeInstalled() }));
        `);

        // this is what lets the answer be given at startup instead of at the first job to want a
        // compiler - which can be days after the deployment that left one out. It resolves without
        // loading, so asking the question costs nothing in a process that will never need one.
        expect(res.installed).toBe(true);
        expect(res.hidden).toBe(false);
    });

    it('is not needed to load the framework', () => {
        const res: { loaded: boolean } = inConsumerProcess(`
            ${hiding(['ts-node'])}
            const { createRequire } = await import('node:module');
            const require = createRequire(process.cwd() + '/index.cjs');
            const zibri = require('zibri');
            console.log(JSON.stringify({ loaded: typeof zibri.ZibriApplication === 'function' }));
        `);

        // `generateEntityFiles` imported it at the top of a file the barrel exports, so reaching
        // any part of the framework resolved a compiler - a top level import of an optional peer
        // means the whole package cannot be loaded without it, the opposite of what the word says.
        expect(res.loaded).toBe(true);
    });

    it('is not started by a worker thread running javascript', () => {
        const probe: string = path.join(fixtureDir, 'multithreading.service.ts-node-probe.test.worker.js');
        const res: { result: boolean } = inConsumerProcess(runningJob(probe));

        // the worker registered it the moment it started, before it had been told what to run. A
        // pool of them in a production image was a pool of TypeScript compilers, every one of which
        // would only ever be handed compiled JavaScript.
        expect(res.result).toBe(false);
    });

    it('is started by a worker thread running TypeScript', () => {
        const fixture: string = path.join(fixtureDir, 'multithreading.service.test.worker.ts');
        const res: { result: number } = inConsumerProcess(runningJob(fixture, { amount: 10 }));

        // the capability is the point - what changed is when it is paid for.
        expect(res.result).toBe(55);
    });

    it('says so by name when a TypeScript file needs it and it is missing', () => {
        // on this thread rather than through a worker: a worker thread has a module registry of its
        // own, so hiding a package from this process's resolver is invisible inside one. What is
        // being asserted is the text of the error, and that is the same text either way.
        const res: { message: string } = inConsumerProcess(`
            ${hiding(['ts-node'])}
            const { createRequire } = await import('node:module');
            const require = createRequire(process.cwd() + '/index.cjs');
            const { registerTsNode } = require(${JSON.stringify(builtRegister)});
            let message = 'it did not fail';
            try {
                registerTsNode('The worker file /somewhere/report.worker.ts');
            }
            catch (error) {
                message = error.message;
            }
            console.log(JSON.stringify({ message }));
        `);

        // making it optional moves the failure from install time to run time, so the run time
        // failure has to name the package and say what to do instead - a bare MODULE_NOT_FOUND
        // from inside a worker thread is the worst version of this.
        expect(res.message).toContain('ts-node');
        expect(res.message).toContain('compiled JavaScript');
    });
});

describe('saxes', () => {

    it('is an optional peer dependency', () => {
        // xml is read by the xml body parser and the translations, and a document written with
        // generateFrom is checked with it. Each of those can be replaced or left out, and each checks
        // for the package while it is set up, so the manifest cannot know that a consumer needs it. A
        // route or an error answered with xml does not: that document is written by the framework itself
        expect(optionalPeers()).toContain('saxes');
    });

    it('is not needed to load the framework', () => {
        const res: { loaded: boolean } = inConsumerProcess(`
            ${hiding(['saxes'])}
            const { createRequire } = await import('node:module');
            const require = createRequire(process.cwd() + '/index.cjs');
            const zibri = require('zibri');
            console.log(JSON.stringify({ loaded: typeof zibri.ZibriApplication === 'function' }));
        `);

        expect(res.loaded).toBe(true);
    });

    it('says so by name when the xml body parser is built without saxes', () => {
        const res: { message: string } = inConsumerProcess(`
            ${hiding(['saxes'])}
            const { createRequire } = await import('node:module');
            const require = createRequire(process.cwd() + '/index.cjs');
            const { XmlBodyParser } = require('zibri');
            let message = 'it did not fail';
            try {
                new XmlBodyParser();
            }
            catch (error) {
                message = error.message;
            }
            console.log(JSON.stringify({ message }));
        `);

        // while the application starts, since it is one of the default body parsers. Found at the
        // first xml body instead, it would have been answered as a 400 for a broken document
        expect(res.message).toContain('saxes');
        expect(res.message).toContain('npm i saxes');
    });
});

describe('typescript', () => {

    it('is an optional peer dependency', () => {
        // the source translation extractor reads templates with TypeScript's parser, which is a build
        // step - it runs from a webpack config and nowhere else. Listed only as a devDependency it was
        // a dependency nobody declared, and imported at the top of a file the barrel exports it was
        // one every consumer resolved anyway.
        expect(optionalPeers()).toContain('typescript');
    });

    it('is not needed to load the framework', () => {
        const res: { loaded: boolean } = inConsumerProcess(`
            ${hiding(['typescript'])}
            const { createRequire } = await import('node:module');
            const require = createRequire(process.cwd() + '/index.cjs');
            const zibri = require('zibri');
            console.log(JSON.stringify({ loaded: typeof zibri.ZibriApplication === 'function' }));
        `);

        // a production image prunes its devDependencies, so an unbundled application that loads the
        // framework without a compiler installed is the ordinary case. Bundled, the same import is
        // worse in a quieter way: the bundler follows it and ships the whole compiler - more than
        // half of the sandbox's bundle - inside an application that never runs it.
        expect(res.loaded).toBe(true);
    });

    it('says so by name when source translations are extracted without it', () => {
        const res: { message: string } = inConsumerProcess(`
            ${hiding(['typescript'])}
            const { createRequire } = await import('node:module');
            const require = createRequire(process.cwd() + '/index.cjs');
            const { transformSourceTranslationOriginTokens } = require(${JSON.stringify(builtXlfTransform)});
            let message = 'it did not fail';
            try {
                // no origins, so nothing is read: the question is whether asking at all names the
                // package, rather than whether some file happened to need it
                await transformSourceTranslationOriginTokens([]);
            }
            catch (error) {
                message = error.message;
            }
            console.log(JSON.stringify({ message }));
        `);

        expect(res.message).toContain('typescript');
        expect(res.message).toContain('npm i typescript');
    });
});

describe('openapi3-ts', () => {

    it('is not needed to load the framework', () => {
        const res: { loaded: boolean } = inConsumerProcess(`
            ${hiding(['openapi3-ts'])}
            const { createRequire } = await import('node:module');
            const require = createRequire(process.cwd() + '/index.cjs');
            const zibri = require('zibri');
            console.log(JSON.stringify({ loaded: typeof zibri.ZibriApplication === 'function' }));
        `);

        // a devDependency, which a consumer never installs, so the framework may use its types and
        // nothing else. A type guard taken from it once made every generated project's build fail
        expect(res.loaded).toBe(true);
    });
});

describe('socket.io-adapter', () => {

    it('is an optional peer dependency', () => {
        // it arrives with socket.io and is worth nothing without one, so it cannot be the mandatory
        // half of an optional pair.
        expect(optionalPeers()).toContain('socket.io-adapter');
    });

    it('is not needed to load the framework', () => {
        const res: { loaded: boolean } = inConsumerProcess(`
            ${hiding(['socket.io', 'socket.io-adapter'])}
            const { createRequire } = await import('node:module');
            const require = createRequire(process.cwd() + '/index.cjs');
            const zibri = require('zibri');
            console.log(JSON.stringify({ loaded: typeof zibri.ZibriApplication === 'function' }));
        `);

        // `class DataSourceWebsocketAdapter extends ClusterAdapter` is a value used at module
        // scope, and the barrel exports the module - so socket.io's own adapter package was
        // resolved by every consumer, websockets or not, while socket.io beside it was optional.
        expect(res.loaded).toBe(true);
    });
});