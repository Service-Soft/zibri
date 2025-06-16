
export type ArrayWhereFilter<ItemType> = null | { equals: ItemType[] } | {
    includes?: ItemType[],
    isIncludedIn?: ItemType[]
};