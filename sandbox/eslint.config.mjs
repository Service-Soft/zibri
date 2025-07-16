/* eslint-disable jsdoc/require-description */
import { configs } from 'eslint-config-service-soft';

/** @type {import('eslint').Linter.Config} */
export default [...configs, { rules: { 'jsdoc/require-jsdoc': 'off' } }, { ignores: ['assets'] }];