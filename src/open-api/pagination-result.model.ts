/**
 * Type of a pagination result, consisting of the items from the current page and the total amount of items.
 */
export type PaginationResult<T> = {
    /**
     * The items of the current page.
     */
    items: T[],
    /**
     * The total amount of items.
     */
    totalAmount: number
};