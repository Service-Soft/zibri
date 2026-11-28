/**
 * What the routes of the file mirror of Zibri take at most, so that a frontend checks a value before it sends it.
 */
// eslint-disable-next-line typescript/typedef
export const ZIBRI_FILE_MIRROR_LIMITS = {
    /**
     * The most conflicts a page holds.
     */
    CONFLICTS_PAGE_MAX_LIMIT: 100,
    /**
     * The longest path of a share link.
     */
    PATH_MAX_LENGTH: 1500,
    /**
     * The longest password of a share link.
     */
    PASSWORD_MAX_LENGTH: 1000
} as const;