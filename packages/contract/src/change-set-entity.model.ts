import { ChangeSet } from './change-set.model';

/**
 * An entity whose changes are tracked, as a ChangeSetRepository stores it.
 */
export type ChangeSetEntity = {
    /**
     * The id of the entity.
     */
    id: string,
    /**
     * Every change set of the entity, in any order.
     */
    changeSets: ChangeSet[]
};