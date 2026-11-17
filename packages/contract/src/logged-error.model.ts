/**
 * The error of a log.
 */
export type LoggedError = {
    /**
     * The name of the error, like 'TypeError'.
     */
    name: string,
    /**
     * What went wrong, a line each, followed by its causes.
     */
    paragraphs: string[],
    /**
     * Where it went wrong, a line each, as the browser or the server wrote it.
     */
    stackTrace: string[]
};