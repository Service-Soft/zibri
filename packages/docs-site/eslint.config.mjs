import baseConfig from '../../eslint.config.mjs';
import { cspellOptions } from 'eslint-config-service-soft';

/** @type {import('eslint').Linter.Config} */
export default [
    ...baseConfig,
    // the routes the site served and the site it exported, which it writes itself
    { ignores: ['assets', 'dist', 'versions', '.generated'] },
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