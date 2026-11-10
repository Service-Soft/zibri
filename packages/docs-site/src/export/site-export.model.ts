/**
 * What exporting the site wrote, and what a reader of it would run into.
 */
export type SiteExport = {
    /**
     * The files written, below the folder of the export, such as `auth/passkeys/index.html`.
     */
    files: string[],
    /**
     * Each link that leads nowhere, naming the page it is on.
     */
    problems: string[]
};