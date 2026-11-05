import { setTimeout as sleep } from 'node:timers/promises';

import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import type { GlideClient } from '@valkey/valkey-glide';

import { Transaction } from './transaction.model';
import { TestTimeouts } from '../../__testing__/constants';
import { createTestDataSource } from '../../__testing__/test-server/create-test-data-source.function';
import { createTestValKeyDataSource } from '../../__testing__/test-server/create-test-val-key-data-source.function';
import { defaultTestServerProviders } from '../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { defineProvider } from '../../di/models/di-provider.model';
import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { LoggerInterface } from '../../logging/logger.interface';
import { Newable } from '../../types/newable.type';
import { DataSourceInterface } from '../data-sources/data-source.interface';
import { ValKeyDataSource } from '../data-sources/val-key/val-key-data-source.model';
import { MigrationEntity } from '../migration/migration-entity.model';
import { Repository } from '../repository/repository';

/**
 * What a valkey transaction says about its locks while its commit is under way.
 *
 * The commit hands the locks back in the script that applies its writes, and they are renewed until
 * the commit has its answer. A commit of seventy thousand rows took long enough for a renewal to
 * arrive behind that script, which found every lock gone and warned that all of them had been lost -
 * to another instance, by the wording, while it was the commit itself that let them go.
 */

@Entity({ tenant: 'shared', allowOrphan: true })
class RenewedItem extends BaseEntity {
    @Property.string()
    value!: string;
}

/**
 * How long a lock lives, short so renewals come every third of it rather than every ten seconds.
 */
const HOLD_IN_MS: number = 300;

let server: StartedTestServer;
let dataSource: ValKeyDataSource;
let repo: Repository<RenewedItem>;

const postgresDataSourceClass: Newable<DataSourceInterface> = createTestDataSource();

const valKeyDataSourceClass: Newable<ValKeyDataSource> = createTestValKeyDataSource({
    // MigrationEntity is duplicated across data sources on purpose, every one tracks its own migrations
    entities: [MigrationEntity, RenewedItem]
});

describe('a valkey transaction whose commit outlasts a renewal of its locks', () => {
    beforeAll(async () => {
        server = await startTestServer({
            dataSources: [postgresDataSourceClass, valKeyDataSourceClass],
            providers: [
                ...defaultTestServerProviders,
                defineProvider({ token: ZIBRI_DI_TOKENS.VAL_KEY_TRANSACTION_LOCK_HOLD_IN_MS, useValue: HOLD_IN_MS })
            ]
        });
        dataSource = inject(valKeyDataSourceClass);
        repo = inject(repositoryTokenFor(RenewedItem));
    }, TestTimeouts.resolveCombined('postgres', 'valKey').start);

    afterAll(async () => {
        jest.restoreAllMocks();
        await server.shutdown();
    }, TestTimeouts.resolveCombined('postgres', 'valKey').shutdown);

    it('does not report the locks its own commit handed back as lost', async () => {
        const logger: LoggerInterface = inject(ZIBRI_DI_TOKENS.LOGGER);
        const warn: jest.SpiedFunction<LoggerInterface['warn']> = jest.spyOn(logger, 'warn');
        const transaction: Transaction = dataSource.startTransaction();
        await repo.createAll([{ value: 'first' }, { value: 'second' }], { transaction });

        // what a large batch does on its own, made certain: every script still runs on the server at
        // once, and its answer arrives a few renewals later. The commit's script has handed the locks
        // back by then, and the renewals sent while its answer is on the way find them gone
        const client: GlideClient = dataSource.connection;
        const invokeScript: GlideClient['invokeScript'] = client.invokeScript.bind(client);
        jest.spyOn(client, 'invokeScript').mockImplementation(async (script, options) => {
            const answer: Awaited<ReturnType<GlideClient['invokeScript']>> = await invokeScript(script, options);
            await sleep(HOLD_IN_MS);
            return answer;
        });
        await transaction.commit();
        // the renewals sent during the commit are answered after it
        await sleep(HOLD_IN_MS * 2);

        expect(warn.mock.calls.map(([message]) => message).filter(message => String(message).includes('while still working')))
            .toEqual([]);
    }, 30000);
});