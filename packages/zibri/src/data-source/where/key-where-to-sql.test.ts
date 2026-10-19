import { describe, expect, it } from '@jest/globals';

import { keyWhereToSql } from './key-where-to-sql.function';
import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { InternalError } from '../../error-handling/internal-error.model';
import { whereFor } from '../models/where/where-for.function';

/**
 * The predicate a partial key or a check is created with.
 *
 * A schema predicate cannot carry a parameter, so the values are written into the statement - which
 * is the shape C5 was about, and the reason the escaping here is tested rather than assumed. That a
 * declaration is written by a developer rather than sent by a caller is true only until somebody
 * builds one out of configuration.
 */

@Entity({ tenant: 'shared', allowOrphan: true })
class Registration extends BaseEntity {
    @Property.string()
    email!: string;

    @Property.string({ required: false })
    label: string | undefined | null;

    @Property.boolean()
    deleted!: boolean;

    @Property.number()
    attempts!: number;
}

/**
 * A second entity, so a filter can be typed against the wrong one without a cast.
 */
@Entity({ tenant: 'shared', allowOrphan: true })
class Invitation extends BaseEntity {
    @Property.string()
    invitedBy!: string;
}

describe('keyWhereToSql', () => {
    it('writes an equality against each kind of literal', () => {
        expect(keyWhereToSql(Registration, whereFor<Registration>({ deleted: false }))).toBe('"deleted" = FALSE');
        expect(keyWhereToSql(Registration, whereFor<Registration>({ attempts: 3 }))).toBe('"attempts" = 3');
        expect(keyWhereToSql(Registration, whereFor<Registration>({ email: 'a@b.c' }))).toBe('"email" = \'a@b.c\'');
    });

    it('quotes the column as it was written', () => {
        // nothing renames columns on the way into the schema, so an unquoted identifier would be
        // folded to lower case and match no column at all
        expect(keyWhereToSql(Registration, whereFor<Registration>({ attempts: 1 }))).toContain('"attempts"');
    });

    it('asks for null with IS NULL rather than with an equality', () => {
        // `= NULL` is never true, so the index would cover no row and the declaration would silently
        // constrain nothing. It is the shape a deletion timestamp takes rather than a flag, which is
        // the other half of what M13 is about
        // eslint-disable-next-line unicorn/no-null
        expect(keyWhereToSql(Registration, whereFor<Registration>({ label: null }))).toBe('"label" IS NULL');
    });

    it('ands the conditions of one filter and ors the branches', () => {
        expect(keyWhereToSql(Registration, whereFor<Registration>({ deleted: false, attempts: 0 })))
            .toBe('("deleted" = FALSE AND "attempts" = 0)');
        expect(keyWhereToSql(Registration, whereFor<Registration>([{ deleted: false }, { attempts: 0 }])))
            .toBe('"deleted" = FALSE OR "attempts" = 0');
    });

    it('escapes a quote in a value instead of closing the literal on it', () => {
        expect(keyWhereToSql(Registration, whereFor<Registration>({ label: 'it\'s' }))).toBe('"label" = \'it\'\'s\'');
        expect(keyWhereToSql(Registration, whereFor<Registration>({ label: 'x\' OR \'1\'=\'1' })))
            .toBe('"label" = \'x\'\' OR \'\'1\'\'=\'\'1\'');
    });

    it('refuses an operator a schema predicate cannot be built from', () => {
        expect(() => keyWhereToSql(Registration, whereFor<Registration>({ email: { like: '%@example.com' } })))
            .toThrow(InternalError);
    });

    it('writes not, answering a row holding none as the in process evaluator does', () => {
        // a row holding no value is not the value named, which `<>` would leave NULL
        expect(keyWhereToSql(Registration, whereFor<Registration>({ label: { not: 'x' } }))).toBe('"label" IS DISTINCT FROM \'x\'');
        // eslint-disable-next-line unicorn/no-null
        expect(keyWhereToSql(Registration, whereFor<Registration>({ label: { not: null } }))).toBe('"label" IS NOT NULL');
    });

    it('writes oneOf and notOneOf, null included where it is listed', () => {
        expect(keyWhereToSql(Registration, whereFor<Registration>({ label: { oneOf: ['a', 'b'] } }))).toBe('("label" IN (\'a\', \'b\'))');
        // eslint-disable-next-line unicorn/no-null
        expect(keyWhereToSql(Registration, whereFor<Registration>({ label: { oneOf: ['a', null] } })))
            .toBe('("label" IN (\'a\') OR "label" IS NULL)');
        expect(keyWhereToSql(Registration, whereFor<Registration>({ label: { notOneOf: ['a'] } })))
            .toBe('("label" IS NULL OR "label" NOT IN (\'a\'))');
        // eslint-disable-next-line unicorn/no-null
        expect(keyWhereToSql(Registration, whereFor<Registration>({ label: { notOneOf: ['a', null] } })))
            .toBe('("label" IS NOT NULL AND "label" NOT IN (\'a\'))');
        expect(keyWhereToSql(Registration, whereFor<Registration>({ label: { oneOf: [] } }))).toBe('FALSE');
        expect(keyWhereToSql(Registration, whereFor<Registration>({ label: { notOneOf: [] } }))).toBe('TRUE');
    });

    it('writes a comparison of numbers, and ands several operators on one property', () => {
        expect(keyWhereToSql(Registration, whereFor<Registration>({ attempts: { greaterThanEquals: 1, lesserThan: 5 } })))
            .toBe('("attempts" >= 1 AND "attempts" < 5)');
    });

    it('escapes a quote in a listed value as well', () => {
        expect(keyWhereToSql(Registration, whereFor<Registration>({ label: { notOneOf: ['it\'s'] } })))
            .toBe('("label" IS NULL OR "label" NOT IN (\'it\'\'s\'))');
    });

    it('refuses a column the entity does not declare', () => {
        // `whereFor` checks the filter against the entity it names, and nothing checks that this is
        // the entity it was declared on - a filter copied between two of them still compiles. So the
        // column is checked again where the predicate is built, rather than assumed
        expect(() => keyWhereToSql(Registration, whereFor<Invitation>({ invitedBy: 'someone' })))
            .toThrow('does not declare as a property');
    });
});