'use strict';

// TODO 4.0: remove forward/ and the subpaths `compiler`, `webpack` and `jest` of package.json that lead here.
//
// The compiler is the package zibri-tsx-compiler, which an application installs as a devDependency. zibri-tsx names
// nothing of it, not even as an optional peer: a package manager keeps a package a production one names in a
// deployment, and the compiler with TypeScript is what building needs, never what running does. So it is looked up
// from the project being built first, and from here second, where a hoisting package manager puts it too.
//
// These subpaths are mostly named as strings, the loader of a webpack config or the transform of a jest config, where
// no editor strikes a deprecated name through. So loading one says so, as a warning of node's own, once per subpath.

/**
 * The subpaths loaded in this process, each warned about once.
 */
const warned = new Set();

/**
 * Loads a subpath of the zibri-tsx-compiler the project installed.
 * @param subpath - The subpath, such as `/webpack`, or `''` for the package itself.
 * @returns Its exports.
 * @throws When the project has no zibri-tsx-compiler.
 */
function loadCompiler(subpath) {
    const name = `zibri-tsx-compiler${subpath}`;
    if (!warned.has(subpath)) {
        warned.add(subpath);
        process.emitWarning(
            `zibri-tsx${subpath || '/compiler'} is removed in 4.0. Name ${name} instead, which your project installs as a `
            + 'devDependency.',
            { type: 'DeprecationWarning', code: 'ZIBRI_TSX_COMPILER_SUBPATH' }
        );
    }
    let resolved;
    try {
        resolved = require.resolve(name, { paths: [process.cwd(), __dirname] });
    }
    catch (error) {
        throw new Error(
            `zibri-tsx${subpath || '/compiler'} is zibri-tsx-compiler${subpath} now. Install it with:\n`
            + 'npm i -D zibri-tsx-compiler',
            { cause: error }
        );
    }
    return require(resolved);
}

module.exports = { loadCompiler };