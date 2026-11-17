import { cspellOptions } from '@service-soft/eslint-config';
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
        // what a cluster suite boots its instances with is test material like the rest of __testing__,
        // kept beside the suite rather than in it
        files: ['**/__testing__/**/*.ts', '**/*.instance-options.ts'],
        rules: {
            'jsdoc/require-jsdoc': 'off'
        }
    },
    {
        // tests and the cases they share are published nowhere: what they hold is said by their names, and a
        // comment where one helps
        files: ['**/*.test.ts', '**/*.cases.ts'],
        rules: {
            'jsdoc/require-jsdoc': 'off',
            'jsdoc/require-description': 'off',
            'jsdoc/require-param': 'off',
            'jsdoc/require-param-description': 'off',
            'jsdoc/require-returns': 'off',
            'jsdoc/require-yields': 'off',
            'jsdoc/require-throws': 'off',
            'jsdoc/check-indentation': 'off'
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