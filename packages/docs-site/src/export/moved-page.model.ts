/**
 * An address an earlier release published a page at, and where the page is now.
 */
export type MovedPage = {
    /**
     * The file of the old address, below the folder of the export, such as `documents/passkeys.html`.
     */
    from: string,
    /**
     * The address of the page now, such as `/zibri/auth/passkeys/`.
     */
    to: string
};