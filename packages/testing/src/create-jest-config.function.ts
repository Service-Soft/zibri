import { createRequire } from 'node:module';
import path from 'node:path';
import vm from 'node:vm';

import type { Config } from 'jest';

import type { JestConfigOptions } from './jest-config-options.model';

/**
 * A transform the configuration names, and the package that brings it.
 */
type NamedTransform = {
    /**
     * What the configuration names, as jest resolves it.
     */
    transform: string,
    /**
     * The package the application installs for it.
     */
    packageName: string
};

/**
 * The transforms the configuration names, which the application installs as devDependencies.
 */
const TRANSFORMS: NamedTransform[] = [
    { transform: 'zibri-tsx-compiler/jest', packageName: 'zibri-tsx-compiler' },
    { transform: 'ts-jest', packageName: 'ts-jest' }
];

/**
 * Checks that the application whose tests jest runs has the transforms the configuration names installed.
 *
 * Jest refuses a transform it cannot find with a message of its own, naming neither this configuration nor what to
 * install. Resolved from where jest is started, and from where this package is installed, which is the application's
 * own when jest is started above it, such as with the `projects` of a repository holding several.
 * @throws When the application does not have one of them.
 */
function validateTransformsInstalled(): void {
    const root: string = process.cwd();
    const resolve: NodeJS.RequireResolve = createRequire(path.join(root, 'package.json')).resolve;
    for (const { transform, packageName } of TRANSFORMS) {
        try {
            resolve(transform, { paths: [root, __dirname] });
        }
        catch (error) {
            throw new Error(
                `The tests of the application at "${root}" need "${transform}", which it does not have installed. `
                + `Run "npm i -D ${packageName}" there.`,
                { cause: error }
            );
        }
    }
}

/**
 * The packages that ship as es modules only and that the framework loads while an application
 * starts: the default auth strategy loads jose.
 */
const FRAMEWORK_ESM_PACKAGES: string[] = ['jose'];

/**
 * Whether jest loads an es module that is required as it is: on node run with `--experimental-vm-modules`, as the test
 * script of a generated project runs it. Asked the way jest asks, which needs a module of the vm that evaluates at once.
 * The workers jest starts are run with the flags of the process building the configuration.
 * @returns True when it does.
 */
function resolveLoadsEsModules(): boolean {
    const sourceTextModule: unknown = Reflect.get(vm, 'SourceTextModule');
    const prototype: unknown = typeof sourceTextModule === 'function' ? Reflect.get(sourceTextModule, 'prototype') : undefined;
    return typeof prototype === 'object' && prototype !== null && typeof Reflect.get(prototype, 'hasAsyncGraph') === 'function';
}

/**
 * The jest configuration a Zibri application's tests run with.
 *
 * TypeScript and the templates compiled to commonjs, which is what jest runs a test in, a template's
 * `?client` import resolved to the package itself, as the build resolves it on the server, the
 * packages that ship as es modules only compiled like the sources, and a test worker restarted once
 * it holds more than 1 GB.
 * ```js
 * export default createJestConfig({ rootDir: 'src', esmPackages: ['nanoid'] });
 * ```
 * @param options - Any jest option, which is kept, and the application's own es module only packages.
 * @param options.esmPackages - The application's own packages that ship as es modules only.
 * @returns The configuration.
 * @throws When the application does not have a transform it names installed, `zibri-tsx-compiler` or `ts-jest`.
 */
export function createJestConfig({ esmPackages = [], ...config }: JestConfigOptions = {}): Config {
    validateTransformsInstalled();
    // jest replaces the ignore patterns rather than merging them, so the packages are one pattern
    // built here: a package listed beside the preset would otherwise have to list the framework's too
    const packages: string = [...FRAMEWORK_ESM_PACKAGES, ...esmPackages]
        .map(name => name.replaceAll(/[$()*+.?[\\\]^{|}]/g, String.raw`\$&`))
        .join('|');
    const loadsEsModules: boolean = resolveLoadsEsModules();
    const transform: Config['transform'] = {
        // the templates are compiled by zibri-tsx-compiler, as its webpack loader does for the build, the pages
        // written in markdown among them
        '^.+[\\\\/]src[\\\\/]templates[\\\\/].+\\.(tsx|mdx?)$': 'zibri-tsx-compiler/jest',
        // ts-jest compiles to commonjs either way, and says so for every file when the tsconfig names nodenext
        '^.+.tsx?$': ['ts-jest', { tsconfig: { module: 'commonjs' } }],
        ...loadsEsModules
            ? {}
            : { [`/node_modules/(?:${packages})/.+\\.js$`]: ['ts-jest', { tsconfig: { allowJs: true, module: 'commonjs' } }] }
    };
    return {
        testEnvironment: 'node',
        // a worker that has booted an application holds about a gigabyte, and grows with every test
        // file that boots one. A run with a worker per core ended in the OOM killer
        workerIdleMemoryLimit: '1GB',
        ...config,
        // jest takes the first pattern that matches, so the application's come first and win
        transform: { ...config.transform, ...transform, ...config.transform },
        transformIgnorePatterns: loadsEsModules ? ['/node_modules/'] : [`/node_modules/(?!(?:${packages})/)`],
        moduleNameMapper: { '^(.+)\\?client$': '$1', ...config.moduleNameMapper }
    };
}