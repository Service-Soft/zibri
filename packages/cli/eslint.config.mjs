import { cspellOptions } from 'eslint-config-service-soft';
import baseConfig from '../../eslint.config.mjs';

/** @type {import('eslint').Linter.Config} */
export default [
    ...baseConfig,
    // recorded-sandbox-diffs.json holds diff output recorded by the sandbox parity test verbatim,
    // so its key order and wording are not ours to lint.
    { ignores: ['assets', 'sandbox', 'src/__testing__/file-output', 'src/__testing__/recorded-sandbox-diffs.json'] },
    {
        files: ['**/*.ts'],
        languageOptions: {
            parserOptions: {
                project: ['tsconfig.json']
            }
        }
    },
    {
        rules: {
            'cspell/spellchecker': [
                'warn',
                {
                    ...cspellOptions,
                    customWordListFile: '../../cspell.words.txt'
                }
            ]
        }
    }
];