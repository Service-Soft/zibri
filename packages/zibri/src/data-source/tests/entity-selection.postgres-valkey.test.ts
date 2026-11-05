import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { RoundTripCounter } from 'zibri-testing';

import { describeEntitySelection, entitySelectionEntities, EntitySelectionRepositories, Purchase, Shopper } from './entity-selection.cases';
import { TestTimeouts } from '../../__testing__/constants';
import { createTestDataSource, defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { createTestValKeyDataSource } from '../../__testing__/test-server/create-test-val-key-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { inject } from '../../di/inject.function';
import { Newable } from '../../types/newable.type';
import { PostgresDataSource } from '../data-sources/postgres/postgres-data-source.model';
import { ValKeyDataSource } from '../data-sources/val-key/val-key-data-source.model';
import { MigrationEntity } from '../migration/migration-entity.model';

const postgresRoundTrips: RoundTripCounter = new RoundTripCounter();

const postgresDataSourceClass: Newable<PostgresDataSource> = createTestDataSource({
    entities: [...defaultTestServerEntities, ...entitySelectionEntities],
    repositories: defaultTestServerRepositories,
    roundTrips: postgresRoundTrips
});

const valKeyDataSourceClass: Newable<ValKeyDataSource> = createTestValKeyDataSource({
    entities: [MigrationEntity, ...entitySelectionEntities]
});

let server: StartedTestServer | undefined;
let postgres: EntitySelectionRepositories;
let valKey: EntitySelectionRepositories;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [postgresDataSourceClass, valKeyDataSourceClass] });
    postgres = {
        shoppers: inject(postgresDataSourceClass).getRepository(Shopper),
        purchases: inject(postgresDataSourceClass).getRepository(Purchase)
    };
    valKey = {
        shoppers: inject(valKeyDataSourceClass).getRepository(Shopper),
        purchases: inject(valKeyDataSourceClass).getRepository(Purchase)
    };
}, TestTimeouts.resolveCombined('postgres', 'valKey').start);

afterAll(async () => {
    await server?.shutdown();
}, TestTimeouts.resolveCombined('postgres', 'valKey').shutdown);

describeEntitySelection('postgres', () => postgres);

describeEntitySelection('valkey', () => valKey);

describe('narrowing what a read hands back, in the statement postgres runs', () => {
    it('reads the columns a selection names, of the row and of the related rows, and no others', async () => {
        postgresRoundTrips.reset();

        await postgres.shoppers.findAll({ relations: ['purchases'], select: { name: true, purchases: { total: true } }, limit: 1 });

        const statements: string = postgresRoundTrips.trips.map(t => t.statement).join('\n');
        expect(statements).toContain('"name"');
        expect(statements).toContain('"total"');
        expect(statements).not.toContain('"email"');
        expect(statements).not.toContain('"note"');
    });
});