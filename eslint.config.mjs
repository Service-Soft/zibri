import { configs } from 'eslint-config-service-soft';

/** @type {import('eslint').Linter.Config} */
export default [
    ...configs,
    {
        files: ['*.js', '*.mjs'],
        rules: {
            'jsdoc/require-description': 'off'
        }
    },
    {
        // npm writes a manifest with every array spread over lines, one element or not, and so does the
        // release's version bump (.github/scripts/bump-version.mjs), which the release checks hold to
        // npm's own output. The shared config already lets npm's key order stand here for the same reason
        files: ['**/package.json'],
        rules: {
            'json/array-bracket-newline': 'off'
        }
    },
    {
        ignores: ['.zibri/uploads']
    }
];