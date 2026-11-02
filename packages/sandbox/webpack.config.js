const { resolveWebpackConfiguration } = require('zibri/webpack');

/**
 * The build as zibri ships it, which "npm update" keeps current. Change what it returns to
 * make a part of it this project's own.
 *
 * "npm run build -- --env deployment" builds what an image runs: the map beside the bundle names
 * the source file and line of every stack trace, without the sources themselves, which only an
 * editor opens from it.
 * @param env - What the build was given with "--env", such as "deployment".
 */
module.exports = env => resolveWebpackConfiguration({
    root: __dirname,
    sourceMap: env.deployment ? 'file-and-line' : 'with-sources'
});