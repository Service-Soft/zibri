import { ChangeSetType } from './change-set-type.enum';
import { Change } from './change.model';

/**
 * Who changed what and when on an entity.
 */
export type ChangeSet = {
    /**
     * The id of the change set.
     */
    id: string,
    /**
     * The tenant of the entity, if it has one.
     */
    tenantId?: string | null,
    /**
     * What happened to the entity.
     */
    type: ChangeSetType,
    /**
     * When it happened, in nanoseconds since 1970, as a string: a bigint is sent as one.
     */
    createdAt: string,
    /**
     * Who made the change, usually the id of a user. Undefined or null for changes the system made.
     */
    createdBy?: string | null,
    /**
     * The values that changed.
     */
    changes: Change[],
    /**
     * The id of the entity the change set belongs to.
     */
    changeSetEntityId: string
};