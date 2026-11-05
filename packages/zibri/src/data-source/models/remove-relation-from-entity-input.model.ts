import { EntityMigrationInput } from './entity-migration-input.model';
import { MigrationTableReference } from './migration-table-reference.model';
import { BaseEntity } from '../../entity/base-entity.model';
import { Newable } from '../../types/newable.type';

/**
 * What a migration says when it removes a relation of an entity.
 */
export type RemoveRelationFromEntityInput<T extends BaseEntity> = EntityMigrationInput<T> & {
    /**
     * The relation, with the entity on its other side.
     */
    relation: {
        /**
         * The relation's property on the entity.
         */
        name: keyof T | string & {},
        /**
         * The entity on its other side: its class, or the table it is stored in.
         */
        target: Newable<BaseEntity> | MigrationTableReference,
        /**
         * The property on the other side that points back.
         */
        inverseSide: string
    }
};