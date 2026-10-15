
/** @type {import('ts-jest').JestConfigWithTsJest} **/
const config = {
    testEnvironment: 'node',
    rootDir: 'src',
    transform: {
        '^.+.tsx?$': ['ts-jest'],
        // @faker-js/faker ships as ESM-only .js since v10, and jose, openid-client and the
        // oauth4webapi it is built on always have; matching them here (and un-ignoring them below)
        // lets ts-jest down-compile "import"/"export" to CommonJS for Jest's runtime. The framework's
        // optionalPeer goes through it too: inside a test, the require createRequire hands back is
        // Jest's own.
        '/node_modules/(@faker-js/faker|jose|openid-client|oauth4webapi)/.+\\.js$': [
            'ts-jest',
            {
                tsconfig: {
                    allowJs: true,
                    module: 'commonjs'
                }
            }
        ]
    },
    transformIgnorePatterns: ['/node_modules/(?!(@faker-js/faker|jose|openid-client|oauth4webapi)/)'],
    // The harness is a package of its own, and this suite is its consumer - but it is also the
    // framework the harness imports. Both names resolve to the sources beside this file rather than
    // to a built `dist`: one physical copy of the framework in the process (two would be refused at
    // boot), and no build to go stale between a change and the test that covers it.
    moduleNameMapper: {
        '^zibri$': '<rootDir>/index.ts',
        '^zibri-testing$': '<rootDir>/../../testing/src/index.ts'
    },
    globalSetup: '<rootDir>/jest.global-setup.ts',
    setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
    bail: false,
    modulePathIgnorePatterns: ['tmp'],
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