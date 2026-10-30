/* eslint-disable unicorn/no-null */
import { beforeAll, describe, expect, it } from '@jest/globals';

import { PostgresDataSource, PostgresOptions } from './postgres-data-source.model';
import { PostgresPooler } from './postgres-pooler.model';
import { PostgresSchema } from './postgres-schema.model';
import { PostgresWhereFilterConverter } from './postgres-where-filter.converter';
import { Company } from '../../../__testing__/mocks/entities/company.entity';
import { Profile } from '../../../__testing__/mocks/entities/profile.entity';
import { Role } from '../../../__testing__/mocks/entities/role.entity';
import { User } from '../../../__testing__/mocks/entities/user.entity';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { initDiContainer } from '../../../di/init-di-container.function';
import { inject } from '../../../di/inject.function';
import { BaseEntity } from '../../../entity/base-entity.model';
import { Newable } from '../../../types/newable.type';
import { SchemaManagement } from '../../models/schema-management.model';
import { Where } from '../../models/where/where-filter.model';
import { RepositoryClass } from '../../repository/repository-class.type';
import { ParameterizedSql } from '../where-converter/parameterized-sql.model';

/**
 * A condition as a statement holds it, with each placeholder written as `?`, and what it binds in order.
 */
type Converted = {
    /**
     * The condition.
     */
    sql: string,
    /**
     * What it binds, in the order of its placeholders.
     */
    values: unknown[]
};

/**
 * The data source the converter belongs to, for what it decides about columns.
 */
class ConvertingDataSource extends PostgresDataSource {
    options: PostgresOptions = { ssl: false };
    entities: Newable<BaseEntity>[] = [User, Company, Profile, Role];
    repositories: RepositoryClass[] = [];
    schemaManagement: SchemaManagement = 'external';
    pooler: PostgresPooler = 'none';

    /**
     * Builds the converter this data source reads its filters with.
     * @returns The converter.
     */
    createConverter(): PostgresWhereFilterConverter {
        return new PostgresWhereFilterConverter(
            new PostgresSchema(this.entities, this.columnSettings),
            this.logger,
            { threshold: 0.3, thresholdIsInclusive: true }
        );
    }
}

let converter: PostgresWhereFilterConverter;

beforeAll(() => {
    initDiContainer();
    converter = new ConvertingDataSource(inject(ZIBRI_DI_TOKENS.LOGGER), inject(ZIBRI_DI_TOKENS.AUTH_SERVICE)).createConverter();
});

/**
 * Converts a filter on users read under the alias `u`.
 * @param filter - The filter.
 * @returns The condition, with its placeholders in order. Read through the names rather than against a
 * literal `zi_p0`, because the numbering is per converter and never resets.
 */
function convert(filter: Where<User>): Converted {
    const converted: ParameterizedSql = converter.convert(filter, User, 'u');
    const values: unknown[] = [];
    const sql: string = converted.sql.replaceAll(/(?<!:):(zi_p\d+)/g, (_, name: string) => {
        values.push(converted.parameters[name]);
        return '?';
    });
    return { sql, values };
}

describe('PostgresWhereFilterConverter - values', () => {
    it('compares a text with a value', () => {
        expect(convert({ name: 'Alice' })).toEqual({ sql: '"u"."name" = ?', values: ['Alice'] });
    });

    it('compares a number with a value', () => {
        expect(convert({ age: 42 })).toEqual({ sql: '"u"."age" = ?', values: [42] });
    });

    it('compares a yes or no with a value', () => {
        expect(convert({ active: true })).toEqual({ sql: '"u"."active" = ?', values: [true] });
    });

    it('asks for no value with null', () => {
        expect(convert({ age: null })).toEqual({ sql: '"u"."age" IS NULL', values: [] });
    });
});

describe('PostgresWhereFilterConverter - lists of texts', () => {
    it('asks a list for holding the values', () => {
        expect(convert({ tags: { includes: ['foo'] } })).toEqual({ sql: '"u"."tags" @> ?', values: [['foo']] });
    });

    it('asks a list for holding nothing else than the values, and something', () => {
        // a list holding nothing is asked for with a length of 0 alone, which an allow list never finds
        expect(convert({ tags: { isIncludedIn: ['bar'] } })).toEqual({
            sql: '("u"."tags" <@ ? AND cardinality("u"."tags") > 0)',
            values: [['bar']]
        });
    });
});

describe('PostgresWhereFilterConverter - numbers', () => {
    it('compares a number with a greater one', () => {
        expect(convert({ age: { greaterThan: 10 } })).toEqual({ sql: '"u"."age" > ?', values: [10] });
    });

    it('compares a number with a lesser or equal one', () => {
        expect(convert({ age: { lesserThanEquals: 5 } })).toEqual({ sql: '"u"."age" <= ?', values: [5] });
    });
});

describe('PostgresWhereFilterConverter - dates', () => {
    const date: Date = new Date('2025-01-01');

    it('compares a date with a later one', () => {
        expect(convert({ created: { after: date } })).toEqual({ sql: '"u"."created" > ?', values: [date] });
    });

    it('compares a date with an earlier one', () => {
        expect(convert({ created: { before: date } })).toEqual({ sql: '"u"."created" < ?', values: [date] });
    });
});

describe('PostgresWhereFilterConverter - objects and relations', () => {
    it('binds what a filter inside a json value names, the key as well', () => {
        // the key is bound rather than escaped, because a json key does not have to be spellable as a
        // sql identifier. The column is tested for holding an object before anything inside it is
        // compared, because an absent key reads as null - without the guard, a row with no address at
        // all would answer questions about the street inside it. The text is compared by the collation
        // the text columns have, the default locale's
        const guard: string = '("u"."address" IS NOT NULL AND "u"."address" <> \'null\'::jsonb)';
        expect(convert({ address: { where: { street: 'Main St' } } })).toEqual({
            sql: `(${guard} AND ("u"."address"->>?::text) COLLATE "en-US-x-icu" = ?)`,
            values: ['street', 'Main St']
        });
    });

    it('asks a relation for a related row matching a filter, by a statement over the related rows', () => {
        const { sql, values }: Converted = convert({ company: { where: { id: '42' } } });

        // a statement rather than a join: joined with no related row the columns are null, and a filter a
        // null satisfies would be satisfied by the row that has nothing related
        expect(sql).toMatch(/^EXISTS \(SELECT 1 FROM "company" WHERE "company"."ownerId" = "u"."id" AND "company"."id" IN \(SELECT /);
        expect(values).toEqual(['42']);
    });
});