import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { PostgresDataSource } from './postgres-data-source.model';
import { TestTimeouts } from '../../../__testing__/constants';
import { createTestDataSource, defaultTestServerEntities, defaultTestServerRepositories } from '../../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../../__testing__/test-server/start-test-server.function';
import { inject } from '../../../di/inject.function';
import { BaseEntity } from '../../../entity/base-entity.model';
import { Entity } from '../../../entity/decorators/entity.decorator';
import { Property } from '../../../entity/decorators/property.decorator';
import { Newable } from '../../../types/newable.type';
import { Where } from '../../models/where/where-filter.model';
import { Repository } from '../../repository/repository';
import { Transaction } from '../../transaction/transaction.model';
import { IsolationLevel } from '../data-source.interface';

// a stream in a transaction reads through a cursor declared in it, whose query takes no parameters: each
// value of the filter goes into it as a literal the server quoted. What it reads is held against what the
// same filter reads as a parameter, for every kind of value a filter binds

@Entity({ tenant: 'shared', allowOrphan: true })
class StreamedRow extends BaseEntity {
    @Property.string()
    text!: string;

    @Property.number({ format: 'integer' })
    count!: number;

    @Property.number()
    ratio!: number;

    @Property.boolean()
    done!: boolean;

    @Property.date()
    at!: Date;

    @Property.string({ required: false })
    note?: string | null;
}

const dataSourceClass: Newable<PostgresDataSource> = createTestDataSource({
    entities: [...defaultTestServerEntities, StreamedRow],
    repositories: defaultTestServerRepositories
});

/**
 * Text that a literal written by hand gets wrong: quotes, backslashes, what looks like a placeholder or a
 * cast, and characters outside ASCII.
 */
const AWKWARD_TEXTS: string[] = [
    'it\'s',
    'back\\slash',
    '\\x41',
    '$1 :name ::text',
    'ünïcödé 😀',
    'line\nbreak',
    '\'; DROP TABLE streamed_row; --'
];

let server: StartedTestServer | undefined;
let rows: Repository<StreamedRow>;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [dataSourceClass] });
    rows = inject(dataSourceClass).getRepository(StreamedRow);
    await rows.createAll(AWKWARD_TEXTS.map((text, i) => ({
        text,
        count: i - 3,
        ratio: (i * 0.1) + 0.05,
        done: i % 2 === 0,
        at: new Date(Date.UTC(2026, 0, 1, 12, 0, 0, i)),
        note: i % 3 === 0 ? null : `note ${i}`
    })));
}, TestTimeouts.postgres.start);

afterAll(async () => {
    await server?.shutdown();
}, TestTimeouts.postgres.shutdown);

/**
 * The ids a stream in a transaction reads.
 * @param where - The filter.
 * @returns The ids, sorted.
 */
async function streamInTransaction(where: Where<StreamedRow>): Promise<string[]> {
    const transaction: Transaction = await inject(dataSourceClass).startTransaction({ isolationLevel: IsolationLevel.REPEATABLE_READ });
    const ids: string[] = [];
    try {
        for await (const row of rows.stream({ where, transaction })) {
            ids.push(row.id);
        }
    }
    finally {
        await transaction.rollback();
    }
    return ids.sort();
}

/**
 * The ids the filter reads as a parameter.
 * @param where - The filter.
 * @returns The ids, sorted.
 */
async function findAll(where: Where<StreamedRow>): Promise<string[]> {
    return (await rows.findAll({ where })).map(r => r.id).sort();
}

describe('a postgres stream in a transaction', () => {
    it.each(AWKWARD_TEXTS)('reads the row of the text %j as a parameter finds it', async text => {
        const expected: string[] = await findAll({ text });

        expect(expected).toHaveLength(1);
        expect(await streamInTransaction({ text })).toEqual(expected);
    }, 30000);

    it('reads what a filter of every other kind of value finds as a parameter', async () => {
        const filters: Where<StreamedRow>[] = [
            { count: -2 },
            { count: { greaterThan: 0 } },
            { ratio: { lesserThan: 0.36 } },
            { done: true },
            { at: new Date(Date.UTC(2026, 0, 1, 12, 0, 0, 3)) },
            { at: { after: new Date(Date.UTC(2026, 0, 1, 12, 0, 0, 4)) } },
            { note: null },
            { text: { oneOf: AWKWARD_TEXTS.slice(0, 3) } },
            // a backslash anywhere: one escaped by another, as a pattern takes a backslash literally
            { text: { like: '%\\\\%' } }
        ];
        for (const where of filters) {
            const expected: string[] = await findAll(where);

            // not vacuous: each filter finds something, and not everything
            expect([where, expected.length > 0 && expected.length < AWKWARD_TEXTS.length]).toEqual([where, true]);
            expect([where, await streamInTransaction(where)]).toEqual([where, expected]);
        }
    }, 30000);

    // the stream held the transaction's one connection until it was read to its end, and the read of each
    // batch of rows the ids named queued behind it: a stream of more than a batch waited forever
    it('reads more than a batch, and lets the transaction run statements while it reads', async () => {
        const transaction: Transaction = await inject(dataSourceClass).startTransaction({ isolationLevel: IsolationLevel.REPEATABLE_READ });
        const many: StreamedRow[] = await rows.createAll(
            Array.from({ length: 1200 }, (_, i) => ({ text: `many ${i}`, count: 1000, ratio: 0, done: false, at: new Date() })),
            { transaction }
        );
        let read: number = 0;
        try {
            for await (const row of rows.stream({ where: { count: 1000 }, transaction })) {
                read++;
                if (read % 400 === 0) {
                    await rows.updateById(row.id, { done: true }, { transaction });
                }
            }
        }
        finally {
            await transaction.rollback();
        }

        // its own rows, which nothing outside the transaction sees
        expect(read).toBe(many.length);
    }, 60000);
});