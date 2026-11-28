/**
 * A file or a folder on a WebDAV server, as a listing names it.
 * @template TProperty - The names of the further properties it was asked for with.
 */
export type WebDavEntry<TProperty extends string = never> = {
    /**
     * The last segment of its path.
     */
    readonly name: string,
    /**
     * Where it is, relative to the url of the connection, its segments separated by `/`.
     */
    readonly path: string,
    /**
     * Whether it is a file or a folder.
     */
    readonly kind: 'file' | 'folder',
    /**
     * How many bytes a file holds, or undefined for a folder and for a file the server names no size of.
     */
    readonly size: number | undefined,
    /**
     * The ETag, quotes included, as `ifMatch` of a put takes it, or undefined when the server names none.
     */
    readonly etag: string | undefined,
    /**
     * When it was last changed, or undefined when the server does not say.
     */
    readonly modifiedAt: Date | undefined,
    /**
     * The text of each further property it was asked for with, or undefined for one the server did not give.
     */
    readonly properties: Readonly<Record<TProperty, string | undefined>>
};