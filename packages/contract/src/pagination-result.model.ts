/**
 * A page of items, as a list of zibri answers it.
 */
export type PaginationResult<T> = {
    /**
     * The items of the page.
     */
    items: T[],
    /**
     * How many items there are on all pages together.
     */
    totalAmount: number
};