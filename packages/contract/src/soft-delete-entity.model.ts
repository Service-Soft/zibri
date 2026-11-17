import { ChangeSetEntity } from './change-set-entity.model';

/**
 * An entity whose changes are tracked and that is only marked as deleted, as a SoftDeleteRepository stores it.
 */
export type SoftDeleteEntity = ChangeSetEntity & {
    /**
     * Whether the entity is deleted.
     */
    deleted: boolean,
    /**
     * The id of the entity whose deletion took this one along, which restoring that one restores it with. Undefined or
     * null when it isn't deleted, or was deleted on its own.
     */
    deletedWith?: string | null
};