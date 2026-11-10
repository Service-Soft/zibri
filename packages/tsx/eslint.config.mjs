import { cspellOptions } from 'eslint-config-service-soft';
import baseConfig from '../../eslint.config.mjs';

/** @type {import('eslint').Linter.Config} */
export default [
    ...baseConfig,
    { ignores: ['dist', '**/__testing__/file-output/**'] },
    {
        files: ['**/*.ts'],
        languageOptions: {
            parserOptions: {
                project: ['tsconfig.json']
            }
        }
    },
    {
        // the entry points only re-export: the JSDoc of every name sits where it is declared, and the
        // shared config's ExportNamedDeclaration context also matches `export { X } from` lines. No-deprecated reports a
        // name re-exported here when one overload of it is deprecated, as of renderPage, though a re-export calls none
        files: ['src/index.ts', 'src/email/index.ts', 'src/internal.ts'],
        rules: {
            'jsdoc/require-jsdoc': 'off',
            'typescript/no-deprecated': 'off'
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