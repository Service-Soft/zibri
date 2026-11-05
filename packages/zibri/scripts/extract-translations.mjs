import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The strings the framework marks for translation ship with it as translations/source.xlf, so a
// build of an application takes them from there rather than scanning the framework's sources on
// every build. Written from the built package, after it, because the extractor is part of it.

const require = createRequire(import.meta.url);
const { generateSourceXlf } = require('../dist/cjs/index.js');
const { getFrameworkTranslationOrigin } = require('../dist/cjs/internal.js');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await generateSourceXlf(root, [getFrameworkTranslationOrigin(root)]);