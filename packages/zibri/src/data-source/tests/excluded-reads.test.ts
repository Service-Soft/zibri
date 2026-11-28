import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource, InMemoryDataSource } from 'zibri-testing';

import { TestTimeouts } from '../../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { type HttpRequestContext } from '../../context/request/http-request.context';
import { RequestContextToken } from '../../context/request/request-context-token.model';
import { type WebsocketRequestContext } from '../../context/request/websocket-request.context';
import { InjectRepository } from '../../di/decorators/inject-repository.decorator';
import { inject } from '../../di/inject.function';
import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { KnownHeader } from '../../http/known-header.enum';
import { Controller } from '../../routing/decorators/controller.decorator';
import { Get } from '../../routing/decorators/get.decorator';
import { Param } from '../../routing/decorators/param.decorator';
import { Newable } from '../../types/newable.type';
import { Repository } from '../repository/repository';

// the in memory data source decodes a stored row once and hands every later read of it what it
// decoded. What a caller may see is decided per read, on the entity that read hands out, so the reads
// of one row by callers who may see different things are what could leak into each other

const IS_ADMIN: RequestContextToken<boolean> = new RequestContextToken(
    'excluded-reads-is-admin',
    ctx => ctx.request.headers?.[KnownHeader.AUTHORIZATION] === 'admin'
);

async function isHiddenFrom(ctx: HttpRequestContext | WebsocketRequestContext | undefined): Promise<boolean> {
    return ctx != undefined && !await ctx.get(IS_ADMIN);
}

/**
 * The account an entry is booked to, an object stored in a column of its own.
 */
class EntryAccount {
    @Property.string()
    number!: string;

    @Property.string({ exclude: async (_, ctx) => await isHiddenFrom(ctx) })
    iban!: string;
}

@Entity({ tenant: 'shared', allowOrphan: true })
class SalaryEntry extends BaseEntity {
    @Property.string()
    employee!: string;

    @Property.string({ exclude: async (_, ctx) => await isHiddenFrom(ctx) })
    salary!: string;

    @Property.object({ cls: () => EntryAccount })
    account!: EntryAccount;
}

@Controller('/salary-entries')
class SalaryEntryController {
    constructor(
        @InjectRepository(SalaryEntry)
        private readonly entries: Repository<SalaryEntry>
    ) {}

    @Get('/:id')
    async findById(@Param.path('id', { type: 'string' }) id: string): Promise<SalaryEntry> {
        return await this.entries.findById(id);
    }
}

const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({
    entities: [...defaultTestServerEntities, SalaryEntry],
    repositories: defaultTestServerRepositories
});

let server: StartedTestServer | undefined;
let baseUrl: string;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [dataSourceClass], controllers: [SalaryEntryController] });
    baseUrl = await server.start();
}, TestTimeouts.inMemory.start);

afterAll(async () => {
    await server?.shutdown();
}, TestTimeouts.inMemory.shutdown);

describe('a row read by callers who may see different properties of it', () => {
    it('shows each caller what it may see, whoever read the row before', async () => {
        const { id } = await inject(dataSourceClass).getRepository(SalaryEntry)
            .create({
                employee: 'Kim',
                salary: '5000.00',
                account: { number: '1200', iban: 'DE02120300000000202051' }
            });
        const read: (authorization: string) => Promise<Record<string, unknown>> = async authorization => {
            const response: Response = await fetch(`${baseUrl}/salary-entries/${id}`, { headers: { Authorization: authorization } });
            expect(response.status).toBe(200);
            return await response.json() as Record<string, unknown>;
        };
        const hidden: Record<string, unknown> = { id, employee: 'Kim', account: { number: '1200' } };
        const shown: Record<string, unknown> = { id, employee: 'Kim', salary: '5000.00', account: { number: '1200', iban: 'DE02120300000000202051' } };

        expect(await read('user')).toEqual(hidden);
        expect(await read('admin')).toEqual(shown);
        expect(await read('user')).toEqual(hidden);
        expect(await read('admin')).toEqual(shown);
    });
});