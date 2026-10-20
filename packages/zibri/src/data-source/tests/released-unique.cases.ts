import { setTimeout as sleep } from 'node:timers/promises';

import { describe, expect, it } from 'vitest';

import { BaseEntity } from '../../entity/base-entity.model.ts';
import { Entity } from '../../entity/decorators/entity.decorator.ts';
import { Property } from '../../entity/decorators/property.decorator.ts';
import { UUIDUtilities } from '../../utilities/uuid.utilities.ts';
import { Repository } from '../repository/repository.ts';
import { Transaction } from '../transaction/transaction.model.ts';
import { UniqueConstraintViolationError } from '../unique-constraint-violation.error.ts';

/**
 * The cases every data source that runs transactions side by side answers the same way about a
 * unique value one transaction gives up while another write takes it. A file per data source runs
 * them against a repository of its own.
 *
 * Not run in memory: that data source writes nothing side by side, so there is no wait to observe.
 */

/**
 * How long the transaction giving the value up stays open while the other write waits for it.
 */
const HELD_FOR_IN_MS: number = 300;

/**
 * A handle no two accounts may share.
 */
@Entity({ tenant: 'shared', allowOrphan: true, allowDuplicate: true })
export class Handle extends BaseEntity {
    /**
     * Generated per test, which is what keeps one test's rows apart from the next.
     */
    @Property.string({ unique: true })
    name!: string;
}

/**
 * Runs every case against the handles of one data source.
 * @param dataSourceName - The data source, for the name of the cases.
 * @param handlesOf - Reads the repository, once the data source is started.
 */
export function describeReleasedUnique(dataSourceName: string, handlesOf: () => Repository<Handle>): void {
    /**
     * Creates a handle no other test uses.
     * @returns The handle as it was stored.
     */
    async function createHandle(): Promise<Handle> {
        return await handlesOf().create({ name: `handle-${UUIDUtilities.generate()}` });
    }

    describe(`a unique value given up inside a transaction, on ${dataSourceName}`, () => {
        it('is taken by another write once the transaction that changed it commits', async () => {
            const held: Handle = await createHandle();
            const transaction: Transaction = await handlesOf().dataSource.startTransaction();
            await handlesOf().updateById(held.id, { name: `handle-${UUIDUtilities.generate()}` }, { transaction });

            const taking: Promise<Handle> = handlesOf().create({ name: held.name });
            await sleep(HELD_FOR_IN_MS);
            await transaction.commit();

            expect((await taking).name).toBe(held.name);
        });

        it('is taken by another write once the transaction that deleted its row commits', async () => {
            const held: Handle = await createHandle();
            const transaction: Transaction = await handlesOf().dataSource.startTransaction();
            await handlesOf().deleteById(held.id, { transaction });

            const taking: Promise<Handle> = handlesOf().create({ name: held.name });
            await sleep(HELD_FOR_IN_MS);
            await transaction.commit();

            expect((await taking).name).toBe(held.name);
        });

        it('stays with its row when the transaction that changed it rolls back', async () => {
            const held: Handle = await createHandle();
            const transaction: Transaction = await handlesOf().dataSource.startTransaction();
            await handlesOf().updateById(held.id, { name: `handle-${UUIDUtilities.generate()}` }, { transaction });

            const taking: Promise<Handle> = handlesOf().create({ name: held.name });
            await sleep(HELD_FOR_IN_MS);
            await transaction.rollback();

            await expect(taking).rejects.toThrow(UniqueConstraintViolationError);
            expect((await handlesOf().findById(held.id)).name).toBe(held.name);
        });
    });
}