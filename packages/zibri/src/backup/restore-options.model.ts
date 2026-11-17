/**
 * How a backup is restored, beyond what it holds.
 */
export type RestoreOptions = {
    /**
     * The names of the resources to restore, such as the name of a data source, or undefined for every one
     * the backup holds. The resources restored are then not restored all or nothing together with the others:
     * one restored stays restored when a later restore of another fails.
     */
    resources?: string[],
    /**
     * Whether the restore keeps a copy of what each resource holds before it replaces it, which it puts back
     * when a resource fails part way. True by default. Without it, the restore needs room for the backup alone,
     * and a restore that fails part way leaves each resource as it got it.
     */
    putBack?: boolean,
    /**
     * Whether each resource deletes what it holds before the backup is applied, so that its server needs room
     * for the backup alone, where it holds both until the restore is done otherwise. False by default. What it
     * held is gone until a restore succeeds, unless `putBack` keeps a copy of it.
     */
    deleteFirst?: boolean,
    /**
     * Whether the restore goes on when this instance's disk looks too small for it. False by default. A
     * restore that then runs out of space fails, and puts back what it applied.
     */
    skipSpaceCheck?: boolean
};