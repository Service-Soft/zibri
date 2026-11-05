import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { InMemoryDataSource, RoundTripCounter } from 'zibri-testing';

import { describeSpanningTransaction, SpanCard, SpanEntry, SpanLabel, SpanningTransactionRepositories } from './spanning-transaction.cases';
import { TestTimeouts } from '../../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { inject } from '../../di/inject.function';
import { BaseEntity } from '../../entity/base-entity.model';
import { Newable } from '../../types/newable.type';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { DataSource } from '../decorators/data-source.decorator';
import { MigrationEntity } from '../migration/migration-entity.model';
import { Repository } from '../repository/repository';
import { RepositoryClass } from '../repository/repository-class.type';
import { type RepositoryTransaction } from '../transaction/repository-transaction.type';
import { SpanningTransaction } from '../transaction/spanning-transaction.model';

/**
 * The data source a spanning transaction reaches first, holding the framework's entities as well.
 */
@DataSource()
class CardDataSource extends InMemoryDataSource {
    override readonly entities: Newable<BaseEntity>[] = [...defaultTestServerEntities, SpanCard, SpanLabel];
    override readonly repositories: RepositoryClass[] = defaultTestServerRepositories;
}

/**
 * The data source it reaches second.
 */
@DataSource()
class EntryDataSource extends InMemoryDataSource {
    override readonly entities: Newable<BaseEntity>[] = [MigrationEntity, SpanEntry];
    override readonly repositories: RepositoryClass[] = [];
}

const countedTrips: RoundTripCounter = new RoundTripCounter();

/**
 * A data source of the cards and nothing else, so that what is counted on it is what the cards cost.
 */
@DataSource()
class CountedDataSource extends InMemoryDataSource {
    override readonly entities: Newable<BaseEntity>[] = [MigrationEntity, SpanCard, SpanLabel];
    override readonly repositories: RepositoryClass[] = [];
    protected override readonly roundTrips: RoundTripCounter = countedTrips;
}

let server: StartedTestServer | undefined;
let repositories: SpanningTransactionRepositories;

/**
 * Counts what creating, changing and deleting a card costs the store in a transaction.
 * @param transaction - The transaction, which is committed afterwards.
 * @returns The calls the store was asked.
 */
async function countWritesIn(transaction: RepositoryTransaction): Promise<number> {
    const cards: Repository<SpanCard> = inject(CountedDataSource).getRepository(SpanCard);
    countedTrips.reset();
    const card: SpanCard = await cards.create({ batch: UUIDUtilities.generate(), name: 'card' }, { transaction });
    await cards.updateById(card.id, { name: 'changed' }, { transaction });
    await cards.deleteById(card.id, { transaction });
    await transaction.commit();
    return countedTrips.count;
}

beforeAll(async () => {
    server = await startTestServer({ dataSources: [CardDataSource, EntryDataSource, CountedDataSource] });
    repositories = {
        cards: inject(CardDataSource).getRepository(SpanCard),
        labels: inject(CardDataSource).getRepository(SpanLabel),
        entries: inject(EntryDataSource).getRepository(SpanEntry),
        cardsDataSourceName: CardDataSource.name,
        entriesDataSourceName: EntryDataSource.name
    };
}, TestTimeouts.inMemory.start);

afterAll(async () => {
    await server?.shutdown();
}, TestTimeouts.inMemory.shutdown);

describeSpanningTransaction('two in memory data sources', () => repositories);

describe('a spanning transaction that reaches one data source', () => {
    it('costs what a transaction of that data source costs', async () => {
        // the data source reached first is never restored, so nothing of it is read before a write
        const plain: number = await countWritesIn(await inject(CountedDataSource).startTransaction());
        const spanning: number = await countWritesIn(new SpanningTransaction());

        expect(spanning).toBe(plain);
    });
});