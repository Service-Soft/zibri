import config from './jest.config.mjs';

// The same suite against TypeScript 6. The compiler is written against TypeScript's API, and every
// major the peer range admits is one an application may have installed, so each one runs this suite.
// TypeScript 6 is installed under an alias, as the workspace itself builds with 5.9; ts-jest compiles
// the tests with that one either way, and only what the code under test loads is redirected.
/** @type {import('ts-jest').JestConfigWithTsJest} **/
export default {
    ...config,
    moduleNameMapper: {
        ...config.moduleNameMapper,
        '^typescript$': 'typescript-6'
    }
};