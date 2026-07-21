import { ExtractedTranslationString } from './transform-source-translation-tokens.function';
import { XML, XmlUtilities } from '../../document/xml.utilities';
import { ObjectUtilities } from '../../utilities/object.utilities';

// eslint-disable-next-line jsdoc/require-jsdoc
type CollectedString = {
    // eslint-disable-next-line jsdoc/require-jsdoc
    source: string,
    // eslint-disable-next-line jsdoc/require-jsdoc
    locations: { file: string, line: number }[]
};

/**
 * Generates a xlf source file from the given extracted translation strings.
 * @param strings - The extracted translation strings.
 * @returns The xlf file content as a string.
 */
export function generateXlf(strings: ExtractedTranslationString[]): string {
    const byGroup: Record<string, Record<string, CollectedString> | undefined> = {};

    for (const entry of strings) {
        const groupKey: string = `${entry.sourceLocale}::${entry.origin}`;
        byGroup[groupKey] ??= {};
        byGroup[groupKey][entry.source] ??= { source: entry.source, locations: [] };
        byGroup[groupKey][entry.source].locations.push({ file: entry.file, line: entry.line });
    }

    const sortedKeys: string[] = ObjectUtilities.keys(byGroup).sort((a, b) => a.localeCompare(b));

    const doc: XML = XmlUtilities.create();
    const xliff: XML = doc.ele('xliff', {
        version: '1.2',
        xmlns: 'urn:oasis:names:tc:xliff:document:1.2'
    });

    for (const groupKey of sortedKeys) {
        const [locale, origin] = groupKey.split('::');
        const body: XML = xliff
            .ele('file', { 'source-language': locale, datatype: 'plaintext', original: origin })
            .ele('body');

        for (const unit of [...ObjectUtilities.values(byGroup[groupKey] ?? {})]
            .sort((a, b) => a.source.localeCompare(b.source))) {
            buildTranslationUnit(body, unit);
        }
    }

    return doc.end({ prettyPrint: true });
}

// eslint-disable-next-line jsdoc/require-jsdoc
function buildTranslationUnit(body: XML, { source, locations }: CollectedString): void {
    const transUnit: XML = body.ele('trans-unit', { id: source, 'xml:space': 'preserve' });
    buildSourceContent(transUnit.ele('source'), source);
    transUnit.ele('note').txt(locations.map(l => `${l.file}:${l.line}`).join(', '));
}

// eslint-disable-next-line jsdoc/require-jsdoc
function buildSourceContent(sourceEle: XML, source: string): void {
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
                sourceEle.txt(textBuffer);
                textBuffer = '';
            }
            const name: string = match[1];
            sourceEle.ele('x', { id: name, 'equiv-text': `{${name}}` });
        }

        match = regex.exec(source);
    }

    textBuffer += source.slice(lastIndex);
    if (textBuffer) {
        sourceEle.txt(textBuffer);
    }
}