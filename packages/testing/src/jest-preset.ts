import type { Config } from 'jest';

/**
 * The jest configuration a Zibri application's tests run with.
 *
 * TypeScript and the templates compiled to commonjs, which is what jest runs a test in, and a
 * template's `?client` import resolved to the package itself, as the build resolves it on the server.
 *
 * Name it as the preset, like this.
 * ```js
 * export default { preset: 'zibri-testing', rootDir: 'src' };
 * ```
 */
const jestPreset: Config = {
    testEnvironment: 'node',
    transform: {
        // the templates are compiled by zibri-tsx, as the zibri-tsx/webpack loader does for the build
        '^.+[\\\\/]src[\\\\/]templates[\\\\/].+\\.tsx$': 'zibri-tsx/jest',
        // ts-jest compiles to commonjs either way, and says so for every file when the tsconfig names nodenext
        '^.+.tsx?$': ['ts-jest', { tsconfig: { module: 'commonjs' } }],
        // jose ships as es modules only, which jest cannot require. The default auth strategy loads it
        // as the application starts, so it is compiled to commonjs like the sources
        '/node_modules/jose/.+\\.js$': ['ts-jest', { tsconfig: { allowJs: true, module: 'commonjs' } }]
    },
    transformIgnorePatterns: ['/node_modules/(?!jose/)'],
    moduleNameMapper: {
        '^(.+)\\?client$': '$1'
    }
};

export = jestPreset;