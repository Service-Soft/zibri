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
    transformIgnorePatterns: []
};

export default config;