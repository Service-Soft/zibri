import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { RoundTripCounter } from 'zibri-testing';

import { CostGroup, CostItem, describeRepositoryCosts } from './repository-costs.cases';
import { TestTimeouts } from '../../__testing__/constants';
import { createTestDataSource, defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { createTestValKeyDataSource } from '../../__testing__/test-server/create-test-val-key-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { inject } from '../../di/inject.function';
import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { Newable } from '../../types/newable.type';
import { FsUtilities } from '../../utilities/fs.utilities';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { PostgresDataSource } from '../data-sources/postgres/postgres-data-source.model';
import { ValKeyDataSource } from '../data-sources/val-key/val-key-data-source.model';
import { DataSource } from '../decorators/data-source.decorator';
import { MigrationEntity } from '../migration/migration-entity.model';
import { Repository } from '../repository/repository';

/**
 * A row there are more of than a read on ValKey reads along with their ids, kept apart from the
 * entities the page's table is measured on so that those stay below that.
 */
@Entity({ tenant: 'shared' })
class CostCrowd extends BaseEntity {
    @Property.string()
    batch!: string;
}

/**
 * A row written a thousand at a time. Found through an index, so that a filter reads the rows it
 * names rather than every row there is.
 */
@Entity({ tenant: 'shared', indexes: [['batch']] })
class CostBulk extends BaseEntity {
    @Property.string({ unique: true })
    name!: string;

    @Property.number({ format: 'integer' })
    count!: number;

    @Property.string()
    batch!: string;
}

/**
 * The rows a bulk call is measured against.
 */
type BulkMeasured = {
    bulk: Repository<CostBulk>,
    rows: CostBulk[],
    batch: string
};

/**
 * The numbers of rows the page lists the round trips of a ValKey write for, one column each.
 */
const BULK_ROW_COUNTS: number[] = [1, 1000, 2000];

/**
 * The writes whose round trips the page lists by the number of rows they write.
 */
const BULK_CALLS: Record<string, (m: BulkMeasured) => Promise<unknown>> = {
    '`createAll`': async m => await m.bulk.createAll(m.rows.map(() => ({ name: UUIDUtilities.generate(), count: 0, batch: UUIDUtilities.generate() }))),
    '`updateAll`': async m => await m.bulk.updateAll({ batch: m.batch }, { count: 1 }),
    '`upsertAll`': async m => await m.bulk.upsertAll(
        ['name'],
        m.rows.map(r => ({ create: { name: r.name, count: 0, batch: m.batch }, onConflict: { count: { increment: 1 } } }))
    ),
    '`deleteAll`': async m => await m.bulk.deleteAll({ batch: m.batch })
};

const postgresRoundTrips: RoundTripCounter = new RoundTripCounter();
const valKeyRoundTrips: RoundTripCounter = new RoundTripCounter();

// the framework's own entities live in a data source of their own, so that no service of the
// application - a cron poll, a lease being renewed - sends anything through the counted ones
const frameworkDataSourceClass: Newable<PostgresDataSource> = createTestDataSource({ entities: defaultTestServerEntities, repositories: defaultTestServerRepositories });

/**
 * The postgres data source being measured. Named, since the framework's is built by the same helper.
 */
@DataSource()
class CountedPostgresDataSource extends createTestDataSource({
        entities: [MigrationEntity, CostGroup, CostItem],
        roundTrips: postgresRoundTrips,
        allowOrphan: true
    }) {}

const postgresDataSourceClass: Newable<PostgresDataSource> = CountedPostgresDataSource;

const valKeyDataSourceClass: Newable<ValKeyDataSource> = createTestValKeyDataSource({
    entities: [MigrationEntity, CostGroup, CostItem, CostCrowd, CostBulk],
    roundTrips: valKeyRoundTrips
});

let server: StartedTestServer | undefined;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [frameworkDataSourceClass, postgresDataSourceClass, valKeyDataSourceClass] });
}, TestTimeouts.resolveCombined('postgres', 'valKey').start);

