const { resolveWebpackConfiguration } = require('zibri/webpack');

/**
 * The build as zibri ships it, which "npm update" keeps current. Change what it returns to
 * make a part of it this project's own.
 */
module.exports = resolveWebpackConfiguration({ root: __dirname });