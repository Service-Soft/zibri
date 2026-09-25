import { XliffDocument } from './models/xliff-document.model';
import { ExtractedTranslationString } from './transform-source-translation-tokens.function';
import { XmlUtilities } from '../../document/xml.utilities';

/**
 * Parses a xlf source file back into ExtractedTranslationStrings.
 * One entry is emitted per location so the result mirrors what the
 * transformer originally extracted.
 * @param content - The xlf file content.
 * @returns The extracted translation strings.
 */
export async function parseSourceXlf(content: string): Promise<ExtractedTranslationString[]> {
    const document: XliffDocument = await XmlUtilities.parseFrom(XliffDocument, content, { allowAdditionalProperties: true });
    const result: ExtractedTranslationString[] = [];

    for (const file of document.files ?? []) {
        for (const unit of file.body.units ?? []) {
            for (const location of (unit.note ?? '').split(', ')) {
                // Split on the last colon — safe since paths use forward slashes with no colons
                const lastColon: number = location.lastIndexOf(':');
                if (lastColon === -1) {
                    continue;
                }

                const locationFile: string = location.slice(0, lastColon);
                const line: number = Number.parseInt(location.slice(lastColon + 1), 10);

                if (locationFile && !Number.isNaN(line)) {
                    result.push({ source: unit.id, sourceLocale: file.sourceLanguage, origin: file.original, file: locationFile, line });
                }
            }
        }
    }

    return result;
}