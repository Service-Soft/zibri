import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { Transaction } from './transaction.model';
import { createTestDataSource } from '../../__testing__/test-server/create-test-data-source.function';
import { createTestValKeyDataSource } from '../../__testing__/test-server/create-test-val-key-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { inject } from '../../di/inject.function';
import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { Newable } from '../../types/newable.type';
import { DataSourceInterface } from '../data-sources/data-source.interface';
import { PostgresDataSource } from '../data-sources/postgres/postgres-typeorm-data-source.model';
import { ValKeyDataSource } from '../data-sources/val-key/val-key-data-source.model';
import { MigrationEntity } from '../migration/migration-entity.model';
import { Repository } from '../repository/repository';

/**
 * What a valkey transaction that is started and then never finished keeps hold of.
 *
 * Valkey has no connection to lose - the whole data source shares one client - so this is the same
 * mistake against a different resource. A valkey transaction takes a grant on every key it is about
 * to overwrite and holds it until it commits or rolls back, and that grant is what stops two writers
 * of one row from both winning.
 *
 * The grant is kept alive by renewal rather than by a lease running out, so a transaction nothing
 * comes back to renews it for as long as the process lives. That is a wider blast radius than the
 * postgres case: the grant lives in valkey rather than in this process, so every replica that goes
 * to write those rows waits on a holder that is never coming back, and no replica can write them
 * again until the process that abandoned the transaction is restarted.
 */

@Entity({ allowOrphan: true })
class ValKeyItem extends BaseEntity {
    @Property.string()
    value!: string;
}

let server: StartedTestServer;
let dataSource: ValKeyDataSource;
let repo: Repository<ValKeyItem>;

const postgresDataSourceClass: Newable<DataSourceInterface> = createTestDataSource();

const valKeyDataSourceClass: Newable<ValKeyDataSource> = createTestValKeyDataSource({
    // MigrationEntity is duplicated across data sources on purpose, every one tracks its own migrations
    entities: [MigrationEntity, ValKeyItem]
});

describe('a valkey transaction that is never committed or rolled back', () => {
    beforeAll(async () => {
        server = await startTestServer({
            // the postgres data source keeps the framework entities working, the valkey one is what
            // this is about
            dataSources: [postgresDataSourceClass as Newable<PostgresDataSource>, valKeyDataSourceClass]
        });
        dataSource = inject(valKeyDataSourceClass);
        repo = inject(repositoryTokenFor(ValKeyItem));
    }, 15000);

    it('gives the rows it was holding back to everyone else', async () => {
        const item: ValKeyItem = await repo.create({ value: 'first' });

        // the mistake this is about: a transaction that writes and then reaches neither a commit nor
        // a rollback. The write is what takes the grant, so an empty transaction holds nothing
        // shorter than the default only so the test does not have to sit through it, and well inside
        // the ten seconds the write below waits for the grant
        const abandoned: Transaction = dataSource.startTransaction({ idleTimeoutInMs: 1000 });
        await repo.updateById(item.id, { value: 'abandoned' }, { transaction: abandoned });

        // an ordinary write of that row, by the next request, or by another replica entirely. It
        // needs the grant the abandoned transaction is holding
        await expect(repo.updateById(item.id, { value: 'next' })).resolves.toBeDefined();
    }, 60000);

    afterAll(async () => {
        await server.shutdown();
    }, 15000);
});