import { TranslatedString } from '../localization/models/translated-string.model';

/**
 * A error that could be visible from the outside, requires messages to be translated strings.
 */
export abstract class ExternalError extends Error {
    /**
     * Whether or not this error is internal or visible from the outside.
     */
    readonly isInternal: false = false;
    /**
     * The title of the error.
     */
    title: TranslatedString;
    /**
     * A paragraphs error with the error message.
     */
    paragraphs: TranslatedString[];

    constructor(message: TranslatedString | TranslatedString[], title: TranslatedString, options?: ErrorOptions) {
        const singleString: string = typeof message === 'string' ? message : message.join('\n');
        super(singleString, options);
        this.name = 'ExternalError';
        this.paragraphs = typeof message === 'string' ? [message] : message;
        this.title = title;
    }
}