afterAll(async () => {
    await server?.shutdown();
}, TestTimeouts.resolveCombined('postgres', 'valKey').shutdown);

describeRepositoryCosts('Postgres', () => ({
    items: inject(postgresDataSourceClass).getRepository(CostItem),
    groups: inject(postgresDataSourceClass).getRepository(CostGroup),
    roundTrips: postgresRoundTrips
}));

describeRepositoryCosts('ValKey', () => ({
    items: inject(valKeyDataSourceClass).getRepository(CostItem),
    groups: inject(valKeyDataSourceClass).getRepository(CostGroup),
    roundTrips: valKeyRoundTrips
}));

/**
 * Measures every bulk call against the given number of rows, each on rows of its own.
 * @param rowCount - How many rows each call is given.
 * @returns The round trips each call took, by its name.
 */
async function resolveBulkCosts(rowCount: number): Promise<Record<string, number>> {
    const bulk: Repository<CostBulk> = inject(valKeyDataSourceClass).getRepository(CostBulk);
    const res: Record<string, number> = {};
    // one after the other, since the counter counts whatever the data source does meanwhile
    for (const [call, work] of Object.entries(BULK_CALLS)) {
        const batch: string = UUIDUtilities.generate();
        const rows: CostBulk[] = await bulk.createAll(Array.from({ length: rowCount }, () => ({ name: UUIDUtilities.generate(), count: 0, batch })));
        res[call] = await valKeyRoundTrips.resolveCountOf(async () => await work({ bulk, rows, batch }));
    }
    return res;
}

describe('what a call on many rows costs, on ValKey', () => {
    it('reads rows a thousand at a time, the first along with their ids', async () => {
        const crowd: Repository<CostCrowd> = inject(valKeyDataSourceClass).getRepository(CostCrowd);
        const batch: string = UUIDUtilities.generate();
        const readingAll: () => Promise<number> = async () => await valKeyRoundTrips.resolveCountOf(
            async () => await crowd.findAll({ where: { batch } })
        );

        await crowd.createAll(Array.from({ length: 1000 }, () => ({ batch })));
        const thousand: number = await readingAll();
        await crowd.create({ batch });
        const thousandAndOne: number = await readingAll();
        await crowd.createAll(Array.from({ length: 1000 }, () => ({ batch })));
        const twoThousandAndOne: number = await readingAll();

        expect({ thousand, thousandAndOne, twoThousandAndOne }).toEqual({ thousand: 1, thousandAndOne: 2, twoThousandAndOne: 3 });
    }, 60000);

    it('writes as many rows in as many round trips as docs/costs.md says', async () => {
        const counts: Record<string, number>[] = [];
        for (const rowCount of BULK_ROW_COUNTS) {
            counts.push(await resolveBulkCosts(rowCount));
        }
        const measured: string[] = Object.keys(BULK_CALLS).map(call => `| ${call} | ${counts.map(c => c[call] ?? '—').join(' | ')} |`);

        // compared as the page's own rows, so a difference shows the row to write instead
        expect(measured).toEqual(await resolveWriteRows());
    }, 120000);
});

/**
 * Reads the page's table of what ValKey writes cost by the number of rows they write.
 * @returns Its rows, past the heading, as they are written.
 */
async function resolveWriteRows(): Promise<string[]> {
    const page: string = await FsUtilities.readFile(FsUtilities.getPath(__dirname, '..', '..', '..', 'docs', 'costs.md'));
    const lines: string[] = page.split('\n');
    const headingAt: number = lines.findIndex(l => l.startsWith('| Write |'));
    if (headingAt === -1) {
        throw new Error('docs/costs.md has no table of writes by the number of rows.');
    }
    const rows: string[] = [];
    // past the heading and the line under it, up to the first line that is no longer the table
    for (const line of lines.slice(headingAt + 2)) {
        if (!line.startsWith('|')) {
            break;
        }
        rows.push(line);
    }
    return rows;
}