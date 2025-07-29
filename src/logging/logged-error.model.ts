import { Property } from '../entity';

/**
 * A logged error.
 */
export class LoggedError {
    /**
     * The name of the error.
     */
    @Property.string()
    name!: string;
    /**
     * A paragraphs error with the error message.
     */
    @Property.array({ items: { type: 'string' } })
    paragraphs!: string[];
    /**
     * The stack trace of the error.
     */
    @Property.array({ items: { type: 'string' } })
    stackTrace!: string[];
}