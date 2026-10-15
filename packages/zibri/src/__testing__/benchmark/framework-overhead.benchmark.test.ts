import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { DataSource as ToDataSource } from 'typeorm';
import { createInMemoryDataSource } from 'zibri-testing';

import { BenchmarkTiming } from './benchmark-timing.model';
import { BenchmarkUtilities } from './benchmark.utilities';
import { PostgresTypeOrmWhereFilterConverter } from '../../data-source/data-sources/where-converter/postgres-typeorm-where-filter.converter';
import { Where } from '../../data-source/models/where/where-filter.model';
import { Repository } from '../../data-source/repository/repository';
import { InjectRepository, repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { KnownHeader } from '../../http/known-header.enum';
import { Response } from '../../open-api/decorators/response.decorator';
import { Body } from '../../routing/decorators/body.decorator';
import { Controller } from '../../routing/decorators/controller.decorator';
import { Get } from '../../routing/decorators/get.decorator';
import { Param } from '../../routing/decorators/param.decorator';
import { Post } from '../../routing/decorators/post.decorator';
import { FsPath, FsUtilities } from '../../utilities/fs.utilities';
import { JsonUtilities } from '../../utilities/json.utilities';
import { testFileFolder } from '../constants';
import { defaultTestServerEntities } from '../test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../test-server/start-test-server.function';

/**
 * What the framework itself costs in time, around a request and around a repository call.
 *
 * On the in memory data source, so that what is timed is the framework rather than a database and a
 * network: validation, serialization, routing, the hooks. The numbers are written to a report and set
 * against a recorded baseline, and nothing here fails on them - see `BenchmarkUtilities`.
 *
 * `npm run test:benchmark` runs it. Setting `ZIBRI_BENCHMARK_UPDATE_BASELINE=1` makes the run the new
 * baseline, which is worth doing on the machine that compares against it.
 */

const RUNS: number = 500;

const LISTED_ROWS: number = 100;

const baselinePath: FsPath = FsUtilities.getPath(__dirname, 'baseline.json');

const reportPath: FsPath = FsUtilities.getPath(testFileFolder, 'benchmark-report.json');

@Entity({ tenant: 'shared' })
class BenchmarkItem extends BaseEntity {
    @Property.string()
    name!: string;

    @Property.number({ format: 'integer' })
    count!: number;
}

class BenchmarkItemCreateData {
    @Property.string()
    name!: string;

    @Property.number({ format: 'integer' })
    count!: number;
}

@Controller('/benchmark')
class BenchmarkController {
    constructor(
        @InjectRepository(BenchmarkItem)
        private readonly items: Repository<BenchmarkItem>
    ) {}

    @Response.object(BenchmarkItem)
    @Get('/items/:id')
    async findById(@Param.path('id') id: string): Promise<BenchmarkItem> {
        return await this.items.findById(id);
    }

    @Response.array(BenchmarkItem)
    @Get('/items')
    async findAll(): Promise<BenchmarkItem[]> {
        return await this.items.findAll({ take: LISTED_ROWS });
    }

    @Response.object(BenchmarkItem)
    @Post('/items')
    async create(@Body(BenchmarkItemCreateData) body: BenchmarkItemCreateData): Promise<BenchmarkItem> {
        return await this.items.create(body);
    }
}

let server: StartedTestServer | undefined;
let baseUrl: string;
let items: Repository<BenchmarkItem>;

beforeAll(async () => {
    server = await startTestServer({
        controllers: [BenchmarkController],
        dataSources: [createInMemoryDataSource({ entities: [...defaultTestServerEntities, BenchmarkItem] })]
    });
    baseUrl = await server.start();
    items = inject(repositoryTokenFor(BenchmarkItem));
}, 30000);

afterAll(async () => {
    await server?.shutdown();
}, 30000);

/**
 * Sends a request and reads its whole body, which is what a client waits for.
 * @param path - The path below the server's address.
 * @param init - The method and body, when there is one.
 */
async function request(path: string, init?: RequestInit): Promise<void> {
    const res: globalThis.Response = await fetch(`${baseUrl}${path}`, init);
    await res.text();
    expect(res.ok).toBe(true);
}

describe('what the framework costs in time', () => {
    it('measures a request and a repository call, and reports them against the baseline', async () => {
        const listed: BenchmarkItem[] = await items.createAll(
            Array.from({ length: LISTED_ROWS }, (_, i) => ({ name: `listed-${i}`, count: i }))
        );
        const read: BenchmarkItem | undefined = listed[0];
        expect(read).toBeDefined();
        const readId: string = read?.id ?? '';
        const body: string = JsonUtilities.stringify({ name: 'created', count: 1 });

        // one after the other, never alongside each other: each one is timed alone. Every read before
        // any write, because the in memory store reads by going through its rows - a read timed after
        // the writes would measure how many rows they had added
        const timings: BenchmarkTiming[] = [];
        timings.push(await BenchmarkUtilities.resolveTiming('GET one row', RUNS, async () => await request(`/benchmark/items/${readId}`)));
        timings.push(await BenchmarkUtilities.resolveTiming(`GET ${LISTED_ROWS} rows`, RUNS, async () => await request('/benchmark/items')));
        timings.push(await BenchmarkUtilities.resolveTiming('repository findById', RUNS, async () => await items.findById(readId)));
        timings.push(await BenchmarkUtilities.resolveTiming(
            `repository findAll of ${LISTED_ROWS} rows`,
            RUNS,
            async () => await items.findAll({ take: LISTED_ROWS })
        ));
        timings.push(await BenchmarkUtilities.resolveTiming('POST one row', RUNS, async () => await request('/benchmark/items', {
            method: 'POST',
            body,
            headers: { [KnownHeader.CONTENT_TYPE]: 'application/json' }
        })));
        timings.push(await BenchmarkUtilities.resolveTiming(
            'repository create',
            RUNS,
            async () => await items.create({ name: 'created', count: 1 })
        ));

        // what a postgres query spends turning its filter into find options, timed on its own because
        // the in memory store above never converts one. Converted on every query rather than kept,
        // since the result carries that query's values - this is what keeps the cost of that in view
        const converter: PostgresTypeOrmWhereFilterConverter = new PostgresTypeOrmWhereFilterConverter(
            new ToDataSource({ type: 'postgres' }),
            inject(ZIBRI_DI_TOKENS.LOGGER),
            { threshold: undefined, thresholdIsInclusive: false }
        );
        const filter: Where<BenchmarkItem> = { name: 'listed-1', count: { greaterThan: 0 }, id: { oneOf: [readId] } };
        timings.push(await BenchmarkUtilities.resolveTiming(
            'where filter conversion',
            RUNS,
            async () => await Promise.resolve(converter.convert(filter, BenchmarkItem))
        ));

        const report: string = await BenchmarkUtilities.resolveReport(
            timings,
            reportPath,
            baselinePath,
            process.env['ZIBRI_BENCHMARK_UPDATE_BASELINE'] === '1'
        );
        process.stdout.write(`\n${report}\n\n`);

        expect(timings.every(t => Number.isFinite(t.medianMs) && Number.isFinite(t.p95Ms))).toBe(true);
    }, 300000);
});