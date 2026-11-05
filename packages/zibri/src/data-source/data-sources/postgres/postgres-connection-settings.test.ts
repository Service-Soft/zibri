import { describe, expect, it } from '@jest/globals';

import { PostgresDataSource, PostgresOptions } from './postgres-data-source.model';
import { PostgresPooler } from './postgres-pooler.model';
import { TestTimeouts } from '../../../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../../__testing__/test-server/create-test-data-source.function';
import { startTestServer } from '../../../__testing__/test-server/start-test-server.function';
import { BaseEntity } from '../../../entity/base-entity.model';
import { Newable } from '../../../types/newable.type';
import { DataSource } from '../../decorators/data-source.decorator';
import { SchemaManagement } from '../../models/schema-management.model';
import { RepositoryClass } from '../../repository/repository-class.type';

/**
 * Connects the way a data source does behind something that drops a connection's startup settings,
 * such as a pooler told to ignore them.
 */
@DataSource()
class DroppedSettingsDataSource extends PostgresDataSource {
    override options: PostgresOptions = {
        host: 'localhost',
        username: 'postgres',
        password: 'password',
        database: 'db',
        ssl: false
    };

    entities: Newable<BaseEntity>[] = defaultTestServerEntities;

    readonly repositories: RepositoryClass[] = defaultTestServerRepositories;

    schemaManagement: SchemaManagement = 'synchronize';

    readonly pooler: PostgresPooler = 'session';

    protected override resolveConnectionConfig(options: PostgresOptions, pooled: boolean): Record<string, unknown> {
        return { ...super.resolveConnectionConfig(options, pooled), options: undefined };
    }
}

// of the settings a connection asks for at startup, only the search similarity was checked,
// and only with a warning, so a connection without its statement timeout ran every statement unlimited
describe('a postgres data source whose connections lost their startup settings', () => {
    it('refuses to start, naming the statement timeout it asked for', async () => {
        await expect(startTestServer({ dataSources: [DroppedSettingsDataSource] })).rejects.toThrow('statement timeout of 30000 ms');
    }, TestTimeouts.postgres.start);
});