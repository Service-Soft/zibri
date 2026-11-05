/**
 * What deciding whether the values of one property cast into another's reads of each: a property as
 * an entity or a migration declares it, or as generating a migration compares it.
 */
export type CastCheckedProperty = {
    /**
     * Its type.
     */
    type: string,
    /**
     * What each item is, for an array.
     */
    items?: {
        /**
         * The type of the items.
         */
        type: string,
        /**
         * Their format.
         */
        format?: string
    }
};