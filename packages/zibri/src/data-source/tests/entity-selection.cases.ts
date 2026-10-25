/* eslint-disable jsdoc/require-jsdoc */
/* eslint-disable sonar/no-duplicate-string */
import { afterEach, describe, expect, it, jest } from '@jest/globals';

import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { KeysetPage, PaginationResult } from '../../open-api/pagination-result.model';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { Repository } from '../repository/repository';

/**
 * The cases every data source answers the same way about narrowing what a read hands back: a
 * selection names the properties of each row, reaches into what an object, an array or an included
 * relation holds, keeps every entity's id, and is refused when it names what the read cannot hand
 * back. A file per data source runs them against repositories of its own.
 */

export class Address {
    @Property.string()
    street!: string;

    @Property.string()
    city!: string;
}

export class Label {
    @Property.string()
    text!: string;

    @Property.string()
    color!: string;
}

@Entity({ tenant: 'shared', allowOrphan: true, allowDuplicate: true })
export class Shopper extends BaseEntity {
    /**
     * Groups the shoppers of one case, so the cases do not read each other's rows.
     */
    @Property.string({ format: 'uuid' })
    batch!: string;

    @Property.string()
    name!: string;

    @Property.string()
    email!: string;

    @Property.string()
    tier!: string;

    /**
     * Hidden from everybody but the shoppers of the top tier - which the row decides.
     */
    @Property.string({ exclude: (row: Shopper) => row.tier !== 'top', required: false })
    perks?: string | null;

    @Property.string({ encryption: true, required: false })
    secret?: string | null;

    @Property.object({ cls: () => Address })
    address!: Address;

    @Property.array({ items: { type: 'object', cls: () => Label } })
    labels!: Label[];

    @Property.oneToMany({ target: () => Purchase, inverseSide: 'shopper', required: false })
    purchases?: Purchase[];
}

@Entity({ tenant: 'shared', allowOrphan: true, allowDuplicate: true, defaultRelations: { shopper: true } })
export class Purchase extends BaseEntity {
    @Property.number({ format: 'integer' })
    total!: number;

    @Property.string()
    note!: string;

    @Property.string({ format: 'uuid', required: false })
    shopperId?: string;

    @Property.manyToOne({ target: () => Shopper, joinColumn: 'shopperId', inverseSide: 'purchases', required: false })
    shopper?: Shopper;
}

export const entitySelectionEntities: (typeof Shopper | typeof Purchase)[] = [Shopper, Purchase];

/**
 * A shopper narrowed to their name.
 */
type NamedShopper = { id: string, name: string };

/**
 * A shopper narrowed to the city they live in and the texts of their labels.
 */
type LocatedShopper = { id: string, address: { city: string }, labels: { text: string }[] };

/**
 * A shopper narrowed to their name and the totals of their purchases.
 */
type ShopperWithTotals = { id: string, name: string, purchases?: { id: string, total: number }[] };

/**
 * A purchase narrowed to its total and the name of who made it.
 */
type PurchaseWithShopperName = { id: string, total: number, shopper?: { id: string, name: string } };

/**
 * The repositories of one data source.
 */
export type EntitySelectionRepositories = {
    shoppers: Repository<Shopper>,
    purchases: Repository<Purchase>
};

/**
 * Runs every case against the repositories of one data source.
 * @param dataSourceName - The data source, for the name of the cases.
 * @param reposOf - Reads the repositories, once the data source is started.
 */
