import type { Config } from 'jest';

/**
 * What a Zibri application's jest configuration adds to the one `createJestConfig` builds: any jest
 * option, and the packages of its own that ship as es modules only.
 */
export type JestConfigOptions = Config & {
    /**
     * The packages the tests load that ship as es modules only, by their name. Jest cannot require
     * them, so they are compiled to commonjs like the sources.
     */
    esmPackages?: string[]
};