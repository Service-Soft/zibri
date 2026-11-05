import baseConfig from '../../eslint.config.mjs';
import { cspellOptions } from 'eslint-config-service-soft';

/** @type {import('eslint').Linter.Config} */
export default [
    ...baseConfig,
    { ignores: ['assets'] },
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
    },
    { rules: { 'jsdoc/require-jsdoc': 'off' } }
];