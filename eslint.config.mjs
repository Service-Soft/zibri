import { configs } from 'eslint-config-service-soft';

/** @type {import('eslint').Linter.Config} */
export default [
    ...configs,
    { ignores: ['tsconfig.json', 'tsup.config.ts', 'sandbox', 'docs'] },
    {
        files: ['*.js', '*.mjs'],
        rules: {
            'jsdoc/require-description': 'off'
        }
    }
];