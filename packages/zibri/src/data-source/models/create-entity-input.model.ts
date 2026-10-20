import { EntityMigrationInput } from './entity-migration-input.model.ts';
import { MigrationPropertyMetadata } from './migration-property-metadata.model.ts';
import { BaseEntity } from '../../entity/base-entity.model.ts';

/**
 * What a migration says when it creates what an entity is stored in.
 *
 * The properties are either written out as they were in the release that introduces the entity, or
 * `'resolveFromEntity'` to take them from the entity as it is declared now. Written out, the migration
 * creates the same thing in every later version. Resolved, it creates whatever the entity has become
 * by the time it runs, which a later migration changing the entity then finds already changed.
 *
 * Indexes and uniques are not part of it: the data source creates the ones the entity declares once
 * the migrations have run.
 */
export type CreateEntityInput<T extends BaseEntity> = EntityMigrationInput<T> & {
    /**
     * The properties by name, `id` included when it is not the default primary key. Relations are only
     * created when resolved from the entity.
     */
    properties: Record<string, MigrationPropertyMetadata> | 'resolveFromEntity'
};