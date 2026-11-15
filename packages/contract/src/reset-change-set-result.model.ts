import { ChangeSetEntity } from './change-set-entity.model';

/**
 * What resetting a change set answers.
 */
export type ResetChangeSetResult<T extends ChangeSetEntity = ChangeSetEntity> = {
    /**
     * The entity after the change set was reset, with its change sets.
     */
    entity: T,
    /**
     * The values resetting changed.
     */
    changedValues: Partial<T>
};