import type { Config } from 'jest';

import { createJestConfig } from './create-jest-config.function';

/**
 * The jest configuration a Zibri application's tests run with, as a preset: what
 * `createJestConfig()` builds without options.
 *
 * Name it as the preset, like this.
 * ```js
 * export default { preset: 'zibri-testing', rootDir: 'src' };
 * ```
 */
const jestPreset: Config = createJestConfig();

export = jestPreset;
