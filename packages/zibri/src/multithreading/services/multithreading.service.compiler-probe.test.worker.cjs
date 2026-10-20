// Fixture: a plain JavaScript worker file that reports whether a TypeScript compiler was started
// in the thread that ran it. A production worker file is compiled JavaScript, and the answer for
// one of those has to be no.
//
// The helpers come from the build rather than from source for the same reason the es module fixture
// takes them from there: source is TypeScript, and reaching it would need the very thing this is
// checking for.
const { sep } = require('node:path');
const { reportCompletion } = require('../../../dist/multithreading/services/worker/helpers.js');

// the compiler's native binding rather than the compiler's own module: `oxc-transform` is an es
// module, and what it loads through `require` is the binding, under the same scope on every platform
reportCompletion(Object.keys(require.cache).some(p => p.includes(`${sep}@oxc-transform${sep}`)));
