/** @type {import('ts-jest').JestConfigWithTsJest} **/
const config = {
    testEnvironment: 'node',
    rootDir: 'src',
    transform: {
        '^.+.tsx?$': ['ts-jest']
    },
    // zibri-tsx from its sources, as the tests of zibri-tsx load this package: a test renders what it compiles with
    // the one runtime it was compiled against, never a built copy beside the sources
    moduleNameMapper: {
        '^zibri-tsx$': '<rootDir>/../../tsx/src/index.ts',
        '^zibri-tsx/(.*)$': '<rootDir>/../../tsx/src/$1'
    }
};

export default config;