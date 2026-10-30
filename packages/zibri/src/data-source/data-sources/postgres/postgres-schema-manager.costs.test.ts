import { beforeAll, describe, expect, it } from '@jest/globals';
import { RoundTripCounter } from 'zibri-testing';

import { PostgresDataSource, PostgresOptions } from './postgres-data-source.model';
import { PostgresPooler } from './postgres-pooler.model';
import { TestTimeouts } from '../../../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../../__testing__/test-server/start-test-server.function';
import { Injectable } from '../../../di/decorators/injectable.decorator';
import { BaseEntity } from '../../../entity/base-entity.model';
import { Entity } from '../../../entity/decorators/entity.decorator';
import { Property } from '../../../entity/decorators/property.decorator';
import { Newable } from '../../../types/newable.type';
import { SemVerVersion } from '../../../utilities/sem-ver.utilities';
import { DataSource } from '../../decorators/data-source.decorator';
import { MigrationEntity } from '../../migration/migration-entity.model';
import { Migration } from '../../migration/migration.model';
import { SchemaManagement } from '../../models/schema-management.model';
import { RepositoryClass } from '../../repository/repository-class.type';
import { Transaction } from '../../transaction/transaction.model';

/**
 * What setting the schema up costs a boot, in round trips: the same however many entities the data
 * source declares, on a database holding nothing and on one already matching them, whether it
 * synchronizes or runs migrations. Every boot of every instance pays it, before the application serves
 * anything.
 */

// orphaned for the server that boots without them
@Entity({ tenant: 'shared', allowOrphan: true })
class SyncedProject extends BaseEntity {
    @Property.string()
    name!: string;
}

@Entity({ tenant: 'shared', allowOrphan: true })
class SyncedTask extends BaseEntity {
    @Property.string()
    title!: string;

    @Property.number({ format: 'integer', required: false })
    estimate: number | undefined | null;
}

@Entity({ tenant: 'shared', allowOrphan: true })
class SyncedComment extends BaseEntity {
    @Property.string()
    text!: string;
}

@Entity({ tenant: 'shared', allowOrphan: true })
class SyncedLabel extends BaseEntity {
    @Property.string()
    color!: string;
}

@Entity({ tenant: 'shared', allowOrphan: true })
class SyncedMilestone extends BaseEntity {
    @Property.date({ required: false })
    dueAt: Date | undefined | null;
}

/**
 * Entities declaring nothing but their columns, so that a boot has nothing to do for them beyond
 * creating their tables once.
 */
const PLAIN_ENTITIES: Newable<BaseEntity>[] = [SyncedProject, SyncedTask, SyncedComment, SyncedLabel, SyncedMilestone];

/**
 * The statements one boot sent while its data source set itself up.
 */
type BootStatements = {
    /**
     * The boot on a database holding nothing.
     */
    first: string[],
    /**
     * The boot after it, on the schema the first one built.
     */
    again: string[]
};

/**
 * Builds a data source that records the statements it sends while it sets itself up, and nothing it
 * sends once the application runs. Managed by migrations, it ships one migration creating every entity,
 * and leaves the statements that migration sends out: those are the migration's, one per call it makes.
 * @param entities - The entities.
 * @param roundTrips - Where the statements are recorded.
 * @param schemaManagement - Who manages the schema.
 * @returns The data source.
 */
function createMeasuredDataSource(
    entities: Newable<BaseEntity>[],
    roundTrips: RoundTripCounter,
    schemaManagement: SchemaManagement
): Newable<PostgresDataSource> {
    let migrating: boolean = false;

    @Injectable()
    class CreateEveryEntityMigration extends Migration {
        version: SemVerVersion = '0.0.1';

        constructor() {
            super(MeasuredDataSource);
        }

        override async up(transaction: Transaction): Promise<void> {
            migrating = true;
            try {
                // the migration table is the one the data source creates itself, before any migration runs
                for (const entity of entities.filter(e => e !== MigrationEntity)) {
                    await this.dataSource.createEntity({ entity, properties: 'resolveFromEntity', transaction });
                }
            }
            finally {
                migrating = false;
            }
        }

        // eslint-disable-next-line typescript/require-await
        override async down(): Promise<void> {
            throw new Error('Not implemented yet.');
        }
    }

    // orphaned on purpose: each server boots one of the data sources this file measures
    @DataSource({ allowOrphan: true })
    class MeasuredDataSource extends PostgresDataSource {
        override options: PostgresOptions = {
            host: 'localhost',
            username: 'postgres',
            password: 'password',
            database: 'db',
            ssl: false
        };

        entities: Newable<BaseEntity>[] = entities;

        readonly repositories: RepositoryClass[] = defaultTestServerRepositories;

        schemaManagement: SchemaManagement = schemaManagement;

        override migrations: Newable<Migration>[] = schemaManagement === 'migrations' ? [CreateEveryEntityMigration] : [];

        readonly pooler: PostgresPooler = 'none';

        private settingUp: boolean = false;

        override async init(): Promise<void> {
            this.settingUp = true;
            try {
                await super.init();
            }
            finally {
                this.settingUp = false;
            }
        }

        protected override onStatementSent(statement: string): void {
            if (this.settingUp && !migrating) {
                roundTrips.record(statement);
            }
        }
    }
    return MeasuredDataSource;
}

