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
        // "__testing__" is where every package keeps what its tests share, beside the code they test.
        // Read as the root of the path below it, so the folders inside are still held to kebab case
        files: ['**/*.ts', '**/*.tsx'],
        rules: {
            'unicorn/filename-case': ['warn', { directoryRoots: [/(^|\/)__testing__$/u] }]
        }
    },
    {
        // a baseline is recorded by a run on one machine and never committed, see CODE_STYLE.md
        ignores: ['.zibri/uploads', '**/*.baseline.json']
    }
];