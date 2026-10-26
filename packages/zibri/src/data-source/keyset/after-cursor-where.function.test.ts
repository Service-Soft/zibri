import { beforeAll, describe, expect, it } from '@jest/globals';

import { afterCursorWhere, KeysetStep, keysetStepsFor, keysetValuesOf } from './after-cursor-where.function';
import { KeysetOrderKey, resolveKeysetOrder } from './keyset-order.model';
import { initDiContainer } from '../../di/init-di-container.function';
import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property, PropertyMetadata } from '../../entity/decorators/property.decorator';
import { BadRequestError } from '../../error-handling/errors/bad-request.error';
import { GlobalRegistry } from '../../global/global-registry';
import { MetadataUtilities } from '../../utilities/metadata.utilities';
import { BigNumber } from '../../utilities/number.utilities';
import { WhereFilterEvaluator } from '../data-sources/where-converter/where-filter.evaluator';
import { ScopedWhere } from '../scopes/scope-where.utilities';

@Entity({ tenant: 'shared', allowOrphan: true })
class WalkedRow extends BaseEntity {
    @Property.number()
    rank!: number;
}

const evaluator: WhereFilterEvaluator = new WhereFilterEvaluator();

const properties: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(WalkedRow);

/**
 * A row of the walked table.
 * @param id - Its primary key.
 * @param rank - What the walk is ordered by.
 * @returns The row.
 */
function walkedRow(id: string, rank: number): WalkedRow {
    const res: WalkedRow = new WalkedRow();
    res.id = id;
    res.rank = rank;
    return res;
}

describe('afterCursorWhere', () => {
    beforeAll(() => {
        initDiContainer();
    });

    it('holds the caller\'s condition on an ordered property next to the position', () => {
        const keys: KeysetOrderKey[] = resolveKeysetOrder(WalkedRow, { rank: 'ASC', id: 'ASC' });
        const steps: KeysetStep[] = keysetStepsFor([2, 'b'], keys);

        const scoped: ScopedWhere<WalkedRow> = afterCursorWhere<WalkedRow>({ rank: { lesserThan: 4 } }, steps, properties);

        // past rank 2 and still under 4: the position narrows the caller's filter, and a row the
        // caller excluded stays excluded however far past the cursor it sits
        const after: WalkedRow[] = [walkedRow('c', 3), walkedRow('d', 4), walkedRow('e', 5)]
            .filter(row => evaluator.matches(row, scoped.where ?? {}, WalkedRow));
        expect(after.map(row => row.rank)).toEqual([3]);
    });
});

@Entity({ tenant: 'shared', allowOrphan: true })
class LedgerRow extends BaseEntity {
    @Property.number({ format: 'bigint' })
    sequence!: bigint;

    @Property.number({ format: 'bignumber' })
    amount!: BigNumber;
}

// 01 §D9: a bigint or an exact decimal was refused as a cursor value, and read back through Number
describe('a cursor over numbers past what a double holds', () => {
    beforeAll(() => {
        initDiContainer();
        // a refused cursor is a translated error, which needs an application to translate in
        GlobalRegistry.markAppAsCreated();
    });

    it('carries a bigint and an exact decimal through the cursor without losing a digit', () => {
        const keys: KeysetOrderKey[] = resolveKeysetOrder(LedgerRow, { sequence: 'ASC', amount: 'DESC', id: 'ASC' });
        const row: LedgerRow = new LedgerRow();
        row.id = 'a';
        row.sequence = 9007199254740993n;
        row.amount = new BigNumber('12345678901234567890.123456789');

        const steps: KeysetStep[] = keysetStepsFor(keysetValuesOf(row, keys), keys);

        expect(steps.map(step => step.value)).toEqual([9007199254740993n, new BigNumber('12345678901234567890.123456789'), 'a']);
    });

    it('refuses a cursor whose value is not a number of the ordered format', () => {
        const keys: KeysetOrderKey[] = resolveKeysetOrder(LedgerRow, { sequence: 'ASC', id: 'ASC' });

        expect(() => keysetStepsFor(['1.5', 'a'], keys)).toThrow(BadRequestError);
        expect(() => keysetStepsFor(['twelve', 'a'], keys)).toThrow(BadRequestError);
    });
});