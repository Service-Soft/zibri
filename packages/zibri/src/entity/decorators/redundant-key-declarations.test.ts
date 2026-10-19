import { describe, expect, it } from '@jest/globals';

import { Entity } from './entity.decorator';
import { Property } from './property.decorator';
import { whereFor } from '../../data-source/models/where/where-for.function';
import { InternalError } from '../../error-handling/internal-error.model';
import { KeyGroups, keyGroupsOf } from '../../global/model-registry/key-descriptor';
import { Newable } from '../../types/newable.type';
import { BaseEntity } from '../base-entity.model';

/**
 * What a key may be declared as, and where.
 *
 * A primary key names at most one row and a unique constraint is enforced by an index of its own, so
 * every pair below is one declaration asking for what another already gives. None of them is a
 * question the framework can answer by picking one: someone who wrote `unique` beside `primary` may
 * have meant a different column, and someone who put an already unique column into a group may have
 * meant the combination to be the constraint. So they are refused where they are written - at
 * declaration time, before anything boots - with a message that names the class, the property and
 * what to remove.
 */

/**
 * Asserts that a declaration is refused, and that the message says enough to act on.
 * @param declare - Declares the entity, applying the decorators under test.
 * @param fragments - What the message has to name: the place, the reason and the way out.
 */
function expectRefusal(declare: () => unknown, ...fragments: string[]): void {
    expect(declare).toThrow(InternalError);
    for (const fragment of fragments) {
        expect(declare).toThrow(fragment);
    }
}

/**
 * Declares a primary key that also asks to be unique.
 * @returns The declared class.
 */
function primaryAndUnique(): Newable<object> {
    class Invoice {
        @Property.string({ primary: true, unique: true })
        id!: string;
    }
    return Invoice;
}

/**
 * Declares a primary key that also asks to be indexed.
 * @returns The declared class.
 */
function primaryAndIndex(): Newable<object> {
    class Invoice {
        @Property.string({ primary: true, index: true })
        id!: string;
    }
    return Invoice;
}

/**
 * Declares a string primary key without the uuid format.
 * @returns The declared class.
 */
function primaryWithoutFormat(): Newable<object> {
    class Invoice {
        @Property.string({ primary: true, format: undefined })
        id!: string;
    }
    return Invoice;
}

/**
 * Declares a string primary key holding email addresses.
 * @returns The declared class.
 */
function primaryAsEmail(): Newable<object> {
    class Invoice {
        @Property.string({ primary: true, format: 'email' })
        id!: string;
    }
    return Invoice;
}

/**
 * Declares a unique column that also asks to be indexed.
 * @returns The declared class.
 */
function uniqueAndIndex(): Newable<BaseEntity> {
    class Invoice extends BaseEntity {
        @Property.string({ unique: true, index: true })
        reference!: string;
    }
    return Invoice;
}

/**
 * Declares each of the three on a column of its own.
 * @returns The declared class.
 */
function oneKeyPerColumn(): Newable<BaseEntity> {
    class Invoice extends BaseEntity {
        @Property.string({ unique: true })
        reference!: string;

        @Property.string({ index: true })
        tenantId!: string;
    }
    return Invoice;
}

/**
 * Declares a unique group around a column that is unique on its own.
 * @returns The declared class.
 */
function uniqueGroupAroundUniqueColumn(): Newable<BaseEntity> {
    @Entity({ tenant: 'shared', allowOrphan: true, uniques: [['reference', 'tenantId']] })
    class Invoice extends BaseEntity {
        @Property.string({ unique: true })
        reference!: string;

        @Property.string()
        tenantId!: string;
    }
    return Invoice;
}

/**
 * Declares a unique group that contains the primary key.
 * @returns The declared class.
 */
function uniqueGroupAroundPrimaryKey(): Newable<BaseEntity> {
    @Entity({ tenant: 'shared', allowOrphan: true, uniques: [['id', 'tenantId']] })
    class Invoice extends BaseEntity {
        @Property.string()
        tenantId!: string;
    }
    return Invoice;
}

/**
 * Declares an index group that starts with a column that is unique on its own.
 * @returns The declared class.
 */