export function describeEntitySelection(dataSourceName: string, reposOf: () => EntitySelectionRepositories): void {

    async function storeShoppers(): Promise<string> {
        const batch: string = UUIDUtilities.generate();
        const [ada, grace] = await reposOf().shoppers.createAll([
            {
                batch,
                name: 'Ada',
                email: 'ada@example.com',
                tier: 'top',
                perks: 'lounge',
                secret: 'ada-secret',
                address: { street: 'Main 1', city: 'London' },
                labels: [{ text: 'early', color: 'green' }, { text: 'loyal', color: 'gold' }]
            },
            {
                batch,
                name: 'Grace',
                email: 'grace@example.com',
                tier: 'basic',
                perks: 'none',
                secret: 'grace-secret',
                address: { street: 'Side 2', city: 'Paris' },
                labels: []
            }
        ]);
        await reposOf().purchases.createAll([
            { total: 10, note: 'first', shopperId: ada?.id },
            { total: 20, note: 'second', shopperId: ada?.id },
            { total: 5, note: 'only', shopperId: grace?.id }
        ]);
        return batch;
    }

    describe(`narrowing what a read hands back, on ${dataSourceName}`, () => {
        afterEach(() => {
            jest.restoreAllMocks();
        });

        it('hands back the properties a list names, and the id', async () => {
            const batch: string = await storeShoppers();

            const found: NamedShopper[] = await reposOf().shoppers.findAll({ where: { batch }, select: ['name'], order: { name: 'ASC' } });

            expect(found.map(s => ({ ...s }))).toEqual([
                { id: expect.any(String), name: 'Ada' },
                { id: expect.any(String), name: 'Grace' }
            ]);
            // @ts-expect-error - a property the selection does not name is not on the type either
            expect(found[0]?.email).toBeUndefined();
        });

        it('reaches into what an object and an array of objects hold', async () => {
            const batch: string = await storeShoppers();

            const found: LocatedShopper = await reposOf().shoppers.findOne({
                where: { batch, name: 'Ada' },
                select: { address: { city: true }, labels: { text: true } }
            });

            expect({ ...found, address: { ...found.address }, labels: found.labels.map(l => ({ ...l })) }).toEqual({
                id: expect.any(String),
                address: { city: 'London' },
                labels: [{ text: 'early' }, { text: 'loyal' }]
            });
            // @ts-expect-error - the street is not selected
            expect(found.address.street).toBeUndefined();
        });

        it('narrows the rows of an included relation, keeping their ids', async () => {
            const batch: string = await storeShoppers();

            const found: ShopperWithTotals[] = await reposOf().shoppers.findAll({
                where: { batch },
                relations: ['purchases'],
                select: { name: true, purchases: { total: true } },
                order: { name: 'ASC' }
            });

            expect(found.map(s => [s.name, (s.purchases ?? []).map(p => ({ ...p })).sort((a, b) => a.total - b.total)])).toEqual([
                ['Ada', [{ id: expect.any(String), total: 10 }, { id: expect.any(String), total: 20 }]],
                ['Grace', [{ id: expect.any(String), total: 5 }]]
            ]);
        });

        it('counts a default relation as included', async () => {
            const batch: string = await storeShoppers();

            const found: PurchaseWithShopperName[] = await reposOf().purchases.findAll({
                where: { shopper: { where: { batch } } },
                select: { total: true, shopper: { name: true } },
                order: { total: 'ASC' }
            });

            expect(found.map(p => [p.total, p.shopper?.name])).toEqual([[5, 'Grace'], [10, 'Ada'], [20, 'Ada']]);
        });

        it('leaves out an included relation the selection does not name', async () => {
            const batch: string = await storeShoppers();

            const found: NamedShopper[] = await reposOf().shoppers.findAll({
                where: { batch },
                relations: ['purchases'],
                select: ['name']
            });

            expect(found.every(s => !('purchases' in s))).toBe(true);
        });

        it('refuses a selection reaching into a relation the read does not include, and names it', async () => {
            const batch: string = await storeShoppers();

            await expect(reposOf().shoppers.findAll({
                where: { batch },
                select: { name: true, purchases: { total: true } }
            })).rejects.toThrow(
                'Shopper: the selection names "purchases", but the relation "purchases" of Shopper'
                + ' is not included in the read\'s relations.'
            );
        });

        it('refuses a selection reaching into a value with no properties of its own', async () => {
            const batch: string = await storeShoppers();

            await expect(reposOf().shoppers.findAll({
                where: { batch },
                // @ts-expect-error - a string holds no properties to select
                select: { name: { length: true } }
            })).rejects.toThrow('Shopper: the selection reaches into "name", which holds a string rather than properties of its own.');
        });

        it('decrypts a selected property bound to its row', async () => {
            const batch: string = await storeShoppers();

            const found: { id: string, secret?: string | null }[] = await reposOf().shoppers.findAll({
                where: { batch },
                select: ['secret'],
                order: { name: 'ASC' }
            });

            expect(found.map(s => s.secret)).toEqual(['ada-secret', 'grace-secret']);
        });

        it('reads the whole row for a property whose exclude decides on another, says so, and hands back the selection', async () => {
            const batch: string = await storeShoppers();
            const warn: jest.Spied<(message: string) => void> = jest.spyOn(inject(ZIBRI_DI_TOKENS.LOGGER), 'warn');

            const found: { id: string, perks?: string | null }[] = await reposOf().shoppers.findAll({
                where: { batch },
                select: ['perks'],
                order: { name: 'ASC' }
            });

            // the top tier sees its perks, the other is hidden - which only the tier, not selected, says
            expect(found.map(s => s.perks)).toEqual(['lounge', 'none']);
            expect(found.map(s => Object.keys(s))).toEqual([['id', 'perks'], ['id']]);
            expect(warn).toHaveBeenCalledWith(expect.stringContaining('Shopper.perks'));
            expect(found.every(s => !('tier' in s))).toBe(true);
        });

        it('pages and walks a selection, the walk ordered by a property it does not name', async () => {
            const batch: string = await storeShoppers();

            const page: PaginationResult<{ id: string, email: string }> = await reposOf().shoppers.findAllPaginated(1, 1, {
                where: { batch },
                select: ['email'],
                order: { name: 'DESC' }
            });
            const first: KeysetPage<{ id: string, email: string }> = await reposOf().shoppers.findAllAfter(undefined, 1, {
                where: { batch },
                select: ['email'],
                order: { name: 'ASC' }
            });
            const second: KeysetPage<{ id: string, email: string }> = await reposOf().shoppers.findAllAfter(first.nextCursor, 1, {
                where: { batch },
                select: ['email'],
                order: { name: 'ASC' }
            });

            expect([page.items.map(s => s.email), page.totalAmount]).toEqual([['grace@example.com'], 2]);
            expect([...first.items, ...second.items].map(s => Object.keys(s).sort())).toEqual([['email', 'id'], ['email', 'id']]);
            expect([...first.items, ...second.items].map(s => s.email)).toEqual(['ada@example.com', 'grace@example.com']);
        });

        it('streams a selection', async () => {
            const batch: string = await storeShoppers();

            const streamed: string[] = [];
            for await (const shopper of reposOf().shoppers.stream({ where: { batch }, select: ['email'] })) {
                streamed.push(Object.keys(shopper).sort()
                    .join(','));
            }

            expect(streamed).toEqual(['email,id', 'email,id']);
        });
    });
}