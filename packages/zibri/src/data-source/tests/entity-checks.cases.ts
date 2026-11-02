/* eslint-disable jsdoc/require-jsdoc */
import { describe, expect, it } from '@jest/globals';

import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { $t } from '../../localization/translate.function';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { CheckConstraintViolationError } from '../check-constraint-violation.error';
import { propertyOf } from '../models/where/property-of.function';
import { whereFor } from '../models/where/where-for.function';
import { Repository } from '../repository/repository';

/**
 * The cases every data source answers the same way about the checks of an entity: a write leaving a
 * row that breaks one is refused, whichever way it writes, and null is judged the same everywhere. A
 * file per data source runs them against a repository of its own.
 */

/**
 * The earliest a chore may start, as a check of it names.
 */
const EARLIEST_START: string = '2000-01-01T00:00:00.000Z';

@Entity({
    tenant: 'shared',
    allowOrphan: true,
    allowDuplicate: true,
    uniques: [['code']],
    checks: [
        {
            // eslint-disable-next-line unicorn/no-null
            where: whereFor<Chore>([{ status: { not: 'done' } }, { completedAt: { not: null } }]),
            code: 'completedAtRequired',
            message: $t`a done chore has a completion date`
        },
        { where: whereFor<Chore>({ estimate: { greaterThanEquals: 1 } }), code: 'estimateTooSmall', message: $t`takes at least 1` },
        { where: whereFor<Chore>({ label: { notOneOf: ['forbidden'] } }), code: 'labelForbidden', message: $t`this label is forbidden` },
        {
            // eslint-disable-next-line unicorn/no-null
            where: whereFor<Chore>([{ endsAt: null }, { endsAt: { after: propertyOf('startsAt') } }]),
            code: 'endsBeforeStart',
            message: $t`a chore ends after it starts`
        },
        {
            // eslint-disable-next-line unicorn/no-null
            where: whereFor<Chore>([{ startsAt: null }, { startsAt: { afterOrOn: new Date(EARLIEST_START) } }]),
            code: 'startsTooEarly',
            message: $t`a chore starts in this millennium`
        },
        whereFor<Chore>({ status: { not: 'archived' } })
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

    @Property.date({ required: false })
    startsAt?: Date | null;

    @Property.date({ required: false })
    endsAt?: Date | null;
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

        // a check compared a property with a value only, and refused a date as that value
        it('refuses a row whose one property breaks a comparison with another, naming both', async () => {
            const startsAt: Date = new Date('2026-05-01T08:00:00.000Z');
            const chore: Chore = await choresOf().create({
                code: freshCode(),
                status: 'open',
                estimate: 2,
                startsAt,
                endsAt: new Date('2026-05-01T09:00:00.000Z')
            });

            const refusal: Promise<Chore> = choresOf()
                .create({ code: freshCode(), status: 'open', estimate: 2, startsAt, endsAt: startsAt });
            await expect(refusal).rejects.toThrow(CheckConstraintViolationError);
            await expect(refusal).rejects.toMatchObject({ properties: ['endsAt', 'startsAt'] });
            // the other property moving is judged the same way
            await expect(choresOf().updateById(chore.id, { startsAt: new Date('2026-05-01T10:00:00.000Z') }))
                .rejects.toThrow(CheckConstraintViolationError);
            expect((await choresOf().findById(chore.id)).startsAt).toEqual(startsAt);
        });

        it('refuses a date on the wrong side of the one a check names', async () => {
            await expect(choresOf().create({
                code: freshCode(),
                status: 'open',
                estimate: 2,
                startsAt: new Date('1999-12-31T23:59:59.999Z')
            })).rejects.toThrow(CheckConstraintViolationError);
            const chore: Chore = await choresOf().create({
                code: freshCode(),
                status: 'open',
                estimate: 2,
                startsAt: new Date(EARLIEST_START)
            });
            expect((await choresOf().findById(chore.id)).startsAt).toEqual(new Date(EARLIEST_START));
        });

        // a write the data source refused answered with the filter alone, without the
        // code and message the check was declared with
        it('answers a refused write with the code and message of the check it breaks, under the body', async () => {
            const chore: Chore = await choresOf().create({ code: freshCode(), status: 'open', estimate: 2 });

            const refusal: Promise<Chore> = choresOf().updateById(chore.id, { status: 'done' });

            await expect(refusal).rejects.toThrow(CheckConstraintViolationError);
            await expect(refusal).rejects.toMatchObject({
                code: 'completedAtRequired',
                problems: [{ key: 'body', code: 'completedAtRequired', message: 'a done chore has a completion date' }]
            });
        });

        it('answers a refused write with the code `check` for a check declared as its filter alone', async () => {
            const refusal: Promise<Chore> = choresOf().create({ code: freshCode(), status: 'archived', estimate: 2 });

            await expect(refusal).rejects.toMatchObject({
                code: 'check',
                problems: [{ key: 'body', code: 'check', message: 'breaks the check on "status"' }]
            });
        });
    });
}