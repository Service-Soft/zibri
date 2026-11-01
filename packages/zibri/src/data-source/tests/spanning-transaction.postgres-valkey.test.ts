import { afterAll, beforeAll } from '@jest/globals';

import { describeSpanningTransaction, SpanCard, SpanEntry, SpanLabel, SpanningTransactionRepositories } from './spanning-transaction.cases';
import { TestTimeouts } from '../../__testing__/constants';
import { createTestDataSource, defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { createTestValKeyDataSource } from '../../__testing__/test-server/create-test-val-key-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { inject } from '../../di/inject.function';
import { Newable } from '../../types/newable.type';
import { PostgresDataSource } from '../data-sources/postgres/postgres-data-source.model';
import { ValKeyDataSource } from '../data-sources/val-key/val-key-data-source.model';
import { MigrationEntity } from '../migration/migration-entity.model';

// every entity in both, so that each one holds the cards in one of the pairs, and is the one restored
// when the other fails
const postgresDataSourceClass: Newable<PostgresDataSource> = createTestDataSource({
    entities: [...defaultTestServerEntities, SpanCard, SpanLabel, SpanEntry],
    repositories: defaultTestServerRepositories
});

const valKeyDataSourceClass: Newable<ValKeyDataSource> = createTestValKeyDataSource({ entities: [MigrationEntity, SpanCard, SpanLabel, SpanEntry] });

let server: StartedTestServer | undefined;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [postgresDataSourceClass, valKeyDataSourceClass] });
}, TestTimeouts.resolveCombined('postgres', 'valKey').start);

afterAll(async () => {
    await server?.shutdown();
}, TestTimeouts.resolveCombined('postgres', 'valKey').shutdown);

/**
 * The repositories of the cases, the cards in one data source and the entries in the other.
 * @param cardsIn - The data source of the cards.
 * @param entriesIn - The data source of the entries.
 * @returns The repositories.
 */
function repositoriesIn(
    cardsIn: Newable<PostgresDataSource | ValKeyDataSource>,
    entriesIn: Newable<PostgresDataSource | ValKeyDataSource>
): SpanningTransactionRepositories {
    return {
        cards: inject(cardsIn).getRepository(SpanCard),
        labels: inject(cardsIn).getRepository(SpanLabel),
        entries: inject(entriesIn).getRepository(SpanEntry),
        cardsDataSourceName: cardsIn.name,
        entriesDataSourceName: entriesIn.name
    };
}

describeSpanningTransaction('postgres, then valkey', () => repositoriesIn(postgresDataSourceClass, valKeyDataSourceClass));

describeSpanningTransaction('valkey, then postgres', () => repositoriesIn(valKeyDataSourceClass, postgresDataSourceClass));
