/* eslint-disable jsdoc-js/require-jsdoc */
import { beforeAll, describe, expect, it } from 'vitest';
import { RoundTripCounter } from 'zibri-testing';

import { BaseEntity } from '../../entity/base-entity.model.ts';
import { Entity } from '../../entity/decorators/entity.decorator.ts';
import { Property } from '../../entity/decorators/property.decorator.ts';
import { type Relation } from '../../entity/models/relation.type.ts';
import { FsUtilities } from '../../utilities/fs.utilities.ts';
import { UUIDUtilities } from '../../utilities/uuid.utilities.ts';
import { Repository } from '../repository/repository.ts';

/**
 * What each repository call costs in round trips, measured on every data source and compared with
 * the table in `docs/costs.md` - so the page cannot say something the code stopped doing. A file per
 * data source runs them against repositories of its own, on a data source that holds nothing else.
 */

@Entity({ tenant: 'shared', allowOrphan: true, allowDuplicate: true })
export class CostGroup extends BaseEntity {
    @Property.string()
    label!: string;

    @Property.oneToMany({ target: () => CostItem, inverseSide: 'group' })
    items!: CostItem[];
}

@Entity({ tenant: 'shared', allowOrphan: true, allowDuplicate: true })
export class CostItem extends BaseEntity {
    /**
     * The identity an upsert resolves by. The page measures an entity declaring one unique property,
     * which is what most entities do.
     */
    @Property.string({ unique: true })
    name!: string;

    @Property.number({ format: 'integer' })
    count!: number;

    /**
     * Which measurement a row belongs to, so that each call's filter matches exactly the rows it was
     * given.
     */
    @Property.string()
    batch!: string;

    @Property.manyToOne({ target: () => CostGroup, joinColumn: 'groupId', inverseSide: 'items' })
    group!: Relation<CostGroup>;

    @Property.string({ format: 'uuid', required: false })
    groupId?: string;
}

/**
 * The repositories and the counter of one data source.
 */
type CostedDataSource = {
    items: Repository<CostItem>,
    groups: Repository<CostGroup>,
    roundTrips: RoundTripCounter
};

/**
 * The rows a call is measured against, and everything it needs to name them.
 */
type Measured = {
    items: Repository<CostItem>,
    groups: Repository<CostGroup>,
    rows: CostItem[],
    batch: string,
    groupId: string
};

/**
 * Many enough rows that something done once per row cannot hide, few enough to stay under every
 * batch size a store reads or writes in.
 */
const MANY_ROWS: number = 20;

/**
 * Every repository call, as the first column of the page's table names it.
 */
const CALLS: Record<string, (m: Measured) => Promise<unknown>> = {
    '`findById`': async m => await m.items.findById(first(m).id),
    '`findOne`': async m => await m.items.findOne({ where: { batch: m.batch } }),
    '`findAll`': async m => await m.items.findAll({ where: { batch: m.batch } }),
    '`findAll` with relations': async m => await m.items.findAll({ where: { batch: m.batch }, relations: ['group'] }),
    '`findAllPaginated`': async m => await m.items.findAllPaginated(1, MANY_ROWS, { where: { batch: m.batch } }),
    '`findAllAfter`': async m => await m.items.findAllAfter(undefined, MANY_ROWS, { where: { batch: m.batch } }),
    '`stream`': async m => {
        for await (const item of m.items.stream({ where: { batch: m.batch } })) {
            expect(item.batch).toBe(m.batch);
        }
    },
    '`count`': async m => await m.items.count({ where: { batch: m.batch } }),
    '`exists`': async m => await m.items.exists({ where: { batch: m.batch } }),
    '`create`': async m => await m.items.create(freshRow(m)),
    '`create` with relations': async m => await m.items.create(freshRow(m), { relations: ['group'] }),
    '`createAll`': async m => await m.items.createAll(m.rows.map(() => freshRow(m))),
    '`createAll` with relations': async m => await m.items.createAll(m.rows.map(() => freshRow(m)), { relations: ['group'] }),
    // a store may write differently when there is no unique value to enforce, so that case is
    // measured on its own
    '`createAll` on an entity declaring nothing unique': async m => await m.groups.createAll(m.rows.map(() => ({ label: m.batch }))),
    '`updateById`': async m => await m.items.updateById(first(m).id, { count: 1 }),
    '`updateById` with a condition': async m => await m.items.updateById(first(m).id, { count: 1 }, { where: { count: 0 } }),
    '`updateById` with relations': async m => await m.items.updateById(first(m).id, { count: 1 }, { relations: ['group'] }),
    '`updateAll`': async m => await m.items.updateAll({ batch: m.batch }, { count: 1 }),
    '`updateAll` returning the rows': async m => await m.items.updateAll({ batch: m.batch }, { count: 1 }, { returnUpdated: true }),
    '`upsert`': async m => await m.items.upsert(
        { name: first(m).name },
        { name: first(m).name, count: 0, batch: m.batch },
        { count: { increment: 1 } }
    ),
    '`upsertAll`': async m => await m.items.upsertAll(
        ['name'],
        m.rows.map(r => ({ create: { name: r.name, count: 0, batch: m.batch }, onConflict: { count: { increment: 1 } } }))
    ),
    '`deleteById`': async m => await m.items.deleteById(first(m).id),
    '`deleteAll`': async m => await m.items.deleteAll({ batch: m.batch }),
    '`deleteAll` returning the rows': async m => await m.items.deleteAll({ batch: m.batch }, { returnDeleted: true })
};

