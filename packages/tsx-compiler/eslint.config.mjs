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
        files: ['**/*.ts'],
        rules: {
            // a namespace import of typescript compiles to a getter for each of its functions, which the walk of every
            // template calls millions of times; the default import reads them directly
            'no-restricted-syntax': [
                'warn',
                {
                    selector: 'ImportDeclaration[source.value=\'typescript\'] > ImportNamespaceSpecifier',
                    message: 'Import typescript as `import ts from \'typescript\'`: a namespace import compiles to getters.'
                }
            ]
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