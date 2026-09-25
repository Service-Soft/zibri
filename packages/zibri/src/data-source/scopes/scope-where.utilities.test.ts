/* eslint-disable unicorn/no-null */
import { beforeAll, describe, expect, it } from '@jest/globals';

import { ScopedWhere, ScopeWhereUtilities } from './scope-where.utilities';
import { initDiContainer } from '../../di/init-di-container.function';
import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property, PropertyMetadata } from '../../entity/decorators/property.decorator';
import { type OneOf } from '../../entity/models/one-of.model';
import { MetadataUtilities } from '../../utilities/metadata.utilities';
import { Where, WhereFilter } from '../models/where/where-filter.model';

class MailAddress {
    @Property.string()
    street!: string;

    @Property.string()
    city!: string;
}

@Entity({ allowOrphan: true })
class Organization extends BaseEntity {
    @Property.string()
    name!: string;

    @Property.oneToMany({ target: () => Invoice, inverseSide: 'organization' })
    invoices!: Invoice[];
}

/**
 * A row owned by a user, with something else to filter on beside the owner.
 */
@Entity({ allowOrphan: true })
class Invoice extends BaseEntity {
    /**
     * The user the invoice belongs to.
     */
    @Property.string()
    userId!: string;

    /**
     * Whether it has been paid.
     */
    @Property.boolean()
    paid!: boolean;

    /**
     * What it is for.
     */
    @Property.string()
    title!: string;

    /**
     * What it comes to.
     */
    @Property.number()
    amount!: number;

    /**
     * When it is due.
     */
    @Property.date()
    dueAt!: Date;

    /**
     * Whatever it has been tagged with.
     */
    @Property.array({ items: { type: 'string' } })
    labels!: string[];

    /**
     * Where the invoice is sent, which is either an email address or a postal one.
     */
    @Property.oneOf({ shapes: { Email: { type: 'string' }, Postal: { type: 'object', cls: () => MailAddress } } })
    contact!: OneOf<{ Email: string, Postal: MailAddress }>;

    /**
     * Who the invoice is billed to.
     */
    @Property.manyToOne({ target: () => Organization, joinColumn: 'organizationId', inverseSide: 'invoices' })
    organization!: Organization;

    /**
     * The id of {@link Invoice.organization}.
     */
    @Property.string({ format: 'uuid' })
    organizationId!: string;

    /**
     * What has been paid towards it.
     */
    @Property.oneToMany({ target: () => Payment, inverseSide: 'invoice' })
    payments!: Payment[];
}

@Entity({ allowOrphan: true })
class Payment extends BaseEntity {
    @Property.number()
    amount!: number;

    @Property.string()
    payerId!: string;

    @Property.manyToOne({ target: () => Invoice, joinColumn: 'invoiceId', inverseSide: 'payments' })
    invoice!: Invoice;

    @Property.string({ format: 'uuid' })
    invoiceId!: string;
}

const properties: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(Invoice);

const owner: WhereFilter<Invoice> = { userId: 'me' };

/**
 * Applies a scope the way a repository does, with the entity's properties to read a condition by.
 * @param where - What the caller asked for.
 * @param scope - What the scope requires.
 * @returns The filter to query with, or the note that nothing can match it.
 */
function apply(where: Where<Invoice> | undefined, scope: Where<Invoice> | undefined): ScopedWhere<Invoice> {
    return ScopeWhereUtilities.applyToWhere(where, scope, properties);
}

