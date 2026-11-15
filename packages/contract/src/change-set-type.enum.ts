/**
 * What happened to an entity in a change set.
 */
export enum ChangeSetType {
    /**
     * The entity was created.
     */
    CREATE = 'create',
    /**
     * The entity was replaced as a whole.
     */
    REPLACE = 'replace',
    /**
     * An earlier change set was undone.
     */
    RESET = 'reset',
    /**
     * Some of the values of the entity changed.
     */
    UPDATE = 'update',
    /**
     * The entity was deleted.
     */
    DELETE = 'delete',
    /**
     * A soft deleted entity was restored.
     */
    RESTORE = 'restore'
}