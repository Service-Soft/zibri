import { Readable } from 'stream';

/**
 * A html response.
 */
export class HtmlResponse {

    private constructor(readonly data: Readable | string) {}

    /**
     * Creates the response from the given html string.
     * @param html - The html value as a string.
     * @returns A new HtmlResponse.
     */
    static fromString(html: string): HtmlResponse {
        return new this(html);
    }

    /**
     * Creates the response from the given html stream.
     * @param stream - The html value as a stream.
     * @returns A new HtmlResponse.
     */
    static fromStream(stream: Readable): HtmlResponse {
        return new this(stream);
    }
}