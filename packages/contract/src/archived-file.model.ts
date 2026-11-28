/**
 * A file of an archived row as the row recorded it when it was created, as the routes answering such a row hold it.
 */
export type ArchivedFileModel = {
    /**
     * The id of the file.
     */
    id: string,
    /**
     * The SHA-256 of its bytes, in hex.
     */
    sha256: string,
    /**
     * The ids of its copies in further file stores.
     */
    copies: string[]
};