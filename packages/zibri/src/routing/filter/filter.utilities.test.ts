import { describe, expect, it } from '@jest/globals';
import { FilterConfig, OrderConfig } from 'zibri-contract';

import { Where } from '../../data-source/models/where/where-filter.model';
import { BaseEntity } from '../../entity/base-entity.model';
import { Property } from '../../entity/decorators/property.decorator';
import { CrudControllerOrderUtilities } from '../models/crud-controller-order.utilities';
import { FilterUtilities } from './filter.utilities';

class Address {
    @Property.string()
    street!: string;

    @Property.string()
    city!: string;
}

class Contact {
    @Property.string()
    email!: string;
}

class Customer extends BaseEntity {
    @Property.string()
    name!: string;

    @Property.string({ format: 'uuid' })
    externalId!: string;

    @Property.number()
    rating!: number;

    @Property.date()
    since!: Date;

    @Property.boolean()
    active!: boolean;

    @Property.object({ cls: () => Address })
    address!: Address;

    @Property.array({ items: { type: 'string' } })
    tags!: string[];

    @Property.array({ items: { type: 'object', cls: () => Contact } })
    contacts!: Contact[];

    @Property.string({ exclude: true })
    note!: string;

    @Property.string({ password: true })
    password!: string;
}

// eslint-disable-next-line typescript/typedef
const customerFilter = {
    name: 'iLike',
    rating: 'range',
    since: 'range',
    address: { street: 'equals', city: 'oneOf' },
    tags: 'oneOf',
    contacts: { email: 'equals' }
} as const satisfies FilterConfig<Customer>;

describe('FilterUtilities', () => {
    it('resolves the where of every filter with a value, the properties inside nested in a where of their own', () => {
        const where: Where<Customer> | undefined = FilterUtilities.resolveWhere(customerFilter, Customer, {
            name: '50%_off',
            rating: { from: 2 },
            since: { to: new Date('2026-01-01') },
            address: { street: 'Main Street', city: ['Berlin', 'Hamburg'] },
            tags: ['vip'],
            contacts: { email: 'max@example.com' }
        });

        expect(where).toEqual({
            name: { iLike: '%50\\%\\_off%' },
            rating: { greaterThanEquals: 2 },
            since: { beforeOrOn: new Date('2026-01-01') },
            address: { where: { street: 'Main Street', city: { oneOf: ['Berlin', 'Hamburg'] } } },
            tags: { where: { oneOf: ['vip'] } },
            contacts: { where: { email: 'max@example.com' } }
        });
    });

    it('leaves out the filters without a value, and objects whose filters have none', () => {
        expect(FilterUtilities.resolveWhere(customerFilter, Customer, { name: '', tags: [], address: { street: '' } })).toBeUndefined();
        expect(FilterUtilities.resolveWhere(customerFilter, Customer, { rating: {} })).toBeUndefined();
    });

    it('accepts a config whose matches fit the entity', () => {
        expect(() => FilterUtilities.resolveFilterClass(customerFilter, Customer)).not.toThrow();
        expect(() => FilterUtilities.resolveFilterClass({ name: 'fuzzy', active: 'equals', tags: 'includes' }, Customer)).not.toThrow();
    });

    it.each<[string, FilterConfig<Customer> | Record<string, unknown>, RegExp]>([
        ['a property the entity lacks', { missing: 'equals' }, /doesn't have/],
        ['an excluded property', { note: 'equals' }, /excluded, encrypted or hashed property or a password/],
        ['a password', { password: 'iLike' }, /excluded, encrypted or hashed property or a password/],
        ['text matched in a number', { rating: 'iLike' }, /matches a number by "iLike"/],
        ['a range of text', { name: 'range' }, /matches a string by "range"/],
        ['a boolean matched by one of several values', { active: 'oneOf' }, /matches a boolean by "oneOf"/],
        ['an array of objects matched by a match of its own', { contacts: 'includes' }, /array of objects/],
        ['a similarity of a string that holds nothing to be similar to', { externalId: 'fuzzy' }, /similarity/],
        ['an object matched by a match', { address: 'equals' }, /matches a object/],
        ['nested filters of a property that holds a single value', { name: { first: 'equals' } }, /neither a match nor/],
        ['a property inside an object the object lacks', { address: { zip: 'equals' } }, /"Customer.address.zip"/]
    ])('refuses %s', (_, config, message) => {
        // the configs that aren't a FilterConfig<Customer> are the ones a plain JavaScript caller could pass
        expect(() => FilterUtilities.resolveFilterClass(config as FilterConfig<Customer>, Customer)).toThrow(message);
    });
});

describe('CrudControllerOrderUtilities', () => {
    it('lets a list be ordered by the plain values, and by the properties it is given', () => {
        expect(CrudControllerOrderUtilities.resolveOrderClass(Customer, undefined)).toBeDefined();
        expect(() => CrudControllerOrderUtilities.resolveOrderClass(Customer, { rating: true, address: { city: true } })).not.toThrow();
    });

    it.each<[string, Record<string, unknown>, RegExp]>([
        ['an excluded property', { note: true }, /only by a string, number, boolean or date/],
        ['a password', { password: true }, /only by a string, number, boolean or date/],
        ['an object as a whole', { address: true }, /only by a string, number, boolean or date/],
        ['an array', { tags: true }, /only by a string, number, boolean or date/],
        ['the items of an array', { contacts: { email: true } }, /not of an array or a relation to many/],
        ['a property the entity lacks', { missing: true }, /doesn't have/]
    ])('refuses to order by %s', (_, config, message) => {
        // the configs that aren't an OrderConfig<Customer> are the ones a plain JavaScript caller could pass
        expect(() => CrudControllerOrderUtilities.resolveOrderClass(Customer, config as OrderConfig<Customer>)).toThrow(message);
    });
});