/**
 * Boots a server on a database of its own, then boots it again on the schema the first boot built.
 * @param dataSourceClass - The data source to boot.
 * @param roundTrips - Where the data source records its statements.
 * @returns The statements of both boots.
 */
async function resolveBootStatements(dataSourceClass: Newable<PostgresDataSource>, roundTrips: RoundTripCounter): Promise<BootStatements> {
    roundTrips.reset();
    const server: StartedTestServer = await startTestServer({ dataSources: [dataSourceClass] });
    try {
        const first: string[] = roundTrips.trips.map(trip => trip.statement);
        roundTrips.reset();
        await server.reInit();
        return { first, again: roundTrips.trips.map(trip => trip.statement) };
    }
    finally {
        await server.shutdown();
    }
}

/**
 * What one boot cost, with the statements it sent beyond a boot it is compared with when it took more
 * round trips than that one: a batch naming more tables reads differently without costing more.
 * @param measured - The statements of the boot measured.
 * @param baseline - The statements of the boot it is compared with.
 * @returns The round trips, and what grew.
 */
function resolveCost(measured: string[], baseline: string[]): { roundTrips: number, surplus?: string[] } {
    return measured.length > baseline.length
        ? { roundTrips: measured.length, surplus: findSurplus(measured, baseline) }
        : { roundTrips: measured.length };
}

/**
 * The statements one boot sent beyond another's, each as often as it was sent more often.
 * @param measured - The statements of the boot measured.
 * @param baseline - The statements of the boot it is compared with.
 * @returns The statements left over once every one the baseline sent is taken away.
 */
function findSurplus(measured: string[], baseline: string[]): string[] {
    const left: Map<string, number> = new Map();
    for (const statement of baseline) {
        left.set(statement, (left.get(statement) ?? 0) + 1);
    }
    return measured.filter(statement => {
        const remaining: number = left.get(statement) ?? 0;
        left.set(statement, remaining - 1);
        return remaining <= 0;
    });
}

describe.each<SchemaManagement>(['synchronize', 'migrations'])('what setting the postgres schema up costs a boot, managed by %s', schemaManagement => {
    const baseRoundTrips: RoundTripCounter = new RoundTripCounter();
    const grownRoundTrips: RoundTripCounter = new RoundTripCounter();
    const baseDataSource: Newable<PostgresDataSource> = createMeasuredDataSource(defaultTestServerEntities, baseRoundTrips, schemaManagement);
    const grownDataSource: Newable<PostgresDataSource> = createMeasuredDataSource(
        [...defaultTestServerEntities, ...PLAIN_ENTITIES],
        grownRoundTrips,
        schemaManagement
    );
    let base: BootStatements;
    let grown: BootStatements;

    beforeAll(async () => {
        base = await resolveBootStatements(baseDataSource, baseRoundTrips);
        grown = await resolveBootStatements(grownDataSource, grownRoundTrips);
    }, 2 * (TestTimeouts.postgres.start + TestTimeouts.postgres.restart + TestTimeouts.postgres.shutdown));

    // a difference comes with the statements the larger boot sent beyond the smaller one, so it names
    // what grows with the entities rather than only how much
    it('costs the same on a database holding nothing, however many entities it declares', () => {
        expect(resolveCost(grown.first, base.first)).toEqual({ roundTrips: base.first.length });
    });

    it('costs the same on a schema that already matches, however many entities it declares', () => {
        expect(resolveCost(grown.again, base.again)).toEqual({ roundTrips: base.again.length });
    });

    // an index built concurrently waits for every transaction of the database to end, which a table
    // this boot just created does not need. The migration table's search index was built that way, and
    // waited on the instances waiting for this one to finish setting the schema up
    it('builds nothing concurrently on a database holding nothing', () => {
        expect(base.first.filter(statement => statement.includes('CONCURRENTLY'))).toEqual([]);
    });
});