function indexGroupBehindUniqueColumn(): Newable<BaseEntity> {
    @Entity({ tenant: 'shared', allowOrphan: true, indexes: [['reference', 'status']] })
    class Invoice extends BaseEntity {
        @Property.string({ unique: true })
        reference!: string;

        @Property.string()
        status!: string;
    }
    return Invoice;
}

/**
 * Declares an index group that reaches a unique column after one that carries no key of its own.
 * @returns The declared class.
 */
function indexGroupPastUniqueColumn(): Newable<BaseEntity> {
    @Entity({ tenant: 'shared', allowOrphan: true, indexes: [['status', 'reference']] })
    class Invoice extends BaseEntity {
        @Property.string()
        status!: string;

        @Property.string({ unique: true })
        reference!: string;
    }
    return Invoice;
}

/**
 * Declares the same one column indexed twice: once as the flag, once as a group of one.
 * @returns The declared class.
 */
function indexGroupOfOneIndexedColumn(): Newable<BaseEntity> {
    @Entity({ tenant: 'shared', allowOrphan: true, indexes: [['tenantId']] })
    class Invoice extends BaseEntity {
        @Property.string({ index: true })
        tenantId!: string;
    }
    return Invoice;
}

/**
 * Declares the same unique group twice, in the two orders it can be written in.
 * @returns The declared class.
 */
function uniqueGroupDeclaredTwice(): Newable<BaseEntity> {
    @Entity({ tenant: 'shared', allowOrphan: true, uniques: [['year', 'recipientId'], ['recipientId', 'year']] })
    class Invoice extends BaseEntity {
        @Property.number()
        year!: number;

        @Property.string()
        recipientId!: string;
    }
    return Invoice;
}

/**
 * Declares one index group twice, and the same columns in the other order beside it.
 * @returns The declared class.
 */
function indexGroupDeclaredTwice(): Newable<BaseEntity> {
    @Entity({ tenant: 'shared', allowOrphan: true, indexes: [['tenantId', 'status'], ['status', 'tenantId'], ['tenantId', 'status']] })
    class Invoice extends BaseEntity {
        @Property.string()
        tenantId!: string;

        @Property.string()
        status!: string;
    }
    return Invoice;
}

/**
 * Declares the same columns as two groups, each in its own order.
 * @returns The declared class.
 */
function indexGroupsInBothOrders(): Newable<BaseEntity> {
    @Entity({ tenant: 'shared', allowOrphan: true, indexes: [['tenantId', 'status'], ['status', 'tenantId']] })
    class Invoice extends BaseEntity {
        @Property.string()
        tenantId!: string;

        @Property.string()
        status!: string;
    }
    return Invoice;
}

/**
 * Declares a lookup by one column beside a lookup that starts with the same one.
 * @returns The declared class.
 */
function indexBesideGroupItLeads(): Newable<BaseEntity> {
    @Entity({ tenant: 'shared', allowOrphan: true, indexes: [['tenantId', 'status']] })
    class Invoice extends BaseEntity {
        @Property.string({ index: true })
        tenantId!: string;

        @Property.string()
        status!: string;
    }
    return Invoice;
}

/**
 * Declares an index group beside a longer one that starts with the same columns.
 * @returns The declared class.
 */
function indexGroupLeadingLongerGroup(): Newable<BaseEntity> {
    @Entity({ tenant: 'shared', allowOrphan: true, indexes: [['tenantId', 'status'], ['tenantId', 'status', 'placedAt']] })
    class Invoice extends BaseEntity {
        @Property.string()
        tenantId!: string;

        @Property.string()
        status!: string;

        @Property.date()
        placedAt!: Date;
    }
    return Invoice;
}

/**
 * Declares, on an entity whose rows belong to a tenant, an index that the tenant leads into a group
 * declared beside it.
 * @returns The declared class.
 */
function indexLedIntoGroupByTenant(): Newable<BaseEntity> {
    @Entity({ allowOrphan: true, indexes: [['tenantId', 'status']] })
    class Invoice extends BaseEntity {
        @Property.string({ format: 'uuid' })
        tenantId!: string;

        @Property.string({ index: true })
        status!: string;
    }
    return Invoice;
}

/**
 * Declares an index on the first column of a unique group.
 * @returns The declared class.
 */
function indexLeadingUniqueGroup(): Newable<BaseEntity> {
    @Entity({ tenant: 'shared', allowOrphan: true, uniques: [['year', 'recipientId']] })
    class Invoice extends BaseEntity {
        @Property.number({ index: true })
        year!: number;

        @Property.string()
        recipientId!: string;
    }
    return Invoice;
}

