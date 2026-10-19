/* eslint-disable jsdoc/require-jsdoc */
import { describe, expect, it } from '@jest/globals';

import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { CheckConstraintViolationError } from '../check-constraint-violation.error';
import { whereFor } from '../models/where/where-for.function';
import { Repository } from '../repository/repository';

/**
 * The cases every data source answers the same way about the checks of an entity: a write leaving a
 * row that breaks one is refused, whichever way it writes, and null is judged the same everywhere. A
 * file per data source runs them against a repository of its own.
 */

@Entity({
    tenant: 'shared',
    allowOrphan: true,
    allowDuplicate: true,
    uniques: [['code']],
    checks: [
        // eslint-disable-next-line unicorn/no-null
        whereFor<Chore>([{ status: { not: 'done' } }, { completedAt: { not: null } }]),
        whereFor<Chore>({ estimate: { greaterThanEquals: 1 } }),
        whereFor<Chore>({ label: { notOneOf: ['forbidden'] } })
    ]
})
export class Chore extends BaseEntity {
    @Property.string()
    code!: string;

    @Property.string()
    status!: string;

    @Property.date({ required: false })
    completedAt?: Date | null;

    @Property.number({ required: false })
    estimate?: number | null;

    @Property.string({ required: false })
    label?: string | null;
}

/**
 * Runs every case against the chores of one data source.
 * @param dataSourceName - The data source, for the name of the cases.
 * @param choresOf - Reads the repository, once the data source is started.
 */
export function describeEntityChecks(dataSourceName: string, choresOf: () => Repository<Chore>): void {
    function freshCode(): string {
        return `chore-${UUIDUtilities.generate()}`;
    }

    describe(`the checks of an entity, on ${dataSourceName}`, () => {
        it('stores a row that follows every check', async () => {
            const chore: Chore = await choresOf().create({ code: freshCode(), status: 'open', estimate: 2 });

            expect((await choresOf().findById(chore.id)).status).toBe('open');
        });

        it('refuses a create that breaks a check, naming what it checks, and stores nothing', async () => {
            const code: string = freshCode();

            const refusal: Promise<Chore> = choresOf().create({ code, status: 'done', estimate: 2 });

            await expect(refusal).rejects.toThrow(CheckConstraintViolationError);
            await expect(refusal).rejects.toMatchObject({ properties: ['status', 'completedAt'] });
            expect(await choresOf().count({ where: { code } })).toBe(0);
        });

        it('refuses an update that would break a check, and leaves the row as it was', async () => {
            const chore: Chore = await choresOf().create({ code: freshCode(), status: 'open', estimate: 2 });

            await expect(choresOf().updateById(chore.id, { status: 'done' })).rejects.toThrow(CheckConstraintViolationError);

            expect((await choresOf().findById(chore.id)).status).toBe('open');
            await choresOf().updateById(chore.id, { status: 'done', completedAt: new Date() });
            expect((await choresOf().findById(chore.id)).status).toBe('done');
        });

        it('refuses an updateAll that would break a check, and changes no row', async () => {
            const chore: Chore = await choresOf().create({ code: freshCode(), status: 'open', estimate: 2 });

            await expect(choresOf().updateAll({ code: chore.code }, { estimate: 0 })).rejects.toThrow(CheckConstraintViolationError);

            expect((await choresOf().findById(chore.id)).estimate).toBe(2);
        });

        it('refuses an upsert whose conflict path would break a check', async () => {
            const code: string = freshCode();
            await choresOf().create({ code, status: 'open', estimate: 2 });

            await expect(choresOf().upsert({ code }, { code, status: 'open', estimate: 2 }, { status: { set: 'done' } }))
                .rejects.toThrow(CheckConstraintViolationError);

            expect((await choresOf().findOne({ where: { code } })).status).toBe('open');
        });

        it('refuses null for a property a check compares by size', async () => {

            await expect(choresOf().create({
                code: freshCode(),
                status: 'open',
                // eslint-disable-next-line unicorn/no-null
                estimate: null
            })).rejects.toThrow(CheckConstraintViolationError);
        });

        it('takes null for a property a check says must not be one of a list', async () => {
            // eslint-disable-next-line unicorn/no-null
            const chore: Chore = await choresOf().create({ code: freshCode(), status: 'open', estimate: 2, label: null });

            expect((await choresOf().findById(chore.id)).label).toBeNull();
            await expect(choresOf().create({ code: freshCode(), status: 'open', estimate: 2, label: 'forbidden' }))
                .rejects.toThrow(CheckConstraintViolationError);
        });
    });
}