/**
 * A single value of an entity that changed in a change set.
 */
export type Change<T = unknown> = {
    /**
     * The id of the change.
     */
    id: string,
    /**
     * The tenant of the change set, if it has one.
     */
    tenantId?: string | null,
    /**
     * The name of the property that changed.
     */
    key: string,
    /**
     * The value before the change, undefined or null when there was none.
     */
    previousValue?: T | null,
    /**
     * The value after the change, undefined or null when there is none anymore.
     */
    newValue?: T | null,
    /**
     * The id of the change set the change belongs to.
     */
    changeSetId: string
};