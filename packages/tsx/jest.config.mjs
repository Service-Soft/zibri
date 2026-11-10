/** @type {import('ts-jest').JestConfigWithTsJest} **/
const config = {
    testEnvironment: 'node',
    rootDir: 'src',
    transform: {
        '^.+.tsx?$': ['ts-jest']
    },
    // the templates of the tests are compiled by the sources of zibri-tsx-compiler, which names this package: both from
    // their sources, so a test renders with the one runtime it compiled against, never a built copy beside the sources
    moduleNameMapper: {
        '^zibri-tsx$': '<rootDir>/index.ts',
        '^zibri-tsx/(.*)$': '<rootDir>/$1',
        '^zibri-tsx-compiler$': '<rootDir>/../../tsx-compiler/src/index.ts',
        '^zibri-tsx-compiler/(.*)$': '<rootDir>/../../tsx-compiler/src/$1'
    }
};

export default config;