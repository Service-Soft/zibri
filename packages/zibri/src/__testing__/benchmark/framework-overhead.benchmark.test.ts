import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { type HashServiceInterface } from '../../auth/hash/hash-service.interface';
import { HashString } from '../../auth/hash/hash.utilities';
import { PostgresSchema } from '../../data-source/data-sources/postgres/postgres-schema.model';
import { PostgresWhereFilterConverter } from '../../data-source/data-sources/postgres/postgres-where-filter.converter';
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
import { LinearRegex } from '../../utilities/linear-regex';
import { RegexUtilities } from '../../utilities/regex.utilities';
import { testFileFolder, TestTimeouts } from '../constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../test-server/start-test-server.function';
import { BenchmarkTiming } from './benchmark-timing.model';
import { BenchmarkUtilities } from './benchmark.utilities';

/**
 * What the framework itself costs in time, around a request and around a repository call.
 *
 * On the in memory data source, so that what is timed is the framework rather than a database and a
 * network: validation, serialization, routing, the hooks. The numbers are written to a report and set
 * against a recorded baseline, and nothing here fails on them - see `BenchmarkUtilities`.
 *
 * `npm run test:benchmark` runs it. Setting `ZIBRI_BENCHMARK_UPDATE_BASELINE=1` makes the run the new
 * baseline of this machine; the file is not committed. `npm run test:benchmark:compare` sets it against
 * the release instead, which is what CI fails a slower operation on.
 */

const RUNS: number = 500;

const LISTED_ROWS: number = 100;

/**
 * Fewer than the other runs, since a password is slow to verify by design.
 */
const PASSWORD_RUNS: number = 20;

/**
 * A declared regex and a value it validates.
 */
type RegexCase = {
    /**
     * What the value is, for the name of its timing.
     */
    name: string,
    /**
     * The regex, as a property or a parameter declares it.
     */
    regex: RegExp,
    /**
     * The value it is tested against.
     */
    value: string,
    /**
     * How many tests one run times, so that a test far shorter than the timer's resolution still measures.
     */
    testsPerRun: number
};

/**
 * What a declared regex is used for, at the lengths a request sends and one far longer.
 */
const REGEX_CASES: RegexCase[] = [
    { name: 'a 23 character slug', regex: /^[\da-z]+(?:-[\da-z]+)*$/, value: 'my-blog-post-title-2026', testsPerRun: 100 },
    { name: 'a 20 character email address', regex: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, value: 'jane.doe@example.com', testsPerRun: 100 },
    { name: 'a 64 character hash, ignoring case', regex: /^[\da-f]{64}$/i, value: 'A3'.repeat(32), testsPerRun: 100 },
    { name: 'a 10 character name of unicode letters', regex: /^\p{L}+(?: \p{L}+)*$/u, value: 'Zoë Müller', testsPerRun: 100 },
    { name: 'a 10000 character slug', regex: /^[\da-z]+(?:-[\da-z]+)*$/, value: `${'a1-'.repeat(3333)}a`, testsPerRun: 1 },
    // what the largest json body a request may send by default takes at most: every character a different one, so
    // that no step it read before helps
    {
        // the two blocks of CJK ideographs that hold a letter at every code point, 82 KB as json
        name: 'a 27584 character name, each character a different one',
        regex: /^\p{L}+(?: \p{L}+)*$/u,
        value: [[0x34_00, 0x4D_BF], [0x4E_00, 0x9F_FF]]
            .flatMap(([from = 0, to = 0]) => Array.from({ length: to - from + 1 }, (_, i) => String.fromCodePoint(from + i)))
            .join(''),
        testsPerRun: 1
    }
];

/**
 * Fewer than the other runs, since each compiles a pattern and reads its first value.
 */
const COLD_REGEX_RUNS: number = 50;

const baselinePath: FsPath = FsUtilities.getPath(__dirname, 'framework-overhead.baseline.json');

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
        return await this.items.findAll({ limit: LISTED_ROWS });
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
        dataSources: [createInMemoryDataSource({ entities: [...defaultTestServerEntities, BenchmarkItem], repositories: defaultTestServerRepositories })]
    });
    baseUrl = await server.start();
    items = inject(repositoryTokenFor(BenchmarkItem));
}, TestTimeouts.inMemory.start);

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
            async () => await items.findAll({ limit: LISTED_ROWS })
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

        // what a postgres query spends turning its filter into sql, timed on its own because the in
        // memory store above never converts one. Converted on every query rather than kept, since the
        // result carries that query's values - this is what keeps the cost of that in view. What type a
        // column is stored as decides nothing about how long converting a filter on it takes
        const converter: PostgresWhereFilterConverter = new PostgresWhereFilterConverter(
            new PostgresSchema([BenchmarkItem], { resolveType: () => 'character varying', textCollation: 'en-US-x-icu', resolveDefault: () => undefined }),
            inject(ZIBRI_DI_TOKENS.LOGGER),
            { threshold: undefined, thresholdIsInclusive: false }
        );
        const filter: Where<BenchmarkItem> = { name: 'listed-1', count: { greaterThan: 0 }, id: { oneOf: [readId] } };
        timings.push(await BenchmarkUtilities.resolveTiming(
            'where filter conversion',
            RUNS,
            async () => await Promise.resolve(converter.convert(filter, BenchmarkItem, 'item'))
        ));

        // what validating a string against a declared regex costs, which runs in time linear to the value. Each value
        // as a request's body hands it over, parsed from json into one flat string rather than the parts it was
        // joined from
        for (const regexCase of REGEX_CASES) {
            regexCase.value = JsonUtilities.parse<string>(JsonUtilities.stringify(regexCase.value));
            const compiled: LinearRegex = RegexUtilities.resolveLinear(regexCase.regex);
            expect(compiled.test(regexCase.value)).toBe(true);
            timings.push(await BenchmarkUtilities.resolveTiming(
                `regex test of ${regexCase.name}, ${regexCase.testsPerRun} times`,
                RUNS,
                async () => {
                    for (let i: number = 0; i < regexCase.testsPerRun; i++) {
                        compiled.test(regexCase.value);
                    }
                    await Promise.resolve();
                }
            ));
        }

        // and what the first value read by a pattern takes, when every character of it is one of a block the pattern
        // has not read yet: compiled on every run, so that no run finds what one before it worked out
        const coldCase: RegexCase | undefined = REGEX_CASES.at(-1);
        expect(coldCase).toBeDefined();
        timings.push(await BenchmarkUtilities.resolveTiming(
            `regex compiled and tested once, ${coldCase?.name}`,
            COLD_REGEX_RUNS,
            async () => await Promise.resolve(new LinearRegex(coldCase?.regex.source ?? '', coldCase?.regex.flags ?? '').test(coldCase?.value ?? ''))
        ));

        // what a login in a test costs beyond the framework: verifying a password at the cost the test
        // providers hash with, an eighth of the shipped default. Timed so that a test doing several of
        // them is sized against a number rather than a guess
        const hashService: HashServiceInterface = inject(ZIBRI_DI_TOKENS.HASH_SERVICE);
        const hashed: HashString = await hashService.hash('benchmark password');
        timings.push(await BenchmarkUtilities.resolveTiming(
            'password verification',
            PASSWORD_RUNS,
            async () => expect(await hashService.equal('benchmark password', hashed)).toBe(true)
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