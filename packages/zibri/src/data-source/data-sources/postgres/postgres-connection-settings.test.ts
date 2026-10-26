import { describe, expect, it } from '@jest/globals';

import { PostgresPooler } from './postgres-pooler.model';
import { PostgresDataSource, PostgresOptions } from './postgres-typeorm-data-source.model';
import { TestTimeouts } from '../../../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../../__testing__/test-server/create-test-data-source.function';
import { startTestServer } from '../../../__testing__/test-server/start-test-server.function';
import { BaseEntity } from '../../../entity/base-entity.model';
import { Newable } from '../../../types/newable.type';
import { OmitStrict } from '../../../types/omit-strict.type';
import { DataSource } from '../../decorators/data-source.decorator';
import { ResolvedDataSourceOptions } from '../../models/data-source-options.model';
import { SchemaManagement } from '../../models/schema-management.model';
import { RepositoryClass } from '../../repository/repository-class.type';

/**
 * Connects the way a data source does behind something that drops a connection's startup settings,
 * such as a pooler told to ignore them.
 */
@DataSource()
class DroppedSettingsDataSource extends PostgresDataSource {
    override options: OmitStrict<PostgresOptions, 'type' | 'entities'> = {
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

    protected override get fullOptions(): ResolvedDataSourceOptions<OmitStrict<PostgresOptions, 'type' | 'entities'>> {
        const options: ResolvedDataSourceOptions<OmitStrict<PostgresOptions, 'type' | 'entities'>> = super.fullOptions;
        return { ...options, extra: { ...options.extra, options: undefined } };
    }
}

// 02 §S3: of the settings a connection asks for at startup, only the search similarity was checked,
// and only with a warning, so a connection without its statement timeout ran every statement unlimited
describe('a postgres data source whose connections lost their startup settings', () => {
    it('refuses to start, naming the statement timeout it asked for', async () => {
        await expect(startTestServer({ dataSources: [DroppedSettingsDataSource] })).rejects.toThrow('statement timeout of 30000 ms');
    }, TestTimeouts.postgres.start);
});
