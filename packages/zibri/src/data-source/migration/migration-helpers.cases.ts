/* eslint-disable unicorn/no-null */
import { beforeEach, describe, expect, it } from '@jest/globals';

import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { DataSourceInterface } from '../data-sources/data-source.interface';
import { ValueConversion } from '../models/value-conversion.enum';
import { Repository } from '../repository/repository';
import { Transaction } from '../transaction/transaction.model';

/**
 * What the migration helpers are tried on.
 */
@Entity({ tenant: 'shared', allowOrphan: true, allowDuplicate: true })
export class Gadget extends BaseEntity {
    /**
     * A label, which a gadget may have none of. Indexed, so a case below can convert what an index
     * covers.
     */
    @Property.string({ required: false, index: true })
    label?: string | null;

    /**
     * A count.
     */
    @Property.number()
    count!: number;
}

/**
 * Where a case renames the gadgets to, and back from. Not an entity of the data source, the way an
 * entity a newer version renamed is not.
 */
@Entity({ tenant: 'shared', allowOrphan: true, allowDuplicate: true })
export class RetiredGadget extends BaseEntity {}

/**
 * What the helpers are tried on where the entity declares a unique itself.
 */
@Entity({ tenant: 'shared', allowOrphan: true, allowDuplicate: true, uniques: [['code']] })
export class Badge extends BaseEntity {
    /**
     * A code, which no two badges share.
     */
    @Property.string()
    code!: string;
}

/**
 * Where a case moves the badges to, to merge them back.
 */
@Entity({ tenant: 'shared', allowOrphan: true, allowDuplicate: true })
export class RetiredBadge extends BaseEntity {}

/**
 * What the cases run against.
 */
type MigrationHelpersTarget = {
    /**
     * The data source whose helpers are called.
     */
    dataSource: DataSourceInterface,
    /**
     * The gadgets stored in it.
     */
    gadgets: Repository<Gadget>,
    /**
     * The badges stored in it.
     */
    badges: Repository<Badge>
};

/**
 * Runs every case against the migration helpers of one data source.
 *
 * Each case ends with the gadgets stored as the class declares them, so that the next one starts from
 * the same place on a store with a schema too.
 * @param dataSourceName - The data source, for the name of the cases.
 * @param targetOf - Reads the data source and the repository, once the data source is started.
 */
