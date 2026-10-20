import { beforeAll, describe, expect, it } from 'vitest';

import { afterCursorWhere, KeysetStep, keysetStepsFor } from './after-cursor-where.function.ts';
import { KeysetOrderKey, resolveKeysetOrder } from './keyset-order.model.ts';
import { initDiContainer } from '../../di/init-di-container.function.ts';
import { BaseEntity } from '../../entity/base-entity.model.ts';
import { Entity } from '../../entity/decorators/entity.decorator.ts';
import { Property, PropertyMetadata } from '../../entity/decorators/property.decorator.ts';
import { MetadataUtilities } from '../../utilities/metadata.utilities.ts';
import { WhereFilterEvaluator } from '../data-sources/where-converter/where-filter.evaluator.ts';
import { ScopedWhere } from '../scopes/scope-where.utilities.ts';

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