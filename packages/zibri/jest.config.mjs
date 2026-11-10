import vm from 'node:vm';

// @faker-js/faker ships as ESM-only .js since v10, and jose, openid-client and the oauth4webapi it is built on always
// have, as do the markdown parser of zibri-mdx and what it is built on. Run with --experimental-vm-modules, as the
// scripts of package.json run it, jest loads such a package as it is, and one compiled to commonjs it would still load
// as an es module, failing on `exports`. Run without, by an editor say, matching them here (and un-ignoring them below)
// lets ts-jest down-compile "import"/"export" to CommonJS for Jest's runtime. The framework's optionalPeer goes through
// it too: inside a test, the require createRequire hands back is Jest's own. Asked the way jest asks
const loadsEsModules = typeof vm.SourceTextModule?.prototype?.hasAsyncGraph === 'function';
const esmPackages = '@faker-js/faker|jose|openid-client|oauth4webapi';

/** @type {import('ts-jest').JestConfigWithTsJest} **/
const config = {
    testEnvironment: 'node',
    rootDir: 'src',
    transform: {
        '^.+.tsx?$': ['ts-jest'],
        ...loadsEsModules
            ? {}
            : {
                [`/node_modules/(${esmPackages})/.+\\.js$`]: [
                    'ts-jest',
                    {
                        tsconfig: {
                            allowJs: true,
                            module: 'commonjs'
                        }
                    }
                ]
            }
    },
    transformIgnorePatterns: loadsEsModules ? ['/node_modules/'] : [`/node_modules/(?!(${esmPackages})/)`],
    // The harness is a package of its own, and this suite is its consumer - but it is also the
    // framework the harness imports. Both names resolve to the sources beside this file rather than
    // to a built `dist`: one physical copy of the framework in the process (two would be refused at
    // boot), and no build to go stale between a change and the test that covers it.
    moduleNameMapper: {
        '^zibri$': '<rootDir>/index.ts',
        '^zibri/internal$': '<rootDir>/internal.ts',
        '^zibri-testing$': '<rootDir>/../../testing/src/index.ts'
    },
    globalSetup: '<rootDir>/jest.global-setup.ts',
    setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
    bail: false,
    // memory, not cores, is what limits this suite. A worker that has loaded the framework holds
    // about a gigabyte, and anything that outlives a test file and reaches into it keeps that file's
    // whole environment alive. `node scripts/find-retained-test-environments.mjs <files>` names what
    // does; this restarts a worker before whatever is left adds up
    workerIdleMemoryLimit: '1GB',
    // with coverage, jest's own process received the sources of every module once per test file that
    // loaded it, and kept them all until the run was done: past 4 GB for this suite
    runner: '<rootDir>/__testing__/deduplicating-coverage.test-runner.ts',
    // a scratch folder, named by where it is: as a bare word this matched every path with `tmp` in
    // it, among them the temp directory the benchmark comparison checks the release out under, and
    // the release's suites were found nowhere
    modulePathIgnorePatterns: ['<rootDir>/tmp/'],
    // coverage
    // collectCoverage: true,
    coverageProvider: 'v8',
    coverageDirectory: '<rootDir>/__testing__/coverage',
    coveragePathIgnorePatterns: [
        '/node_modules/',
        '/dist/',
        '/mock/',
        '/sandbox/',
        '/src/__testing__/'
    ]
};

export default config;