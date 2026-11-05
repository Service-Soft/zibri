import { createJestConfig } from 'zibri-testing/jest-config';

// how TypeScript, the templates and the packages the framework loads are compiled for a test. A
// package of your own that ships as es modules only goes in esmPackages
export default createJestConfig({ rootDir: 'src' });