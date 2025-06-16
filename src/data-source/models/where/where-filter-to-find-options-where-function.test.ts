/* eslint-disable unicorn/no-null */

import { describe, expect, it } from '@jest/globals';
import { EqualOperator, FindOptionsWhere, FindOperator, Equal, Raw } from 'typeorm';

import { whereFilterToFindOptionsWhere } from './where-filter-to-find-options-where.function';
import { Where } from './where-filter.model';
import { BaseEntity, Property } from '../../../entity';

class Address {
    @Property.string()
    street!: string;
    @Property.string()
    city!: string;
}

class Company implements BaseEntity {
    @Property.string({ primary: true })
    id!: string;
}

class User {
    @Property.string()
    name!: string;

    @Property.number()
    age!: number;

    @Property.boolean()
    active!: boolean;

    @Property.array({ items: { type: 'string' } })
    tags!: string[];

    @Property.date()
    created!: Date;

    @Property.object({ cls: () => Address })
    address!: Address;

    @Property.oneToOne({ target: () => Company })
    company!: Company;
}

describe('whereFilterToFindOptionsWhere - primitive filters', () => {
    it('string equality', () => {
        const result: FindOptionsWhere<User> = whereFilterToFindOptionsWhere({ name: 'Alice' }, User);
        expect(result.name).toBeInstanceOf(EqualOperator);
        expect((result.name as EqualOperator<string>).value).toBe('Alice');
    });

    it('number equality', () => {
        const result: FindOptionsWhere<User> = whereFilterToFindOptionsWhere({ age: 42 }, User);
        expect(result.age).toBeInstanceOf(EqualOperator);
        expect((result.age as EqualOperator<number>).value).toBe(42);
    });

    it('boolean equality', () => {
        const result: FindOptionsWhere<User> = whereFilterToFindOptionsWhere({ active: true }, User);
        expect(result.active).toBeInstanceOf(EqualOperator);
        expect((result.active as EqualOperator<boolean>).value).toBe(true);
    });

    it('null to IsNull', () => {
        const op: FindOptionsWhere<User> = whereFilterToFindOptionsWhere({ age: null }, User);
        expect(op.age).toBeInstanceOf(FindOperator);
        expect((op.age as FindOperator<number>).type).toBe('isNull');
    });
});

describe('whereFilterToFindOptionsWhere - string array filters', () => {
    it('includes uses ArrayContains', () => {
        const result: FindOptionsWhere<User> = whereFilterToFindOptionsWhere({ tags: { includes: ['foo'] } }, User);
        expect(result.tags).toBeInstanceOf(FindOperator);
        expect((result.tags as FindOperator<string>).value).toEqual(['foo']);
        expect((result.tags as FindOperator<string>).type).toBe('arrayContains');
    });

    it('isIncludedIn uses ArrayContainedBy', () => {
        const result: FindOptionsWhere<User> = whereFilterToFindOptionsWhere({ tags: { isIncludedIn: ['bar'] } }, User);
        expect(result.tags).toBeInstanceOf(FindOperator);
        expect((result.tags as FindOperator<string>).value).toEqual(['bar']);
        expect((result.tags as FindOperator<string>).type).toBe('arrayContainedBy');
    });
});

describe('whereFilterToFindOptionsWhere - number filters', () => {
    it('greaterThan to MoreThan', () => {
        const result: FindOptionsWhere<User> = whereFilterToFindOptionsWhere({ age: { greaterThan: 10 } }, User);
        expect(result.age).toBeInstanceOf(FindOperator);
        expect((result.age as FindOperator<number>).type).toBe('moreThan');
        expect((result.age as FindOperator<number>).value).toBe(10);
    });
    it('lesserThanEquals to LessThanOrEqual', () => {
        const result: FindOptionsWhere<User> = whereFilterToFindOptionsWhere({ age: { lesserThanEquals: 5 } }, User);
        expect(result.age).toBeInstanceOf(FindOperator);
        expect((result.age as FindOperator<number>).type).toBe('lessThanOrEqual');
        expect((result.age as FindOperator<number>).value).toBe(5);
    });
});

describe('whereFilterToFindOptionsWhere - date filters', () => {
    const date: Date = new Date('2025-01-01');
    it('after to MoreThan', () => {
        const result: FindOptionsWhere<User> = whereFilterToFindOptionsWhere({ created: { after: date } }, User);
        expect(result.created).toBeInstanceOf(FindOperator);
        expect((result.created as FindOperator<Date>).value).toBe(date);
    });
    it('before to LessThan', () => {
        const result: FindOptionsWhere<User> = whereFilterToFindOptionsWhere({ created: { before: date } }, User);
        expect(result.created).toBeInstanceOf(FindOperator);
        expect((result.created as FindOperator<Date>).value).toBe(date);
    });
});

describe('whereFilterToFindOptionsWhere - object filters', () => {
    it('nested where on json fields yields Raw operator', () => {
        const filter: Where<User> = { address: { where: { street: 'Main St' } } };
        const result: FindOptionsWhere<User> = whereFilterToFindOptionsWhere(filter, User);
        const expectedResult: FindOptionsWhere<User> = {
            address: Raw<Address>(
                alias => `${alias} @> :json`,
                { json: { street: Equal('Main St') } }
            )
        };
        expect(JSON.stringify(result)).toEqual(JSON.stringify(expectedResult));
    });
    it('nested where on relation fields yields nested filter', () => {
        const filter: Where<User> = { company: { where: { id: '42' } } };
        const result: FindOptionsWhere<User> = whereFilterToFindOptionsWhere(filter, User);
        const expectedResult: FindOptionsWhere<User> = {
            company: {
                id: Equal('42')
            }
        };
        expect(result).toEqual(expectedResult);
    });
});