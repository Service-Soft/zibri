import { cspellOptions } from '@service-soft/eslint-config';
import baseConfig from '../../eslint.config.mjs';

/** @type {import('eslint').Linter.Config} */
export default [
    ...baseConfig,
    { ignores: ['dist'] },
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