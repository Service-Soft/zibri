/**
 * The index declaration a filter is answered from, and the entries of it the filter names.
 */
export type IndexLookup = {
    /**
     * The properties of the declaration, sorted.
     */
    group: string[],
    /**
     * The entries holding the ids of the rows the filter can match, each the values of the group as
     * `key=value` pairs joined by `:`, in the order of the group.
     */
    entries: string[]
};

/**
 * Encodes a value a filter names for a property into the form its index entry holds.
 * @param key - The property.
 * @param value - The value the filter names.
 * @returns The encoded value, or undefined when an index cannot answer for it, such as an operator
 * or null.
 */
export type IndexValueEncoder = (key: string, value: unknown) => string | undefined;