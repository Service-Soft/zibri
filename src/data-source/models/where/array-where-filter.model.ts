
/**
 * A filter for an array where property.
 */
export type ArrayWhereFilter<ItemType> = null | {
    /**
     * The property needs to equal the value.
     */
    equals: ItemType[]
} | {
    /**
     * The property needs to include the value.
     */
    includes?: ItemType[],
    /**
     * The properties items needs to be included in the value.
     */
    isIncludedIn?: ItemType[]
};