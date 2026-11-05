import { type ChangeSetEntity } from './change-set-entity.model';

/**
 * `ChangeSetEntity`, or a class extending it that does not soft delete: what a base taking a
 * soft deleting class separately is handed for one that keeps every row.
 */
// the prototype is what tells the two apart in the type: a soft deleting class has `deleted` on it
export type ChangeSetOnlyEntityClass = typeof ChangeSetEntity & {
    /**
     * The instances of the class, which are not soft deleted.
     */
    readonly prototype: {
        /**
         * Absent, since the rows are never soft deleted.
         */
        readonly deleted?: undefined
    }
};