/** @type {import('ts-jest').JestConfigWithTsJest} **/
const config = {
    testEnvironment: 'node',
    rootDir: 'src',
    transform: {
        // Several deps (chalk, inquirer, ...) ship as ESM-only .js; matching them here (and
        // un-ignoring node_modules below) lets ts-jest down-compile "import"/"export" to
        // CommonJS for Jest's runtime. Only files actually required by the tests get touched.
        '^.+\\.[tj]sx?$': [
            'ts-jest', {
                tsconfig: {
                    allowJs: true,
                    module: 'commonjs'
                }
            }
        ]
    },
    transformIgnorePatterns: [],
    // what the tests write. A generated project carries a test of its own, and it is meant to run
    // inside that project against its own installed framework rather than to be collected as one of
    // this package's suites.
    modulePathIgnorePatterns: ['<rootDir>/__testing__/file-output'],
    // coverage
    coverageProvider: 'v8',
    coverageDirectory: '<rootDir>/__testing__/coverage',
    coveragePathIgnorePatterns: [
        '/node_modules/',
        '/dist/',
        '/src/__testing__/',
        // what the cli writes rather than what it is. A template is copied into a generated project
        // and compiled there, so the lines it does or does not execute belong to that project
        '/templates/'
    ]
};

export default config;