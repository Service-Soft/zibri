import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { beforeAll, describe, expect, it } from '@jest/globals';
import ts from 'typescript';
import { compile, CompileResult } from 'zibri-tsx/compiler';

import { JsonUtilities } from '../utilities/json.utilities';

/**
 * Executable form of evaluation/06-tooling-ci-and-testing.md X7.
 *
 * `zibri`, `zibri-tsx` and `zibri-testing` publish CommonJS, and an application whose package says
 * `"type": "module"` reaches them through node's interop. That the package answers an `import` at all
 * is checked beside this, in `published-package.test.ts`. This builds an application that is an es
 * module itself and runs it: its page compiled by zibri-tsx as an es module importing the framework,
 * the jsx runtime's named exports, a worker file that is an es module, and the root of the application
 * found from an entry point `require.main` knows nothing about.
 *
 * Needs `npm run build` of zibri, zibri-tsx and zibri-testing, like `build-toolchains.test.ts`: the
 * application imports them by name, the way a consumer does, so it loads the built packages.
 */

const packageDir: string = path.resolve(__dirname, '..', '..');
const appDir: string = path.join(packageDir, 'src', '__testing__', 'file-output', 'esm-application');

// the jsx runtime names its multi child factory with something that is not a word
/* eslint-disable cspell/spellchecker */
/**
 * The application's entry point, as its author writes it.
 */
const MAIN_SOURCE: string = `
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Fragment, jsx, jsxs } from 'zibri-tsx/jsx-runtime';
import { Controller, Get, HtmlResponse, inject, resolveAppRoot, Response, TsxUtilities, ZIBRI_DI_TOKENS } from 'zibri';
import { defaultClusterProviders, startTestServer } from 'zibri-testing';

import { HomePage } from './home.page.js';

@Controller('/esm')
class EsmController {
    @Response.html()
    @Get('/page')
    page(): HtmlResponse {
        return HtmlResponse.fromString(TsxUtilities.renderPage(HomePage, { name: 'esm' }));
    }

    @Get('/double')
    async double(): Promise<{ result: unknown }> {
        const job = await inject(ZIBRI_DI_TOKENS.MULTITHREADING_SERVICE).runThreadJob({
            workerData: { filePath: join(dirname(fileURLToPath(import.meta.url)), 'double.worker.js'), value: 21 }
        });
        return { result: job.result };
    }
}

// the real thread jobs, which the single process defaults stub
const server = await startTestServer({ controllers: [EsmController], providers: defaultClusterProviders });
const baseUrl: string = await server.start();
const page: string = await (await fetch(baseUrl + '/esm/page')).text();
const double: unknown = await (await fetch(baseUrl + '/esm/double')).json();
await server.shutdown();

console.log(JSON.stringify({ appRoot: resolveAppRoot(), jsxRuntime: [typeof jsx, typeof jsxs, typeof Fragment], page, double }));
`;
/* eslint-enable cspell/spellchecker */

/**
 * The application's page, as its author writes it.
 */
const PAGE_SOURCE: string = `
import { $ts, TsxComponent } from 'zibri';

type Props = {
    name: string
};

export const HomePage: TsxComponent<Props> = ({ name }) => {
    return <html><body><h1>{$ts\`Hello\`} {name}</h1></body></html>;
};
`;

/**
 * The application's worker file, as its author writes it.
 */
const WORKER_SOURCE: string = `
import { workerData } from 'node:worker_threads';
import { reportCompletion } from 'zibri';

reportCompletion((workerData as { value: number }).value * 2);
`;

/**
 * What the application answered about itself.
 */
type EsmApplicationProbe = {
    /**
     * Where the framework found the root of the application.
     */
    appRoot: string,
    /**
     * What the named exports of the jsx runtime are.
     */
    jsxRuntime: string[],
    /**
     * The page, as a request got it.
     */
    page: string,
    /**
     * What the route running the thread job answered.
     */
    double: unknown
};

/**
 * Compiles TypeScript the way an application built as es modules is.
 * @param source - The source.
 * @returns The es module.
 */
function compileModule(source: string): string {
    return ts.transpileModule(source, {
        compilerOptions: {
            module: ts.ModuleKind.ESNext,
            target: ts.ScriptTarget.ES2022,
            experimentalDecorators: true,
            emitDecoratorMetadata: true
        }
    }).outputText;
}

/**
 * Compiles a page the way the build of an application built as es modules does.
 * @param source - The template.
 * @returns The es module.
 * @throws When the template does not compile.
 */
function compilePage(source: string): string {
    const result: CompileResult = compile(source, { module: 'esm' });
    if (result.code == undefined) {
        throw new Error(result.diagnostics.map(d => `${d.code}: ${d.message}`).join('\n'));
    }
    return result.code;
}

let probe: EsmApplicationProbe;

describe('evaluation/06-tooling-ci-and-testing X7 - an application that is itself an es module', () => {

    beforeAll(() => {
        // emptied rather than only created, so a killed run cannot leave a stale build behind
        rmSync(appDir, { recursive: true, force: true });
        mkdirSync(appDir, { recursive: true });
        writeFileSync(path.join(appDir, 'package.json'), JsonUtilities.stringify({ private: true, type: 'module' }), 'utf8');
        writeFileSync(path.join(appDir, 'main.js'), compileModule(MAIN_SOURCE), 'utf8');
        writeFileSync(path.join(appDir, 'home.page.js'), compilePage(PAGE_SOURCE), 'utf8');
        writeFileSync(path.join(appDir, 'double.worker.js'), compileModule(WORKER_SOURCE), 'utf8');

        const output: string = execFileSync(process.execPath, [path.join(appDir, 'main.js')], {
            // the package, so that the framework resolves the way it does for anything else in the repo
            cwd: packageDir,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
            // jest cannot interrupt a synchronous child, so one that never settles would hang the run
            timeout: 60_000
        });
        // the last line: whatever the application logs while it runs comes first
        probe = JsonUtilities.parse(output.trim()
            .split('\n')
            .at(-1) ?? '');
    }, 90_000);

    it('renders its own page, compiled as an es module importing the framework', () => {
        expect(probe.page).toContain('<h1>Hello esm</h1>');
    });

    it('imports the named exports of the jsx runtime', () => {
        expect(probe.jsxRuntime).toEqual(['function', 'function', 'function']);
    });

    it('runs a thread job whose worker file is an es module', () => {
        expect(probe.double).toEqual({ result: 42 });
    });

    it('finds its root from the entry point it was started with', () => {
        // `require.main` is undefined for an es module entry point, so this is the fallback to the
        // path node was started with
        expect(probe.appRoot).toBe(appDir);
    });
});