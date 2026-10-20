import { XliffDocument } from './models/xliff-document.model.ts';
import { XliffFile } from './models/xliff-file.model.ts';
import { XliffSegment } from './models/xliff-segment.model.ts';
import { XliffTransUnit } from './models/xliff-trans-unit.model.ts';
import { ExtractedTranslationString } from './transform-source-translation-tokens.function.ts';
import { XmlString } from '../../document/xml-string.type.ts';
import { XmlWriterUtilities } from '../../document/xml-writer.utilities.ts';
import { XmlUtilities } from '../../document/xml.utilities.ts';
import { ObjectUtilities } from '../../utilities/object.utilities.ts';

// eslint-disable-next-line jsdoc-js/require-jsdoc
type CollectedString = {
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    source: string,
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    locations: { file: string, line: number }[]
};

/**
 * Generates a xlf source file from the given extracted translation strings.
 * @param strings - The extracted translation strings.
 * @returns The xlf file content.
 */
export function generateXlf(strings: ExtractedTranslationString[]): XmlString {
    const byGroup: Record<string, Record<string, CollectedString> | undefined> = {};

    for (const entry of strings) {
        const groupKey: string = `${entry.sourceLocale}::${entry.origin}`;
        const group: Record<string, CollectedString> = byGroup[groupKey] ?? {};
        byGroup[groupKey] = group;
        const collected: CollectedString = group[entry.source] ?? { source: entry.source, locations: [] };
        group[entry.source] = collected;
        collected.locations.push({ file: entry.file, line: entry.line });
    }

    const files: XliffFile[] = ObjectUtilities.keys(byGroup)
        .sort((a, b) => a.localeCompare(b))
        .map(groupKey => {
            const [locale = '', origin = ''] = groupKey.split('::');
            const units: XliffTransUnit[] = [...ObjectUtilities.values(byGroup[groupKey] ?? {})]
                .sort((a, b) => a.source.localeCompare(b.source))
                .map(unit => resolveTranslationUnit(unit));
            return { sourceLanguage: locale, datatype: 'plaintext', original: origin, body: { units } };
        });

    // indented, since the file is committed and read in diffs. Text is left exactly as it is, which
    // xml:space="preserve" asks for: a translator's tool reads every space inside a source as part of it.
    // Written without validating it: this runs in a build, where no application exists to validate
    // with, and the data is the framework's own
    const xml: string = XmlWriterUtilities.stringify(XliffDocument, { version: '1.2', files }, { indent: true });
    return XmlUtilities.resolveXmlString(xml);
}

// eslint-disable-next-line jsdoc-js/require-jsdoc
function resolveTranslationUnit({ source, locations }: CollectedString): XliffTransUnit {
    return {
        id: source,
        space: 'preserve',
        source: resolveSourceSegment(source),
        note: locations.map(l => `${l.file}:${l.line}`).join(', ')
    };
}

// eslint-disable-next-line jsdoc-js/require-jsdoc
function resolveSourceSegment(source: string): XliffSegment {
    const parts: XliffSegment['parts'] = [];
    const regex: RegExp = /{{|}}|{([^}]+)}/g;
    let textBuffer: string = '';
    let lastIndex: number = 0;
    let match: RegExpExecArray | null = regex.exec(source);

    while (match !== null) {
        textBuffer += source.slice(lastIndex, match.index);
        lastIndex = regex.lastIndex;

        if (match[0] === '{{') {
            textBuffer += '{';
        }
        else if (match[0] === '}}') {
            textBuffer += '}';
        }
        else {
            if (textBuffer) {
                parts.push({ shape: 'text', value: textBuffer });
                textBuffer = '';
            }
            // the branches above took the two alternatives that carry no group, so this one matched
            // the placeholder and its name is there
            const name: string = match[1] ?? '';
            parts.push({ shape: 'x', value: { id: name, equivText: `{${name}}` } });
        }

        match = regex.exec(source);
    }

    textBuffer += source.slice(lastIndex);
    if (textBuffer) {
        parts.push({ shape: 'text', value: textBuffer });
    }
    return { parts };
}