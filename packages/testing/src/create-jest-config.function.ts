import type { Config } from 'jest';

import type { JestConfigOptions } from './jest-config-options.model';

/**
 * The packages that ship as es modules only and that the framework loads while an application
 * starts: the default auth strategy loads jose.
 */
const FRAMEWORK_ESM_PACKAGES: string[] = ['jose'];

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
 */
export function createJestConfig({ esmPackages = [], ...config }: JestConfigOptions = {}): Config {
    // jest replaces the ignore patterns rather than merging them, so the packages are one pattern
    // built here: a package listed beside the preset would otherwise have to list the framework's too
    const packages: string = [...FRAMEWORK_ESM_PACKAGES, ...esmPackages]
        .map(name => name.replaceAll(/[$()*+.?[\\\]^{|}]/g, String.raw`\$&`))
        .join('|');
    const transform: Config['transform'] = {
        // the templates are compiled by zibri-tsx, as the zibri-tsx/webpack loader does for the build
        '^.+[\\\\/]src[\\\\/]templates[\\\\/].+\\.tsx$': 'zibri-tsx/jest',
        // ts-jest compiles to commonjs either way, and says so for every file when the tsconfig names nodenext
        '^.+.tsx?$': ['ts-jest', { tsconfig: { module: 'commonjs' } }],
        [`/node_modules/(?:${packages})/.+\\.js$`]: ['ts-jest', { tsconfig: { allowJs: true, module: 'commonjs' } }]
    };
    return {
        testEnvironment: 'node',
        // a worker that has booted an application holds about a gigabyte, and grows with every test
        // file that boots one. A run with a worker per core ended in the OOM killer
        workerIdleMemoryLimit: '1GB',
        ...config,
        // jest takes the first pattern that matches, so the application's come first and win
        transform: { ...config.transform, ...transform, ...config.transform },
        transformIgnorePatterns: [`/node_modules/(?!(?:${packages})/)`],
        moduleNameMapper: { '^(.+)\\?client$': '$1', ...config.moduleNameMapper }
    };
}