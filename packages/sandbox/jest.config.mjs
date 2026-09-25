/** @type {import('ts-jest').JestConfigWithTsJest} **/
const config = {
    testEnvironment: 'node',
    rootDir: 'src',
    transform: {
        // the templates are compiled by zibri-tsx, as the zibri-tsx/webpack loader does for the build
        '^.+[\\/]src[\\/]templates[\\/].+\\.tsx$': 'zibri-tsx/jest',
        // commonjs, which is what jest runs a test in. ts-jest compiles to it either way, and says so
        // for every file when the tsconfig names nodenext instead
        '^.+.tsx?$': ['ts-jest', { tsconfig: { module: 'commonjs' } }]
    },
    // a package a template imports with ?client is the package itself on the server, which is how
    // the NormalModuleReplacementPlugin in webpack.config.js resolves it for the build
    moduleNameMapper: {
        '^(.+)\\?client$': '$1'
    }
};

export default config;