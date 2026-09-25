import { ValKeyDataSource, ValKeyOptions } from '../../data-source/data-sources/val-key/val-key-data-source.model';
import { DataSource } from '../../data-source/decorators/data-source.decorator';
import { MigrationEntity } from '../../data-source/migration/migration-entity.model';
import { Migration } from '../../data-source/migration/migration.model';
import { BaseEntity } from '../../entity/base-entity.model';
import { Newable } from '../../types/newable.type';
import { UUIDUtilities } from '../../utilities/uuid.utilities';

export type CreateTestValKeyDataSourceOptions = {
    /**
     * The entities of the data source. Needs to include the MigrationEntity.
     */
    entities?: Newable<BaseEntity>[],
    /**
     * The migrations of the data source.
     */
    migrations?: Newable<Migration>[],
    /**
     * The host of the valkey server, the port is filled in by the test server.
     */
    host?: string
};

/**
 * The entities that a valkey test data source needs at the very least.
 */
export const defaultTestValKeyEntities: Newable<BaseEntity>[] = [MigrationEntity];

/**
 * Creates a valkey data source class that can be handed to startTestServer.
 *
 * Every data source gets its own random key prefix so that tests which share a container
 * cannot see the keys of each other.
 * @param options - The options of the data source to create.
 * @returns A newable valkey data source.
 */
export function createTestValKeyDataSource(
    options: CreateTestValKeyDataSourceOptions = {}
): Newable<ValKeyDataSource & { entities: Newable<BaseEntity>[] }> {
    const {
        entities = defaultTestValKeyEntities,
        migrations = [],
        host = 'localhost'
    } = options;

    @DataSource()
    class ValKeyDbDataSource extends ValKeyDataSource {
        override options: ValKeyOptions = {
            host,
            keyPrefix: `test-${UUIDUtilities.generate()}`
        };
        entities: Newable<BaseEntity>[] = entities;
        override migrations: Newable<Migration>[] = migrations;
    }

    return ValKeyDbDataSource;
}