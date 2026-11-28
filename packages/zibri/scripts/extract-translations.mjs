import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The strings the framework marks for translation ship with it as translations/source.xlf, so a
// build of an application takes them from there rather than scanning the framework's sources on
// every build. Written from the built package, after it, because the extractor is part of it.

const require = createRequire(import.meta.url);
const { generateSourceXlf, XmlUtilities } = require('../dist/cjs/index.js');
const { getFrameworkTranslationOrigin, initDiContainer } = require('../dist/cjs/internal.js');
// no entry point exports these: only the framework reads and writes its xlf files as models
const { XmlWriterUtilities } = require('../dist/cjs/document/xml-writer.utilities.js');
const { XliffDocument } = require('../dist/cjs/localization/xlf/models/xliff-document.model.js');

/**
 * Reads a xlf file as the model the framework reads it as.
 * @param content - The xlf file content.
 * @returns The document.
 */
async function parseXliff(content) {
    return await XmlUtilities.parseFrom(XliffDocument, content, { allowAdditionalProperties: true });
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await generateSourceXlf(root, [getFrameworkTranslationOrigin(root)]);

// The translations the framework ships of its own strings, named in "translations" of its
// package.json, follow source.xlf: a new string gets a unit without a target, a removed one is
// dropped, and every target written stays. What is left to translate is printed.
// Reading a document as its model validates it, which needs the container
initDiContainer();
const { translations } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const source = await parseXliff(await readFile(path.join(root, 'translations', 'source.xlf'), 'utf8'));
for (const [locale, file] of Object.entries(translations ?? {})) {
    const filePath = path.join(root, file);
    const existing = await readFile(filePath, 'utf8').catch(() => undefined);
    const translated = existing === undefined ? undefined : await parseXliff(existing);
    const targets = new Map((translated?.files ?? []).flatMap(f => f.body.units ?? []).map(unit => [unit.id, unit.target]));
    const files = (source.files ?? []).map(sourceFile => ({
        ...sourceFile,
        targetLanguage: locale,
        // without the locations of source.xlf, which change with every edit of the sources
        body: { units: (sourceFile.body.units ?? []).map(unit => ({ ...unit, target: targets.get(unit.id), note: undefined })) }
    }));

    const xml = XmlWriterUtilities.stringify(XliffDocument, { version: source.version, files }, { indent: true });
    if (xml !== existing) {
        await writeFile(filePath, xml);
    }
    const untranslated = files
        .flatMap(f => f.body.units)
        .filter(unit => !unit.target?.parts.length)
        .map(unit => unit.id);
    if (untranslated.length) {
        // eslint-disable-next-line no-console
        console.log(`${file} needs a translation of:\n${untranslated.map(id => `  ${id}`).join('\n')}`);
    }
}