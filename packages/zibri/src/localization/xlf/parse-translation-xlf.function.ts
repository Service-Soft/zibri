import { XmlUtilities } from '../../document/xml.utilities';

/**
 * Definition of a single translation.
 */
type TranslationXlfTransUnit = {
    /**
     * The id of the translation.
     */
    '@id': string,
    /**
     * The source string.
     */
    source: unknown,
    /**
     * The translation string.
     */
    target?: string, // plain string with {placeholder} format
    /**
     * Note about the translation. This includes the file where the translation is coming from.
     */
    note?: string
};

/**
 * Definition of a single translation file.
 */
type TranslationXlfFile = {
    /**
     * The source language of all the translations inside the file.
     */
    '@source-language': string,
    /**
     * The target language of all the translations inside the file.
     */
    '@target-language'?: string,
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
        'trans-unit': TranslationXlfTransUnit | TranslationXlfTransUnit[] | undefined
    }
};

/**
 * A xlf translation document.
 */
type TranslationXlfDocument = {
    /**
     * The xliff content.
     */
    xliff: {
        /**
         * Either a single or multiple translation files.
         */
        file: TranslationXlfFile | TranslationXlfFile[] | undefined
    }
};

/**
 * Parses a translated xlf file into a map of source → translated string.
 * @param content - The xlf file content.
 * @returns Map of source string to its translation.
 */
export function parseTranslationXlf(content: string): Record<string, string> {
    const obj: TranslationXlfDocument = XmlUtilities.parse(content);
    const result: Record<string, string> = {};

    for (const file of toArray(obj.xliff.file)) {
        for (const unit of toArray(file.body['trans-unit'])) {
            if (unit.target !== undefined) {
                result[unit['@id']] = unit.target;
            }
        }
    }

    return result;
}

// eslint-disable-next-line jsdoc/require-jsdoc
function toArray<T>(value: T | T[] | undefined): T[] {
    if (value === undefined) {
        return [];
    }
    return Array.isArray(value) ? value : [value];
}