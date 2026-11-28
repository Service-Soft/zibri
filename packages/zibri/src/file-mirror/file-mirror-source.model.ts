/**
 * What a mirrored file is of, such as an invoice: the kind of row, and its id.
 */
export type FileMirrorSource = {
    /**
     * The kind of row, such as `invoice`, the same for every row of its kind.
     */
    type: string,
    /**
     * The id of the row.
     */
    id: string
};