// Fixture: a plain JavaScript worker file that reports whether a TypeScript compiler was started
// in the thread that ran it. A production worker file is compiled JavaScript, and the answer for
// one of those has to be no.
//
// The helpers come from the build rather than from source for the same reason the es module fixture
// takes them from there: source is TypeScript, and reaching it would need the very thing this is
// checking for.
const { sep } = require('node:path');
const { reportCompletion } = require('../../../dist/cjs/multithreading/services/worker/helpers.js');

// the package folder rather than the string: the framework's own register-ts-node.function.js is in
// this cache too, and its name is not the compiler being loaded.
reportCompletion(Object.keys(require.cache).some(p => p.includes(`node_modules${sep}ts-node${sep}`)));