/**
 * Declares an index group over the columns of a unique group, in the same order.
 * @returns The declared class.
 */
function indexGroupOfUniqueGroup(): Newable<BaseEntity> {
    @Entity({ tenant: 'shared', allowOrphan: true, uniques: [['year', 'recipientId']], indexes: [['year', 'recipientId']] })
    class Invoice extends BaseEntity {
        @Property.number()
        year!: number;

        @Property.string()
        recipientId!: string;
    }
    return Invoice;
}

/**
 * Declares an index leading a unique group among only some rows, and one over the columns of a unique
 * group in another order.
 * @returns The declared class.
 */
function indexesBesideUniqueGroupsTheyDoNotLead(): Newable<BaseEntity> {
    @Entity({
        tenant: 'shared',
        allowOrphan: true,
        uniques: [{ properties: ['year', 'recipientId'], where: whereFor<Invoice>({ cancelled: false }) }, ['number', 'recipientId']],
        indexes: [['recipientId', 'number']]
    })
    class Invoice extends BaseEntity {
        @Property.number({ index: true })
        year!: number;

        @Property.string()
        recipientId!: string;

        @Property.number()
        number!: number;

        @Property.boolean()
        cancelled!: boolean;
    }
    return Invoice;
}

/**
 * Declares the groups that no single column covers, beside the singles that no group covers.
 * @returns The declared class.
 */
function groupsThatCoverSomething(): Newable<BaseEntity> {
    @Entity({ tenant: 'shared', allowOrphan: true, uniques: [['year', 'recipientId']], indexes: [['tenantId', 'status']] })
    class Invoice extends BaseEntity {
        @Property.number()
        year!: number;

        @Property.string()
        recipientId!: string;

        @Property.string()
        tenantId!: string;

        @Property.string()
        status!: string;

        @Property.date({ index: true })
        placedAt!: Date;
    }
    return Invoice;
}

describe('a property that declares a key it already has', () => {

    it('refuses "unique" on the primary key', () => {
        expectRefusal(
            primaryAndUnique,
            'Invoice.id',
            '"primary" and "unique"',
            'names at most one row',
            'Remove "unique"'
        );
    });

    it('refuses "index" on the primary key', () => {
        expectRefusal(
            primaryAndIndex,
            'Invoice.id',
            '"primary" and "index"',
            'indexed by the constraint that enforces it',
            'Remove "index"'
        );
    });

    it('refuses a string primary key without the uuid format', () => {
        expectRefusal(primaryWithoutFormat, 'Invoice.id', 'holds uuids', 'declare no format', 'Remove "format"');
    });

    it('refuses a string primary key of another format', () => {
        expectRefusal(primaryAsEmail, 'Invoice.id', 'holds uuids', 'the format "email"', 'Remove "format"');
    });

    it('refuses "index" beside "unique"', () => {
        expectRefusal(
            uniqueAndIndex,
            'Invoice.reference',
            '"unique" and "index"',
            'enforced by an index of its own',
            'Remove "index"'
        );
    });

    it('takes each of them on a column of its own', () => {
        expect(keyGroupsOf(oneKeyPerColumn())).toEqual({
            uniques: [{ properties: ['reference'], where: undefined }],
            indexes: [['tenantId']]
        });
    });
});

