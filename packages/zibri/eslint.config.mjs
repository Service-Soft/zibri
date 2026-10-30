import { cspellOptions } from 'eslint-config-service-soft';
import baseConfig from '../../eslint.config.mjs';

/** @type {import('eslint').Linter.Config} */
export default [
    ...baseConfig,
    {
        ignores: [
            'docs',
            'src/di/default/temp',
            '**/__testing__/file-output/**',
            // a recording of the tables typeorm built, kept as it recorded them
            'src/data-source/data-sources/postgres/postgres-schema.typeorm-tables.json'
        ]
    },
    {
        files: ['**/*.ts'],
        languageOptions: {
            parserOptions: {
                project: ['tsconfig.json']
            }
        }
    },
    {
        files: ['**/__testing__/**/*.ts'],
        rules: {
            'jsdoc/require-jsdoc': 'off'
        }
    },
    {
        // the entry points only re-export: the JSDoc of every name sits where it is declared, and the
        // shared config's ExportNamedDeclaration context also matches `export { X } from` lines
        files: ['src/index.ts', 'src/internal.ts'],
        rules: {
            'jsdoc/require-jsdoc': 'off'
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