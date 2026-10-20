import { describe, expect, it } from 'vitest';

import { Entity } from './entity.decorator.ts';
import { Property } from './property.decorator.ts';
import { SoftDeleteEntity } from '../../change-sets/models/soft-delete-entity.model.ts';
import { whereFor } from '../../data-source/models/where/where-for.function.ts';
import { InternalError } from '../../error-handling/internal-error.model.ts';
import { keyGroupsOf } from '../../global/model-registry/key-descriptor.ts';
import { Newable } from '../../types/newable.type.ts';
import { BaseEntity } from '../base-entity.model.ts';

/**
 * What a unique declaration has to say on an entity whose rows can be gone without being removed.
 *
 * A soft deleted row is present and absent at once, and a plain unique constraint counts it as
 * present - which is why an address a user deleted can never be registered again. The other reading
 * is just as ordinary: an address that stays taken is how deleting an account stops being a way to
 * shed its history. Nothing in `unique: true` distinguishes them, so a soft delete entity has to
 * say which it means, and the boot refuses one that does not.
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

describe('soft delete key declarations', () => {
    it('refuses a property that says only "unique"', () => {
        expectRefusal(
            () => {
                @Entity({ tenant: 'shared', allowOrphan: true })
                class Account extends SoftDeleteEntity {
                    @Property.string({ unique: true })
                    email!: string;
                }
                return Account;
            },
            'Account.email',
            'whether soft deleted rows still hold the value',
            'where: whereFor<Account>({ deleted: false })'
        );
    });

    it('refuses a group that says only which columns', () => {
        expectRefusal(
            () => {
                @Entity({ tenant: 'shared', allowOrphan: true, uniques: [['tenantId', 'email']] })
                class TenantAccount extends SoftDeleteEntity {
                    @Property.string()
                    tenantId!: string;

                    @Property.string()
                    email!: string;
                }
                return TenantAccount;
            },
            'The unique group (tenantId, email)',
            'whether soft deleted rows still hold the value'
        );
    });

    it('accepts a property that names the rows it covers, and keeps the filter', () => {
        @Entity({ tenant: 'shared', allowOrphan: true })
        class LiveAccount extends SoftDeleteEntity {
            @Property.string({ unique: { where: whereFor<LiveAccount>({ deleted: false }) } })
            email!: string;
        }

        // the declaration reaches the one list every store reads its keys from, as a group of one
        // carrying the rows it covers - a property and a group are one shape from here on
        expect(keyGroupsOf(LiveAccount).uniques).toEqual([{ properties: ['email'], where: { deleted: false } }]);
    });

    it('accepts an empty filter as the way to say every row', () => {
        @Entity({ tenant: 'shared', allowOrphan: true })
        class BurnedAccount extends SoftDeleteEntity {
            @Property.string({ unique: { where: whereFor<BurnedAccount>({}) } })
            email!: string;
        }

        // said out loud rather than defaulted to, which is the whole point: this entity means a
        // deleted address to stay taken, and now the declaration says so
        expect(keyGroupsOf(BurnedAccount).uniques).toEqual([{ properties: ['email'], where: {} }]);
    });

    it('leaves an entity that cannot be soft deleted alone', () => {
        @Entity({ tenant: 'shared', allowOrphan: true })
        class Widget extends BaseEntity {
            @Property.string({ unique: true })
            serial!: string;
        }

        // nothing to decide: its rows are there or they are removed, so `unique` already says which
        // rows it covers
        expect(keyGroupsOf(Widget).uniques).toEqual([{ properties: ['serial'], where: undefined }]);
    });

    it('still refuses a group built around a column that is unique over every row', () => {
        expectRefusal(
            () => {
                @Entity({ tenant: 'shared', allowOrphan: true, uniques: [['serial', 'batch']] })
                class Part extends BaseEntity {
                    @Property.string({ unique: true })
                    serial!: string;

                    @Property.string()
                    batch!: string;
                }
                return Part;
            },
            'contains "serial"'
        );
    });

    it('allows a group beside a column that is unique among only some rows', () => {
        @Entity({
            tenant: 'shared',
            allowOrphan: true,
            uniques: [{ properties: ['email', 'tenantId'], where: whereFor<Membership>({}) }]
        })
        class Membership extends SoftDeleteEntity {
            @Property.string({ unique: { where: whereFor<Membership>({ deleted: false }) } })
            email!: string;

            @Property.string()
            tenantId!: string;
        }

        // the group is the only thing constraining the deleted rows, so it rejects something the
        // column does not - which is why the redundancy check has to look at the rows as well
        const groups: Newable<Membership> = Membership;
        expect(keyGroupsOf(groups).uniques).toHaveLength(2);
    });
});