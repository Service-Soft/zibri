import { configs } from 'eslint-config-service-soft';

// eslint-disable-next-line jsdoc/require-description
/** @type {import('eslint').Linter.Config} */
export default [...configs, { rules: { 'jsdoc/require-jsdoc': 'off' } }, { ignores: ['assets'] }];