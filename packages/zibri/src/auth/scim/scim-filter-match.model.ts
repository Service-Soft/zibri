/**
 * The users a part of a SCIM filter holds for, found ahead of the rest of the filter.
 */
export type ScimFilterMatch = {
    /**
     * The ids of the SCIM resources of the users.
     */
    ids: string[],
    /**
     * Whether the part holds for every user except those.
     */
    negated: boolean
};