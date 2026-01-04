import { configs } from 'eslint-config-service-soft';

/** @type {import('eslint').Linter.Config} */
export default [
    ...configs,
    {
        files: ['**/*.ts'],
        languageOptions: {
            parserOptions: {
                project: ['tsconfig.eslint.json']
            }
        }
    },
    { ignores: ['tsconfig.json', 'tsup.config.ts', 'sandbox', 'docs', 'src/di/default/temp', '**/__testing__/file-output/**'] },
    {
        files: ['**/__testing__/**/*.ts'],
        rules: {
            'jsdoc/require-jsdoc': 'off'
        }
    },
    {
        files: ['*.js', '*.mjs'],
        rules: {
            'jsdoc/require-description': 'off'
        }
    }
];