describe('an entity group that one of its columns already covers', () => {

    it('refuses a unique group around a column that is unique on its own', () => {
        expectRefusal(
            uniqueGroupAroundUniqueColumn,
            'Invoice',
            '(reference, tenantId)',
            'already declared unique on its own',
            'Drop the group, or remove "unique" from "reference"'
        );
    });

    it('refuses a unique group that contains the primary key', () => {
        expectRefusal(
            uniqueGroupAroundPrimaryKey,
            'Invoice',
            '(id, tenantId)',
            'the primary key',
            'rejects nothing the column does not reject on its own'
        );
    });

    it('refuses an index group that starts with a column that is unique', () => {
        // nothing the group answers is left over: the unique constraint keeps an index that answers
        // a lookup by "reference" alone, and every lookup this group answers begins there
        expectRefusal(
            indexGroupBehindUniqueColumn,
            'Invoice',
            '(reference, status)',
            'already declared unique on its own',
            'every column from "reference" on is never read',
            'Drop the group.'
        );
    });

    it('refuses an index group that reaches a unique column further along', () => {
        // a group is unique wherever the unique column sits, but only what stands before it earns
        // its keep: a lookup by "status" alone is one the unique index cannot answer
        expectRefusal(
            indexGroupPastUniqueColumn,
            'Invoice',
            '(status, reference)',
            'already declared unique on its own',
            'every column from "reference" on is never read',
            'Declare "index" on "status" instead of the group.'
        );
    });

    it('refuses one column indexed as the flag and as a group of one', () => {
        expectRefusal(
            indexGroupOfOneIndexedColumn,
            'Invoice',
            '(tenantId)',
            'one index declared twice',
            'Keep either the group or "index" on "tenantId"'
        );
    });

    it('refuses the same unique group written in both of its orders', () => {
        // a unique group holds for the combination, so the two spellings are one constraint
        expectRefusal(
            uniqueGroupDeclaredTwice,
            'Invoice',
            '(year, recipientId) and (recipientId, year)',
            'the order it is written in carries nothing',
            'keep one of them'
        );
    });

    it('refuses the same index group declared twice', () => {
        expectRefusal(
            indexGroupDeclaredTwice,
            'Invoice',
            'The index group (tenantId, status) is declared twice',
            'Keep one of them'
        );
    });

    it('takes the same columns as two groups, each in its own order', () => {
        // an index group is a sequence: (tenantId, status) also answers a lookup by tenantId alone,
        // and (status, tenantId) one by status alone, so neither spells the other
        expect(keyGroupsOf(indexGroupsInBothOrders()).indexes).toEqual([['tenantId', 'status'], ['status', 'tenantId']]);
    });

    it('refuses an indexed column beside a group that starts with it', () => {
        // the group answers a lookup by tenantId alone as well, so the flag keeps a second index for
        // lookups the first one already answers
        expectRefusal(
            indexBesideGroupItLeads,
            'Invoice',
            '"index" on "tenantId" is the leading part of the index group (tenantId, status)',
            'Remove "index" from "tenantId".'
        );
    });

    it('refuses an index group that leads a longer one', () => {
        expectRefusal(
            indexGroupLeadingLongerGroup,
            'Invoice',
            'the index group (tenantId, status) is the leading part of the index group (tenantId, status, placedAt)',
            'Drop the group (tenantId, status).'
        );
    });

    it('refuses an index that leads a unique group, or names its columns in their order', () => {
        expectRefusal(
            indexLeadingUniqueGroup,
            'Invoice',
            '"index" on "year" is the leading part of the unique group (year, recipientId)',
            'Remove "index" from "year".'
        );
        expectRefusal(
            indexGroupOfUniqueGroup,
            'Invoice',
            'the index group (year, recipientId) is kept over the same columns in the same order as the unique group (year, recipientId)',
            'Drop the group (year, recipientId).'
        );
    });

    it('refuses an index the tenant makes the same as another', () => {
        // every index of a tenant's entity is led by the tenant, so the flag on status is kept as
        // (tenantId, status) - which the group already is
        expectRefusal(
            indexLedIntoGroupByTenant,
            'Invoice',
            '"index" on "status" is kept over the same columns in the same order as the index group (tenantId, status)',
            'Every index of Invoice starts with "tenantId", since its rows belong to a tenant.',
            'Remove "index" from "status".'
        );
    });

    it('takes an index leading a unique group among only some rows, or one in another order', () => {
        // a lookup that does not name the rows of a partial unique cannot use its index, and an index
        // in another order answers lookups by another first column
        expect(keyGroupsOf(indexesBesideUniqueGroupsTheyDoNotLead()).indexes).toEqual([['year'], ['recipientId', 'number']]);
    });

    it('takes the groups that no single column covers', () => {
        const groups: KeyGroups = keyGroupsOf(groupsThatCoverSomething());
        // the singles first, then the groups, each in the order it was declared: an index on
        // (tenantId, status) answers a lookup by tenantId, and one on (status, tenantId) does not
        expect(groups).toEqual({
            uniques: [{ properties: ['year', 'recipientId'], where: undefined }],
            indexes: [['placedAt'], ['tenantId', 'status']]
        });
    });
});