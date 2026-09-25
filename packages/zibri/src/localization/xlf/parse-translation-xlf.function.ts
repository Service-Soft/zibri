import { XliffDocument } from './models/xliff-document.model';
import { XliffSegment } from './models/xliff-segment.model';
import { XmlUtilities } from '../../document/xml.utilities';

/**
 * Parses a translated xlf file into a map of source → translated string.
 *
 * A placeholder in a translation is read as `{name}`, whether the translator wrote it that way or kept the
 * `<x id="name"/>` of the source.
 * @param content - The xlf file content.
 * @returns Map of source string to its translation.
 */
export async function parseTranslationXlf(content: string): Promise<Record<string, string>> {
    const document: XliffDocument = await XmlUtilities.parseFrom(XliffDocument, content, { allowAdditionalProperties: true });
    const result: Record<string, string> = {};

    for (const file of document.files ?? []) {
        for (const unit of file.body.units ?? []) {
            if (unit.target !== undefined) {
                result[unit.id] = resolveTranslation(unit.target);
            }
        }
    }

    return result;
}

// eslint-disable-next-line jsdoc/require-jsdoc
function resolveTranslation(target: XliffSegment): string {
    return target.parts.map(part => part.shape === 'text' ? part.value : `{${part.value.id}}`).join('');
}