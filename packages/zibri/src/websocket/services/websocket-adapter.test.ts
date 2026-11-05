import { describe, expect, it } from '@jest/globals';
import { InMemoryDataSource } from 'zibri-testing';

import { TestTimeouts } from '../../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { DataSource } from '../../data-source/decorators/data-source.decorator';
import { RepositoryClass } from '../../data-source/repository/repository-class.type';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { defineProvider } from '../../di/models/di-provider.model';
import { BaseEntity } from '../../entity/base-entity.model';
import { Newable } from '../../types/newable.type';
import { Ms } from '../../utilities/ms';

/**
 * A data source carrying messages between instances, but only small ones, the way postgres does.
 */
@DataSource({ allowOrphan: true })
class SmallMessagesDataSource extends InMemoryDataSource {
    override readonly entities: Newable<BaseEntity>[] = defaultTestServerEntities;
    override readonly repositories: RepositoryClass[] = defaultTestServerRepositories;
    override readonly maxMessageBytes: number | undefined = 7999;
}

describe('WebsocketService — the adapter data source', () => {
    it('refuses one that carries only messages smaller than a broadcast can be', async () => {
        let server: StartedTestServer | undefined;
        try {
            const starting: Promise<void> = (async () => {
                server = await startTestServer({
                    dataSources: [SmallMessagesDataSource],
                    providers: [
                        ...defaultTestServerProviders,
                        defineProvider({
                            token: ZIBRI_DI_TOKENS.WEBSOCKET_OPTIONS_INPUT,
                            useValue: { messageRetentionInMs: Ms.DAY, adapterDataSource: SmallMessagesDataSource }
                        })
                    ]
                });
                await server.start();
            })();

            await expect(starting).rejects.toThrow(/SmallMessagesDataSource[\S\s]*7999 bytes/);
        }
        finally {
            await server?.shutdown();
        }
    }, TestTimeouts.inMemory.start);
});