function first(m: Measured): CostItem {
    const row: CostItem | undefined = m.rows[0];
    if (row == undefined) {
        throw new Error('A call is measured against at least one row.');
    }
    return row;
}

function freshRow(m: Measured): Pick<CostItem, 'name' | 'count' | 'batch' | 'groupId'> {
    return { name: `cost-${UUIDUtilities.generate()}`, count: 0, batch: m.batch, groupId: m.groupId };
}

/**
 * Reads one data source's column of the page's table.
 * @param column - The column's heading.
 * @returns Each call's row as it would be written with only that column, in the page's order.
 */
async function resolvePageRows(column: string): Promise<string[]> {
    const page: string = await FsUtilities.readFile(FsUtilities.getPath(import.meta.dirname, '..', '..', '..', 'docs', 'costs.md'));
    const lines: string[] = page.split('\n');
    const headingAt: number = lines.findIndex(l => l.startsWith('| Call |'));
    const headings: string[] = cellsOf(lines[headingAt] ?? '');
    const index: number = headings.indexOf(column);
    if (headingAt === -1 || index === -1) {
        throw new Error(`docs/costs.md has no table with a "${column}" column.`);
    }

    const rows: string[] = [];
    // past the heading and the line under it, up to the first line that is no longer the table
    for (const line of lines.slice(headingAt + 2)) {
        if (!line.startsWith('|')) {
            break;
        }
        const cells: string[] = cellsOf(line);
        rows.push(rowOf(cells[0] ?? '', cells[index] ?? ''));
    }
    return rows;
}

function cellsOf(line: string): string[] {
    return line.split('|')
        .slice(1, -1)
        .map(c => c.trim());
}

function rowOf(call: string, roundTrips: string | number): string {
    return `| ${call} | ${roundTrips} |`;
}

/**
 * Runs every case against the cost entities of one data source.
 * @param column - The data source's column in the page's table, which also names the cases.
 * @param dataSourceOf - Reads the repositories and the counter, once the data source is started.
 */
export function describeRepositoryCosts(column: string, dataSourceOf: () => CostedDataSource): void {

    /**
     * Measures every call against the given number of rows, each on rows of its own.
     * @param rowCount - How many rows each call is given.
     * @returns The round trips each call took, by its name.
     */
    async function resolveMeasuredCosts(rowCount: number): Promise<Map<string, number>> {
        const { items, groups, roundTrips }: CostedDataSource = dataSourceOf();
        const group: CostGroup = await groups.create({ label: 'measured' });
        const res: Map<string, number> = new Map();
        // one after the other, since the counter counts whatever the data source does meanwhile
        for (const [call, work] of Object.entries(CALLS)) {
            const batch: string = UUIDUtilities.generate();
            const rows: CostItem[] = await items.createAll(Array.from({ length: rowCount }, () => ({
                name: `cost-${UUIDUtilities.generate()}`,
                count: 0,
                batch,
                groupId: group.id
            })));
            res.set(call, await roundTrips.resolveCountOf(async () => await work({ items, groups, rows, batch, groupId: group.id })));
        }
        return res;
    }

    describe(`what each repository call costs, on ${column}`, () => {
        let forOneRow: Map<string, number>;
        let forManyRows: Map<string, number>;

        beforeAll(async () => {
            forOneRow = await resolveMeasuredCosts(1);
            forManyRows = await resolveMeasuredCosts(MANY_ROWS);
        }, 120000);

        it('costs what docs/costs.md says', async () => {
            const measured: string[] = Object.keys(CALLS).map(call => rowOf(call, forOneRow.get(call) ?? '—'));

            // compared as the page's own rows, so a difference shows the row to write instead
            expect(measured).toEqual(await resolvePageRows(column));
        });

        it('costs the same for many rows as for one', () => {
            const grown: string[] = Object.keys(CALLS)
                .filter(call => forOneRow.get(call) !== forManyRows.get(call))
                .map(call => `${call}: ${forOneRow.get(call)} for one row, ${forManyRows.get(call)} for ${MANY_ROWS}`);

            expect(grown).toEqual([]);
        });
    });
}