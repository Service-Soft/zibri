const path = require('node:path');

const { resolveWebpackConfiguration } = require('zibri/webpack');

// the pages of the site are the documentation of the framework, which lives beside its sources
const DOCS_DIR = path.join(__dirname, '..', 'zibri', 'docs');

/**
 * The build as zibri ships it, with the pages of the documentation compiled as templates.
 * @param env - What the build was given with "--env".
 */
module.exports = env => {
    const configuration = resolveWebpackConfiguration({
        root: __dirname,
        sourceMap: env.deployment ? 'file-and-line' : 'with-sources'
    });
    configuration.module.rules.push({
        test: /\.md$/,
        include: DOCS_DIR,
        use: 'zibri-tsx-compiler/webpack'
    });
    return configuration;
};