describe('applyScopeToWhere', () => {
    // narrowing two bounds on text needs the order the application has, which is a registered option
    beforeAll(() => {
        initDiContainer();
    });

    it('leaves the filter alone when there is nothing to apply', () => {
        const res: ScopedWhere<Invoice> = apply({ paid: true }, undefined);
        expect(res.matchesNothing).toBe(false);
        expect(res.where).toEqual({ paid: true });
    });

    it('is the whole filter when the caller asked for nothing', () => {
        const res: ScopedWhere<Invoice> = apply(undefined, owner);
        expect(res.where).toEqual({ userId: 'me' });
    });

    it('adds to a filter on other properties', () => {
        const res: ScopedWhere<Invoice> = apply({ paid: true }, owner);
        expect(res.where).toEqual({ paid: true, userId: 'me' });
    });

    // an array of filters is an OR, so a fragment that only reached the first branch would leave
    // every other branch reading the whole table
    it('applies to every branch of an OR', () => {
        const res: ScopedWhere<Invoice> = apply([{ paid: true }, { title: 'rent' }], owner);
        expect(res.where).toEqual([
            { paid: true, userId: 'me' },
            { title: 'rent', userId: 'me' }
        ]);
    });

    describe('when the caller filters the scoped property themselves', () => {
        it('keeps a redundant condition, which is what call sites written defensively look like', () => {
            const res: ScopedWhere<Invoice> = apply({ userId: 'me' }, owner);
            expect(res.matchesNothing).toBe(false);
            expect(res.where).toEqual({ userId: { oneOf: ['me'] } });
        });

        it('matches nothing when they asked for somebody else', () => {
            const res: ScopedWhere<Invoice> = apply({ userId: 'other' }, owner);
            expect(res.matchesNothing).toBe(true);
        });

        it('intersects a list down to what the scope allows', () => {
            const res: ScopedWhere<Invoice> = apply({ userId: { oneOf: ['me', 'other'] } }, owner);
            expect(res.where).toEqual({ userId: { oneOf: ['me'] } });
        });

        it('matches nothing when the list holds nobody the scope allows', () => {
            const res: ScopedWhere<Invoice> = apply({ userId: { oneOf: ['other', 'third'] } }, owner);
            expect(res.matchesNothing).toBe(true);
        });

        it('keeps the rest of the condition on that property', () => {
            const res: ScopedWhere<Invoice> = apply({ userId: { not: 'other' } }, owner);
            expect(res.where).toEqual({ userId: { not: 'other', oneOf: ['me'] } });
        });

        it('matches nothing when the condition excludes the scope', () => {
            expect(apply({ userId: { not: 'me' } }, owner).matchesNothing).toBe(true);
            expect(apply({ userId: { notOneOf: ['me'] } }, owner).matchesNothing).toBe(true);
        });
    });

    it('drops only the branches that cannot match, and keeps the rest', () => {
        const res: ScopedWhere<Invoice> = apply([{ userId: 'other' }, { paid: true }], owner);
        expect(res.matchesNothing).toBe(false);
        expect(res.where).toEqual({ paid: true, userId: 'me' });
    });

    it('matches nothing when every branch is dropped', () => {
        const res: ScopedWhere<Invoice> = apply([{ userId: 'other' }, { userId: 'third' }], owner);
        expect(res.matchesNothing).toBe(true);
        expect(res.where).toBeUndefined();
    });

    // the scope may be an OR of its own - "what is public, or what is mine" - and the two sides have
    // to be combined as `(a or b) and (c or d)`. Folding the scope's branches into one another would
    // turn its "or" into an "and", which is a different and much smaller answer
    describe('when the scope itself is an OR', () => {
        const publicOrMine: WhereFilter<Invoice>[] = [{ paid: true }, { userId: 'me' }];

        it('keeps both alternatives when the caller asked for nothing', () => {
            const res: ScopedWhere<Invoice> = apply(undefined, publicOrMine);
            expect(res.where).toEqual([{ paid: true }, { userId: 'me' }]);
        });

        it('pairs every branch of the caller with every branch of the scope', () => {
            const res: ScopedWhere<Invoice> = apply([{ title: 'a' }, { title: 'b' }], publicOrMine);
            expect(res.where).toEqual([
                { title: 'a', paid: true },
                { title: 'a', userId: 'me' },
                { title: 'b', paid: true },
                { title: 'b', userId: 'me' }
            ]);
        });

        it('keeps the alternatives a caller condition does not rule out', () => {
            const res: ScopedWhere<Invoice> = apply({ userId: 'other' }, publicOrMine);

            // asking for somebody else's rows still leaves the public ones reachable, and only those
            expect(res.matchesNothing).toBe(false);
            expect(res.where).toEqual({ userId: 'other', paid: true });
        });

        it('matches nothing when the caller rules out every alternative', () => {
            const res: ScopedWhere<Invoice> = apply({ userId: 'other', paid: false }, publicOrMine);
            expect(res.matchesNothing).toBe(true);
        });
    });

    describe('array valued scope properties', () => {
        it('requires membership', () => {
            expect(apply(undefined, { labels: { includes: ['mine'] } }).where)
                .toEqual({ labels: { includes: ['mine'] } });
        });

        it('requires what the scope lists as well as what was asked for, rather than instead of it', () => {
            const res: ScopedWhere<Invoice> = apply(
                { labels: { includes: ['urgent'] } },
                { labels: { includes: ['mine'] } }
            );
            expect(res.matchesNothing).toBe(false);
            expect(res.where).toEqual({ labels: { includes: ['urgent', 'mine'] } });
        });

        // both sides say every label has to be on their list, so a label has to be on both lists -
        // taking them together would let through a row carrying a label the scope does not allow
        it('intersects two allow lists rather than joining them', () => {
            const res: ScopedWhere<Invoice> = apply(
                { labels: { isIncludedIn: ['rent', 'power'] } },
                { labels: { isIncludedIn: ['power', 'water'] } }
            );
            expect(res.where).toEqual({ labels: { isIncludedIn: ['power'] } });
        });

        // an empty allow list is not an impossible condition: a row carrying no labels at all
        // satisfies it, which is exactly what both lists together say
        it('allows nothing when the two lists share no label', () => {
            const res: ScopedWhere<Invoice> = apply(
                { labels: { isIncludedIn: ['rent'] } },
                { labels: { isIncludedIn: ['water'] } }
            );
            expect(res.matchesNothing).toBe(false);
            expect(res.where).toEqual({ labels: { isIncludedIn: [] } });
        });

        it('compares the values of a list rather than the objects holding them', () => {
            const due: Date = new Date('2026-01-01');
            const res: ScopedWhere<Invoice> = apply(
                { dueAt: { oneOf: [new Date('2026-01-01')] } },
                { dueAt: { oneOf: [due] } }
            );
            expect(res.matchesNothing).toBe(false);
            expect(res.where).toEqual({ dueAt: { oneOf: [due] } });
        });
    });

    it('does not mistake a value that happens to be an object for a filter', () => {
        const dueAt: Date = new Date('2026-01-01');
        const res: ScopedWhere<Invoice> = apply({ dueAt }, { userId: 'me' });
        expect(res.where).toEqual({ dueAt, userId: 'me' });
    });

    // both sides asking the same property for different things is the case a scope written for an
    // application meets: the scope is an ordinary filter, so it reaches every key a caller does
    describe('when both sides ask the same property for different things', () => {
        it('keeps the bound that allows the fewest rows', () => {
            expect(apply({ amount: { greaterThan: 10 } }, { amount: { greaterThan: 100 } }).where)
                .toEqual({ amount: { greaterThan: 100 } });
            expect(apply({ amount: { lesserThanEquals: 900 } }, { amount: { lesserThanEquals: 100 } }).where)
                .toEqual({ amount: { lesserThanEquals: 100 } });
        });

        it('keeps the bound that allows the fewest rows for dates as well', () => {
            const early: Date = new Date('2026-01-01');
            const late: Date = new Date('2026-06-01');
            expect(apply({ dueAt: { before: late } }, { dueAt: { before: early } }).where)
                .toEqual({ dueAt: { before: early } });
            expect(apply({ dueAt: { afterOrOn: early } }, { dueAt: { afterOrOn: late } }).where)
                .toEqual({ dueAt: { afterOrOn: late } });
        });

        it('excludes both values a negation names', () => {
            const res: ScopedWhere<Invoice> = apply({ title: { not: 'void' } }, { title: { not: 'draft' } });
            expect(res.where).toEqual({ title: { not: 'void', notOneOf: ['draft'] } });
        });

        it('matches nothing when both name a single value and the values differ', () => {
            expect(apply({ labels: { length: 2 } }, { labels: { length: 3 } }).matchesNothing).toBe(true);
            expect(apply({ labels: { length: 2 } }, { labels: { length: 2 } }).where)
                .toEqual({ labels: { length: 2 } });
        });

        it('matches nothing when the two relations named are not the same one', () => {
            const mine: Organization = Object.assign(new Organization(), { id: 'org-1' });
            const other: Organization = Object.assign(new Organization(), { id: 'org-2' });
            expect(apply({ organization: { is: other } }, { organization: { is: mine } }).matchesNothing).toBe(true);
            expect(apply({ organization: { is: mine } }, { organization: { is: mine } }).where)
                .toEqual({ organization: { is: mine } });
        });

        // a to one relation is a single row, so both conditions are conditions on that one row
        it('combines what both sides ask of a to one relation', () => {
            const res: ScopedWhere<Invoice> = apply(
                { organization: { where: { name: 'acme' } } },
                { organization: { where: { id: 'org-1' } } }
            );
            expect(res.where).toEqual({ organization: { where: { name: 'acme', id: 'org-1' } } });
        });

        // both conditions are asked of the same payment - "a payment of mine over 100" rather than
        // "a payment of mine and a payment over 100", which is the narrower of the two readings
        it('asks a to many relation for a row that satisfies both', () => {
            const res: ScopedWhere<Invoice> = apply(
                { payments: { where: { amount: { greaterThan: 100 } } } },
                { payments: { where: { payerId: 'me' } } }
            );
            expect(res.where).toEqual({ payments: { where: { amount: { greaterThan: 100 }, payerId: 'me' } } });
        });

        it('asks the items of an array for a value that satisfies both', () => {
            const res: ScopedWhere<Invoice> = apply(
                { labels: { where: { oneOf: ['team-a', 'rent'] } } },
                { labels: { where: { like: 'team-%' } } }
            );
            expect(res.where).toEqual({ labels: { where: { oneOf: ['team-a', 'rent'], like: 'team-%' } } });
        });

        // two patterns are two patterns - "starts with rent" and "ends with 2026" is neither of them,
        // and is not a third pattern either, so the row has to be like both
        it('asks for both patterns', () => {
            expect(apply({ title: { like: 'rent%' } }, { title: { like: '%2026' } }).where)
                .toEqual({ title: { like: ['rent%', '%2026'] } });
        });

        it('keeps one pattern that both sides ask for', () => {
            expect(apply({ title: { like: 'rent%' } }, { title: { like: 'rent%' } }).where)
                .toEqual({ title: { like: 'rent%' } });
        });

        // text is ordered by the application, and every data source is held to that order, so the
        // narrower of two bounds on it is as decidable as the narrower of two dates
        it('keeps the bound that allows the fewest rows for text as well', () => {
            expect(apply({ title: { after: 'Bravo' } }, { title: { after: 'Delta' } }).where)
                .toEqual({ title: { after: 'Delta' } });
            expect(apply({ title: { before: 'Delta' } }, { title: { before: 'Bravo' } }).where)
                .toEqual({ title: { before: 'Bravo' } });
        });

        it('adds to the patterns a filter already carries several of', () => {
            expect(apply({ title: { like: ['rent%', '%2026'] } }, { title: { like: '%q1%' } }).where)
                .toEqual({ title: { like: ['rent%', '%2026', '%q1%'] } });
        });
    });

    // a value of several shapes is filtered by naming every shape, so two such filters are combined
    // shape by shape rather than compared as values
    describe('when both sides filter a value of several shapes', () => {
        it('combines the filters of each shape', () => {
            const res: ScopedWhere<Invoice> = apply(
                { contact: { whenEmail: { like: '%@work.com' }, whenPostal: {} } },
                { contact: { whenEmail: { not: 'ceo@work.com' }, whenPostal: { where: { city: 'Berlin' } } } }
            );
            expect(res.where).toEqual({
                contact: {
                    whenEmail: { like: '%@work.com', not: 'ceo@work.com' },
                    whenPostal: { where: { city: 'Berlin' } }
                }
            });
        });

        it('keeps a shape the scope refuses refused, whatever the caller asks of it', () => {
            const res: ScopedWhere<Invoice> = apply(
                { contact: { whenEmail: {}, whenPostal: { where: { city: 'Berlin' } } } },
                { contact: { whenEmail: {}, whenPostal: false } }
            );
            expect(res.where).toEqual({ contact: { whenEmail: {}, whenPostal: false } });
        });

        // one shape no value can satisfy is not the whole property: the row can still be one of the
        // other shapes, so the branch stays and only that shape is closed
        it('refuses a shape whose two filters contradict each other', () => {
            const res: ScopedWhere<Invoice> = apply(
                { contact: { whenEmail: 'me@work.com', whenPostal: {} } },
                { contact: { whenEmail: 'you@work.com', whenPostal: {} } }
            );
            expect(res.matchesNothing).toBe(false);
            expect(res.where).toEqual({ contact: { whenEmail: false, whenPostal: {} } });
        });

        it('matches nothing when every shape is refused', () => {
            const res: ScopedWhere<Invoice> = apply(
                { contact: { whenEmail: 'me@work.com', whenPostal: false } },
                { contact: { whenEmail: 'you@work.com', whenPostal: {} } }
            );
            expect(res.matchesNothing).toBe(true);
        });

        it('matches nothing when one side asks for no value at all', () => {
            const res: ScopedWhere<Invoice> = apply(
                { contact: null },
                { contact: { whenEmail: {}, whenPostal: false } }
            );
            expect(res.matchesNothing).toBe(true);
        });

        it('leaves a filter the other side says nothing about alone', () => {
            const res: ScopedWhere<Invoice> = apply(
                { contact: { whenEmail: { like: '%@work.com' }, whenPostal: false } },
                owner
            );
            expect(res.where).toEqual({
                contact: { whenEmail: { like: '%@work.com' }, whenPostal: false },
                userId: 'me'
            });
        });
    });
});