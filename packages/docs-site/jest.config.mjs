import { createJestConfig } from 'zibri-testing/jest-config';

// the pages of the documentation are templates too, compiled as the build compiles them
export default createJestConfig({
    rootDir: 'src',
    transform: { '^.+[\\\\/]zibri[\\\\/]docs[\\\\/].+\\.md$': 'zibri-tsx-compiler/jest' }
});