export function describeMigrationHelpers(dataSourceName: string, targetOf: () => MigrationHelpersTarget): void {
    describe(`the migration helpers of ${dataSourceName}`, () => {

        /**
         * Runs one step of a migration in a transaction of its own, the way a migration runs.
         * @param step - The step.
         */
        async function migrate(step: (dataSource: DataSourceInterface, transaction: Transaction) => Promise<void>): Promise<void> {
            const { dataSource } = targetOf();
            const transaction: Transaction = await dataSource.startTransaction();
            try {
                await step(dataSource, transaction);
                await transaction.commit();
            }
            catch (error) {
                await transaction.rollback();
                throw error;
            }
        }

        /**
         * The gadgets, as label and count, in a stable order.
         * @returns What is stored.
         */
        async function storedGadgets(): Promise<[string | null, number][]> {
            const gadgets: Gadget[] = await targetOf().gadgets.findAll({ take: 'all' });
            return gadgets
                .map((g): [string | null, number] => [g.label ?? null, g.count])
                .sort((a, b) => a[1] - b[1]);
        }

        beforeEach(async () => {
            const { gadgets } = targetOf();
            await gadgets.deleteAll({});
            await gadgets.createAll([{ label: 'a', count: 1 }, { label: 'b', count: 2 }]);
        });

        /**
         * The message a migration step failed with.
         * @param step - The step.
         * @returns What it threw.
         */
        async function failureOf(step: (dataSource: DataSourceInterface, transaction: Transaction) => Promise<void>): Promise<string> {
            try {
                await migrate(step);
            }
            catch (error) {
                return error instanceof Error ? error.message : String(error);
            }
            throw new Error('The step did not fail.');
        }

        it('renames and retypes a property and keeps what it holds', async () => {
            await migrate((dataSource, transaction) => dataSource.changePropertyOfEntity({
                entity: Gadget,
                currentProperty: { name: 'count', type: 'number' },
                property: { name: 'countText', type: 'string' },
                transaction
            }));
            await migrate((dataSource, transaction) => dataSource.changePropertyOfEntity({
                entity: Gadget,
                currentProperty: { name: 'countText', type: 'string' },
                property: { name: 'count', type: 'number' },
                transaction
            }));

            // through text and back: every value survived both casts and both names
            expect(await storedGadgets()).toStrictEqual([['a', 1], ['b', 2]]);
        });

        it('writes a number as the text javascript writes it, and reads that text back as the same number', async () => {
            const counts: number[] = [0.1, -2.5, 1e21, 1.5e-7, 1e15, 1.234_567_890_123_456_8e20];
            await targetOf().gadgets.createAll(counts.map(count => ({ count })));

            await migrate((dataSource, transaction) => dataSource.changePropertyOfEntity({
                entity: Gadget,
                currentProperty: { name: 'count', type: 'number' },
                property: { name: 'countText', type: 'string' },
                transaction
            }));
            // listing exactly the texts javascript writes, and nothing else: a text written any other
            // way is one the conversion refuses by name
            await migrate((dataSource, transaction) => dataSource.changePropertyOfEntity({
                entity: Gadget,
                currentProperty: { name: 'countText', type: 'string' },
                property: { name: 'count', type: 'number' },
                convert: { values: [1, 2, ...counts].map(count => ({ from: String(count), to: count })), default: ValueConversion.NONE },
                transaction
            }));

            expect((await storedGadgets()).map(([, count]) => count)).toStrictEqual([1, 2, ...counts].sort((a, b) => a - b));
        });

        it('converts the values a conversion lists, ahead of the ones it casts', async () => {
            await migrate((dataSource, transaction) => dataSource.changePropertyOfEntity({
                entity: Gadget,
                currentProperty: { name: 'label', type: 'string', required: false },
                property: { name: 'label', type: 'string', required: false },
                convert: { values: [{ from: 'a', to: 'first' }], default: ValueConversion.CAST },
                transaction
            }));

            expect(await storedGadgets()).toStrictEqual([['first', 1], ['b', 2]]);
        });

        it('refuses a conversion that leaves a stored value out, naming it, and changes nothing', async () => {
            await expect(migrate((dataSource, transaction) => dataSource.changePropertyOfEntity({
                entity: Gadget,
                currentProperty: { name: 'label', type: 'string', required: false },
                property: { name: 'label', type: 'string', required: false },
                convert: { values: [{ from: 'a', to: 'first' }], default: ValueConversion.NONE },
                transaction
            }))).rejects.toThrow('"b"');

            expect(await storedGadgets()).toStrictEqual([['a', 1], ['b', 2]]);
        });

        it('refuses a current property that does not describe what is stored, and changes nothing', async () => {
            await expect(migrate((dataSource, transaction) => dataSource.changePropertyOfEntity({
                entity: Gadget,
                currentProperty: { name: 'count', type: 'string' },
                property: { name: 'count', type: 'number' },
                transaction
            }))).rejects.toThrow('Gadget.count');

            expect(await storedGadgets()).toStrictEqual([['a', 1], ['b', 2]]);
        });

        it('refuses a cast between types that have none, before it changes anything', async () => {
            await expect(migrate((dataSource, transaction) => dataSource.changePropertyOfEntity({
                entity: Gadget,
                currentProperty: { name: 'count', type: 'number' },
                property: { name: 'count', type: 'boolean' },
                // @ts-expect-error - a number has no cast into a boolean, so its values have to be listed
                convert: { default: ValueConversion.CAST },
                transaction
            }))).rejects.toThrow('has no cast');

            expect(await storedGadgets()).toStrictEqual([['a', 1], ['b', 2]]);
        });

        it('refuses text that is not a number written out, naming each, and changes nothing', async () => {
            await targetOf().gadgets.createAll([{ label: ' 7', count: 3 }, { label: '0x10', count: 4 }, { label: '1.50', count: 5 }]);

            const failure: string = await failureOf((dataSource, transaction) => dataSource.changePropertyOfEntity({
                entity: Gadget,
                currentProperty: { name: 'label', type: 'string', required: false },
                property: { name: 'label', type: 'number', required: false },
                transaction
            }));

            for (const refused of ['"a"', '"b"', '" 7"', '"0x10"']) {
                expect(failure).toContain(refused);
            }
            // a decimal with a trailing zero is still a number written out
            expect(failure).not.toContain('"1.50"');
            expect(await storedGadgets()).toStrictEqual([['a', 1], ['b', 2], [' 7', 3], ['0x10', 4], ['1.50', 5]]);
        });

        it('narrows a number into a whole number only when every value is one', async () => {
            await targetOf().gadgets.create({ label: 'c', count: 1.5 });

            await expect(migrate((dataSource, transaction) => dataSource.changePropertyOfEntity({
                entity: Gadget,
                currentProperty: { name: 'count', type: 'number' },
                property: { name: 'count', type: 'number', format: 'integer' },
                transaction
            }))).rejects.toThrow('1.5');
            expect(await storedGadgets()).toStrictEqual([['a', 1], ['c', 1.5], ['b', 2]]);

            await targetOf().gadgets.deleteAll({ count: 1.5 });
            await migrate((dataSource, transaction) => dataSource.changePropertyOfEntity({
                entity: Gadget,
                currentProperty: { name: 'count', type: 'number' },
                property: { name: 'count', type: 'number', format: 'integer' },
                transaction
            }));
            await migrate((dataSource, transaction) => dataSource.changePropertyOfEntity({
                entity: Gadget,
                currentProperty: { name: 'count', type: 'number', format: 'integer' },
                property: { name: 'count', type: 'number' },
                transaction
            }));
            expect(await storedGadgets()).toStrictEqual([['a', 1], ['b', 2]]);
        });

        it('refuses a missing value where the changed property requires one, and changes nothing', async () => {
            await targetOf().gadgets.create({ label: null, count: 3 });

            await expect(migrate((dataSource, transaction) => dataSource.changePropertyOfEntity({
                entity: Gadget,
                currentProperty: { name: 'label', type: 'string', required: false },
                property: { name: 'label', type: 'string' },
                transaction
            }))).rejects.toThrow('missing');

            expect(await storedGadgets()).toStrictEqual([['a', 1], ['b', 2], [null, 3]]);
        });

        it('refuses a text the changed enum does not hold, naming it, and changes nothing', async () => {
            await expect(migrate((dataSource, transaction) => dataSource.changePropertyOfEntity({
                entity: Gadget,
                currentProperty: { name: 'label', type: 'string', required: false },
                property: { name: 'label', type: 'string', required: false, enum: { A: 'a' } },
                transaction
            }))).rejects.toThrow('"b"');

            expect(await storedGadgets()).toStrictEqual([['a', 1], ['b', 2]]);
        });

        it('removes a property with what it holds, and adds it back empty', async () => {
            await migrate((dataSource, transaction) => dataSource.removePropertyFromEntity({
                entity: Gadget,
                propertyKey: 'label',
                transaction
            }));
            await migrate((dataSource, transaction) => dataSource.addPropertyToEntity({
                entity: Gadget,
                property: { name: 'label', type: 'string', required: false },
                transaction
            }));

            expect(await storedGadgets()).toStrictEqual([[null, 1], [null, 2]]);
        });

        it('converts the entities the migration created itself', async () => {
            await migrate(async (dataSource, transaction) => {
                await targetOf().gadgets.create({ label: 'a', count: 3 }, { transaction });
                await dataSource.changePropertyOfEntity({
                    entity: Gadget,
                    currentProperty: { name: 'label', type: 'string', required: false },
                    property: { name: 'label', type: 'string', required: false },
                    convert: { values: [{ from: 'a', to: 'first' }], default: ValueConversion.CAST },
                    transaction
                });
            });

            expect(await storedGadgets()).toStrictEqual([['first', 1], ['b', 2], ['first', 3]]);
        });

        it('renames an entity, and back, keeping what it stores', async () => {
            await migrate((dataSource, transaction) => dataSource.renameEntity({
                entity: RetiredGadget,
                currentTableName: 'gadget',
                transaction
            }));
            await migrate((dataSource, transaction) => dataSource.renameEntity({
                entity: Gadget,
                currentTableName: 'retired_gadget',
                transaction
            }));

            expect(await storedGadgets()).toStrictEqual([['a', 1], ['b', 2]]);
            expect(await countsLabelled('a')).toStrictEqual([1]);
        });

        it('renames an entity, back, and changes it, in one migration', async () => {
            await migrate(async (dataSource, transaction) => {
                await dataSource.renameEntity({ entity: RetiredGadget, currentTableName: 'gadget', transaction });
                await dataSource.renameEntity({ entity: Gadget, currentTableName: 'retired_gadget', transaction });
                await dataSource.changePropertyOfEntity({
                    entity: Gadget,
                    currentProperty: { name: 'label', type: 'string', required: false },
                    property: { name: 'label', type: 'string', required: false },
                    convert: { values: [{ from: 'a', to: 'first' }], default: ValueConversion.CAST },
                    transaction
                });
            });

            expect(await storedGadgets()).toStrictEqual([['first', 1], ['b', 2]]);
        });

        it('refuses to rename an entity onto one that stores entities already, and changes nothing', async () => {
            const { badges } = targetOf();
            await badges.deleteAll({});
            await badges.create({ code: 'a' });

            await expect(migrate((dataSource, transaction) => dataSource.renameEntity({
                entity: Badge,
                currentTableName: 'gadget',
                transaction
            }))).rejects.toThrow('already');

            expect(await storedGadgets()).toStrictEqual([['a', 1], ['b', 2]]);
            expect((await badges.findAll({ take: 'all' })).map(b => b.code)).toStrictEqual(['a']);
        });

        /**
         * The counts of the gadgets a filter on the label finds.
         * @param label - The label filtered by.
         * @returns Their counts, ascending.
         */
        async function countsLabelled(label: string): Promise<number[]> {
            const found: Gadget[] = await targetOf().gadgets.findAll({ where: { label } });
            return found.map(g => g.count).sort((a, b) => a - b);
        }

        it('finds a gadget by its indexed property under the value a migration converted it to', async () => {
            await migrate((dataSource, transaction) => dataSource.changePropertyOfEntity({
                entity: Gadget,
                currentProperty: { name: 'label', type: 'string', required: false },
                property: { name: 'label', type: 'string', required: false },
                convert: { values: [{ from: 'a', to: 'first' }], default: ValueConversion.CAST },
                transaction
            }));

            expect(await countsLabelled('first')).toStrictEqual([1]);
            expect(await countsLabelled('a')).toStrictEqual([]);
        });

        it('keeps the unique an entity declares enforced on a property a migration changed', async () => {
            const { badges } = targetOf();
            await badges.deleteAll({});
            await badges.createAll([{ code: 'a' }, { code: 'b' }]);

            await migrate((dataSource, transaction) => dataSource.changePropertyOfEntity({
                entity: Badge,
                currentProperty: { name: 'code', type: 'string' },
                property: { name: 'code', type: 'string' },
                transaction
            }));
            await expect(badges.create({ code: 'b' })).rejects.toThrow();

            await migrate((dataSource, transaction) => dataSource.changePropertyOfEntity({
                entity: Badge,
                currentProperty: { name: 'code', type: 'string' },
                property: { name: 'code', type: 'string' },
                convert: { values: [{ from: 'a', to: 'first' }], default: ValueConversion.CAST },
                transaction
            }));
            // the old value is free again, and the new one is taken
            await badges.create({ code: 'a' });
            await expect(badges.create({ code: 'first' })).rejects.toThrow();
        });

        // last, because the stores that build uniques while starting enforce the badges' only once the
        // next start built them again over the merged rows
        it('merges entities into one that stores entities already, leaving out the ones breaking a unique it declares', async () => {
            const { badges } = targetOf();
            await badges.deleteAll({});
            await badges.createAll([{ code: 'a' }, { code: 'b' }]);

            let stored: Badge[] = [];
            await migrate(async (dataSource, transaction) => {
                await dataSource.renameEntity({ entity: RetiredBadge, currentTableName: 'badge', transaction });
                await dataSource.createEntity({ entity: Badge, properties: 'resolveFromEntity', transaction });
                stored = await badges.createAll([{ code: 'b' }, { code: 'c' }], { transaction });
                await dataSource.mergeEntity({ entity: Badge, currentTableName: 'retired_badge', transaction });
            });

            const merged: Badge[] = await badges.findAll({ take: 'all' });
            expect(merged.map(b => b.code).sort()).toStrictEqual(['a', 'b', 'c']);
            expect(merged.find(b => b.code === 'b')?.id).toBe(stored.find(b => b.code === 'b')?.id);
        });
    });
}