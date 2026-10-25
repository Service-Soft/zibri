/* eslint-disable unicorn/no-null */
import assert from 'node:assert';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { EqualOperator, FindOptionsWhere, FindOperator, ObjectLiteral, FindOptionsWhere as ToFindOptionsWhere } from 'typeorm';

import { Where, WhereFilter } from './where-filter.model';
import { Address } from '../../../__testing__/mocks/entities/address.model';
import { Company } from '../../../__testing__/mocks/entities/company.entity';
import { Profile } from '../../../__testing__/mocks/entities/profile.entity';
import { Role } from '../../../__testing__/mocks/entities/role.entity';
import { User } from '../../../__testing__/mocks/entities/user.entity';
import { TestTimeouts } from '../../../__testing__/constants';
import { createTestDataSource, defaultTestServerEntities, defaultTestServerRepositories } from '../../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../../__testing__/test-server/start-test-server.function';
import { inject } from '../../../di/inject.function';
import { BaseEntity } from '../../../entity/base-entity.model';
import { Newable } from '../../../types/newable.type';
import { DataSource } from '../../decorators/data-source.decorator';

// the factory returns a decorated class, so extending it registers two data sources and deploys one.
// The base exists to be inherited from, never to be run
@DataSource()
// the related entities as well: a filter through a relation is a statement over the related rows,
// which asks the orm for them
class DbDataSource extends createTestDataSource({
        allowOrphan: true,
        entities: [...defaultTestServerEntities, User, Company, Profile, Role],
        repositories: defaultTestServerRepositories
    }) {}

function whereFilterToFindOptionsWhere<T extends BaseEntity>(
    filter: Where<T>,
    entityClass: Newable<T>
): Where<T> extends WhereFilter<T>[] ? ToFindOptionsWhere<T>[] : ToFindOptionsWhere<T> {
    return inject(DbDataSource).whereFilterToFindOptionsWhere(filter, entityClass);
}

let server: StartedTestServer;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [DbDataSource] });
}, TestTimeouts.postgres.start);

afterAll(async () => {
    await server.shutdown();
}, TestTimeouts.postgres.shutdown);

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
        // joined with a condition that the array is not empty, which an allow list never finds
        expect(result.tags).toEqual(expect.objectContaining({
            type: 'and',
            value: [expect.objectContaining({ type: 'arrayContainedBy', value: ['bar'] }), expect.objectContaining({ type: 'raw' })]
        }));
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
    it('nested where on json fields yields a Raw operator that binds what the caller supplied', () => {
        const filter: Where<User> = { address: { where: { street: 'Main St' } } };
        const result: FindOptionsWhere<User> = whereFilterToFindOptionsWhere(filter, User);

        expect(result.address).toBeInstanceOf(FindOperator);
        const raw: FindOperator<Address> = result.address as FindOperator<Address>;

        const sql: string | undefined = raw.getSql?.('"TestAlias"."address"');
        const parameters: ObjectLiteral = raw.objectLiteralParameters ?? {};

        // neither the value nor the json key reaches the statement. The key is bound rather than
        // escaped because a json key does not have to be spellable as a sql identifier
        expect(sql).not.toContain('Main St');
        expect(sql).not.toContain('street');
        expect(Object.values(parameters)).toEqual(['street', 'Main St']);

        // asserted through the names rather than against a literal `zi_p0`, because the numbering is
        // per converter and never resets - pinning it here would make this test depend on what ran
        // before it
        // the column is tested for holding an object before anything inside it is compared, because
        // an absent key reads as null - without the guard, a row with no address at all would answer
        // questions about the street inside it
        const [key, value]: string[] = Object.keys(parameters);
        const guard: string = '("TestAlias"."address" IS NOT NULL AND "TestAlias"."address" <> \'null\'::jsonb)';
        expect(sql).toBe(`(${guard} AND ("TestAlias"."address"->>:${key}::text) = :${value})`);
    });
    it('a where through a relation asks for a related row matching it, by a statement over the related rows', () => {
        const filter: Where<User> = { company: { where: { id: '42' } } };
        const result: FindOptionsWhere<User> = whereFilterToFindOptionsWhere(filter, User);

        // a statement rather than a join: joined with no related row the columns are null, and a
        // filter a null satisfies would be satisfied by the row that has nothing related
        expect(result.company).toBeUndefined();
        // the statements over related rows are carried on the id, as one condition they all have to hold
        const onId: FindOperator<FindOperator<unknown>[]> = result.id as unknown as FindOperator<FindOperator<unknown>[]>;
        expect(onId).toBeInstanceOf(FindOperator);
        expect(onId.type).toBe('and');
        expect(onId.value).toHaveLength(1);
        const [raw] = onId.value;
        assert(raw);
        expect(raw.type).toBe('raw');
        const sql: string = raw.getSql?.('User.id') ?? '';
        expect(sql).toContain('EXISTS (SELECT 1 FROM "company" WHERE "company"."ownerId" = User.id AND "company"."id" IN (SELECT');
        expect(Object.values(raw.objectLiteralParameters ?? {})).toContain('42');
    });
});