import { ExtractedTranslationString } from './transform-source-translation-tokens.function';
import { XmlUtilities } from '../../document/xml.utilities';

/**
 * Internal typed representation of the XLF object structure.
 */
type XlfTransUnit = {
    /**
     * The id of the translation.
     */
    '@id': string,
    /**
     * Mixed content — we use the id attribute instead.
     */
    source: unknown,
    /**
     * A description for the translation string.
     */
    note: string
};

/**
 * Definition of a single translation file.
 */
type XlfFile = {
    /**
     * The source language of all the translations inside the file.
     */
    '@source-language': string,
    /**
     * Where the translation string comes from, eg. 'zibri' or 'project'.
     */
    '@original': string,
    /**
     * The body of the file with the actual content.
     */
    body: {
        /**
         * Definitions of the translations.
         */
        'trans-unit': XlfTransUnit | XlfTransUnit[] | undefined
    }
};

/**
 * A xlf translation document.
 */
type XlfDocument = {
    /**
     * The xliff content.
     */
    xliff: {
        /**
         * Either a single or multiple translation files.
         */
        file: XlfFile | XlfFile[] | undefined
    }
};

// eslint-disable-next-line jsdoc/require-jsdoc
function toArray<T>(value: T | T[] | undefined): T[] {
    if (value === undefined) {
        return [];
    }
    return Array.isArray(value) ? value : [value];
}

/**
 * Parses a xlf source file back into ExtractedTranslationStrings.
 * One entry is emitted per location so the result mirrors what the
 * transformer originally extracted.
 * @param content - The xlf file content.
 * @returns The extracted translation strings.
 */
// eslint-disable-next-line sonar/cognitive-complexity
export function parseSourceXlf(content: string): ExtractedTranslationString[] {
    const obj: XlfDocument = XmlUtilities.parse(content);
    const result: ExtractedTranslationString[] = [];

    for (const file of toArray(obj.xliff.file)) {
        const sourceLocale: string = file['@source-language'];
        const origin: string = file['@original'];

        for (const unit of toArray(file.body['trans-unit'])) {
            const source: string = unit['@id'];
            const noteText: string = typeof unit.note === 'string' ? unit.note : '';

            for (const location of noteText.split(', ')) {
                // Split on the last colon — safe since paths use forward slashes with no colons
                const lastColon: number = location.lastIndexOf(':');
                if (lastColon === -1) {
                    continue;
                }

                const locationFile: string = location.slice(0, lastColon);
                const line: number = Number.parseInt(location.slice(lastColon + 1), 10);

                if (locationFile && !Number.isNaN(line)) {
                    result.push({ source, sourceLocale, origin, file: locationFile, line });
                }
            }
        }
    }

    return result;
}