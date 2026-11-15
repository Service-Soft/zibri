import { Newable } from '../../types/newable.type';

/**
 * What an entity declared `backedUp: { keptWith, by }` is kept across a restore of the application with:
 * the entity declared `backedUp: 'keptForCurrentUsers'` its rows belong to, and the property naming the row
 * of it each row belongs to. A restore keeps a row exactly when it keeps the row it names.
 */
export type KeptWith = {
    /**
     * The entity the rows belong to, declared `backedUp: 'keptForCurrentUsers'` in the same data source.
     */
    keptWith: () => Newable<unknown>,
    /**
     * The property holding the id of the row of that entity a row belongs to.
     */
    by: string
};