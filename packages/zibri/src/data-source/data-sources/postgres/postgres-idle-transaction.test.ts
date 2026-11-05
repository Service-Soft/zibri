import { setTimeout as sleep } from 'node:timers/promises';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { PostgresDataSource } from './postgres-data-source.model';
import { TestServerTimeouts, TestTimeouts } from '../../../__testing__/constants';
import { queryPostgres } from '../../../__testing__/query-postgres.function';
import { createTestDataSource, defaultTestServerEntities, defaultTestServerRepositories } from '../../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../../__testing__/test-server/start-test-server.function';
import { repositoryTokenFor } from '../../../di/decorators/inject-repository.decorator';
import { inject } from '../../../di/inject.function';
import { BaseEntity } from '../../../entity/base-entity.model';
import { Entity } from '../../../entity/decorators/entity.decorator';
import { Property } from '../../../entity/decorators/property.decorator';
import { Newable } from '../../../types/newable.type';
import { Repository } from '../../repository/repository';
import { Transaction } from '../../transaction/transaction.model';

/**
 * How long the database lets a transaction sit idle, as an operator may set it for every connection.
 */
const DATABASE_IDLE_LIMIT_IN_MS: number = 1000;

const timeouts: TestServerTimeouts = TestTimeouts.postgres;

@Entity({ tenant: 'shared' })
class IdleItem extends BaseEntity {
    @Property.string()
    value!: string;
}

const dataSourceClass: Newable<PostgresDataSource> = createTestDataSource({
    entities: [...defaultTestServerEntities, IdleItem],
    repositories: defaultTestServerRepositories
});

let server: StartedTestServer | undefined;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [dataSourceClass] });
    const database: string = inject(dataSourceClass).options.database ?? 'db';
    await queryPostgres(
        inject(dataSourceClass),
        `ALTER DATABASE "${database}" SET idle_in_transaction_session_timeout = ${DATABASE_IDLE_LIMIT_IN_MS}`
    );
    // on connections opened from now on, which is what a restart holds
    await server.reInit();
}, timeouts.start + timeouts.restart);

afterAll(async () => {
    await server?.shutdown();
}, timeouts.shutdown);

// a transaction that may sit idle for as long as it likes,
// which is what a migration's is, set no limit of its own, and so got whatever the database set
describe('a transaction that may sit idle for as long as it likes', () => {
    it('outlasts an idle limit the database sets', async () => {
        const items: Repository<IdleItem> = inject(repositoryTokenFor(IdleItem));
        const transaction: Transaction = await inject(dataSourceClass).startTransaction({ idleTimeoutInMs: 0 });
        await sleep(2 * DATABASE_IDLE_LIMIT_IN_MS);

        await expect((async () => {
            await items.create({ value: 'written after a pause' }, { transaction });
            await transaction.commit();
        })()).resolves.toBeUndefined();
        expect(await items.findAll({ where: { value: 'written after a pause' } })).toHaveLength(1);
    }, (4 * DATABASE_IDLE_LIMIT_IN_MS) + timeouts.restart);
});