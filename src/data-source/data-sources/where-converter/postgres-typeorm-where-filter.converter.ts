import { Raw, FindOperator, DataSource as ToDataSource } from 'typeorm';
import { RelationMetadata as ToRelationMetadata } from 'typeorm/metadata/RelationMetadata.js';

import { TypeOrmWhereFilterConverter } from './typeorm-where-filter.converter';
import { BaseEntity } from '../../../entity/base-entity.model';
import { EntityMetadata } from '../../../entity/decorators/entity.decorator';
import { PropertyMetadata, RelationMetadata } from '../../../entity/decorators/property.decorator';
import { EntityMetadataMissingError } from '../../../entity/entity-metadata-missing.error';
import { Relation } from '../../../entity/models/relation.enum';
import { Newable } from '../../../types/newable.type';
import { MetadataUtilities } from '../../../utilities/metadata.utilities';
import { WhereFilterKeys } from '../../models/where/where-filter-keys.model';
import { Where } from '../../models/where/where-filter.model';

const ALIAS: string = '$$COL$$';
const elemAlias: string = 'elem';

/**
 * Handler function for a single where-filter key inside of jsonb.
 */
type JsonbOperatorHandler = (
    jsonPath: string,
    textPath: string,
    castPath: string,
    value: unknown,
    fieldKey: string,
    propMeta: PropertyMetadata | undefined
) => string;

/**
 * Converter that transforms a Zibri WhereFilter into a TypeORM FindOptionsWhere for postgres.
 */
export class PostgresTypeOrmWhereFilterConverter extends TypeOrmWhereFilterConverter {

    private readonly jsonbOperatorHandlers: Record<string, JsonbOperatorHandler> = {
        is: (jp, _tp, _cp, val) => val === null
            ? `${jp} = 'null'::jsonb`
            : `${jp} @> ${this.toJsonbLiteral(val as object)}`,
        not: (jp, _tp, cp, val) => {
            if (val === null) {
                return `${jp} IS NOT NULL`;
            }
            if (typeof val === 'object' && !Array.isArray(val)) {
                return `NOT (${jp} @> ${this.toJsonbLiteral(val)})`;
            }
            return `${cp} != ${this.toSqlLiteral(val)}`;
        },
        oneOf: (_jp, _tp, cp, val, fieldKey) => {
            if (!Array.isArray(val)) {
                throw new Error(`"oneOf" must be an array for JSONB field "${fieldKey}"`);
            }
            return `${cp} IN (${(val as unknown[]).map(v => this.toSqlLiteral(v)).join(', ')})`;
        },
        notOneOf: (_jp, _tp, cp, val, fieldKey) => {
            if (!Array.isArray(val)) {
                throw new Error(`"notOneOf" must be an array for JSONB field "${fieldKey}"`);
            }
            return `${cp} NOT IN (${(val as unknown[]).map(v => this.toSqlLiteral(v)).join(', ')})`;
        },
        like: (_jp, tp, _cp, val) => `${tp} LIKE ${this.toSqlLiteral(val)}`,
        iLike: (_jp, tp, _cp, val) => `${tp} ILIKE ${this.toSqlLiteral(val)}`,
        greaterThan: (_jp, _tp, cp, val) => `${cp} > ${this.toSqlLiteral(val)}`,
        after: (_jp, _tp, cp, val) => `${cp} > ${this.toSqlLiteral(val)}`,
        greaterThanEquals: (_jp, _tp, cp, val) => `${cp} >= ${this.toSqlLiteral(val)}`,
        lesserThan: (_jp, _tp, cp, val) => `${cp} < ${this.toSqlLiteral(val)}`,
        before: (_jp, _tp, cp, val) => `${cp} < ${this.toSqlLiteral(val)}`,
        lesserThanEquals: (_jp, _tp, cp, val) => `${cp} <= ${this.toSqlLiteral(val)}`,
        length: (jp, _tp, _cp, val) => `jsonb_array_length(${jp}) = ${this.toSqlLiteral(val)}`,
        lengthGreaterThan: (jp, _tp, _cp, val) => `jsonb_array_length(${jp}) > ${this.toSqlLiteral(val)}`,
        lengthGreaterThanEquals: (jp, _tp, _cp, val) => `jsonb_array_length(${jp}) >= ${this.toSqlLiteral(val)}`,
        lengthLesserThan: (jp, _tp, _cp, val) => `jsonb_array_length(${jp}) < ${this.toSqlLiteral(val)}`,
        lengthLesserThanEquals: (jp, _tp, _cp, val) => `jsonb_array_length(${jp}) <= ${this.toSqlLiteral(val)}`,
        includes: (jp, _tp, _cp, val, fieldKey) => {
            if (!Array.isArray(val)) {
                throw new Error(`"includes" must be an array for JSONB field "${fieldKey}"`);
            }
            return `${jp} @> ${this.toJsonbLiteral(val)}`;
        },
        isIncludedIn: (jp, _tp, _cp, val, fieldKey) => {
            if (!Array.isArray(val)) {
                throw new Error(`"isIncludedIn" must be an array for JSONB field "${fieldKey}"`);
            }
            return `${jp} <@ ${this.toJsonbLiteral(val)}`;
        },
        where: (jp, _tp, _cp, val, fieldKey, propMeta) => this.buildJsonbWhereCondition(jp, val, propMeta, fieldKey)
    };

    constructor(dataSource: ToDataSource) {
        super(dataSource);
    }

    // ── JSONB-aware "where" handler ─────────────────────────────

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected whereHandler(
        value: unknown,
        metadata: PropertyMetadata,
        nestedProperties: Record<string, PropertyMetadata> | undefined,
        entityClass: Newable<unknown>
    ): FindOperator<unknown> {
        if (metadata.type !== 'object' && metadata.type !== 'array') {
            return super.whereHandler(value, metadata, nestedProperties, entityClass);
        }

        if (metadata.type === 'array') {
            if (metadata.items.type !== 'object') {
                throw new Error('The "where" operator on an array field requires an array of objects.');
            }
            const itemMeta: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(metadata.items.cls());
            const innerSql: string = this.buildJsonbCondition(elemAlias, value as Where<Record<string, unknown>>, itemMeta);
            const sql: string = `EXISTS (SELECT 1 FROM jsonb_array_elements(${ALIAS}) AS ${elemAlias} WHERE ${innerSql})`;
            return Raw(alias => {
                const quotedAlias: string = alias.split('.').map(part => `"${part.replaceAll('"', '')}"`)
                    .join('.');
                return sql.replaceAll(ALIAS, quotedAlias);
            }) as FindOperator<unknown>;
        }

        // object property
        const nestedMeta: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(metadata.cls());
        const sql: string = this.buildJsonbCondition(ALIAS, value as Where<Record<string, unknown>>, nestedMeta);
        return Raw(alias => {
            const quotedAlias: string = alias.split('.').map(part => `"${part.replaceAll('"', '')}"`)
                .join('.');
            return sql.replaceAll(ALIAS, quotedAlias);
        }) as FindOperator<unknown>;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected buildRelationLengthRawOperator<T>(
        entityClass: Newable<T>,
        propertyName: string,
        metadata: RelationMetadata<BaseEntity>,
        lengthKey: string,
        value: number
    ): FindOperator<unknown> {
        const operator: string = this.lengthKeyToSqlOperator(lengthKey);

        if (metadata.type === Relation.ONE_TO_MANY) {
            const targetEntity: Newable<BaseEntity> = metadata.target();
            const targetMeta: EntityMetadata | undefined = MetadataUtilities.getEntityMetadata(targetEntity);
            if (!targetMeta) {
                throw new EntityMetadataMissingError(targetEntity, `used in ${entityClass.name}.${propertyName}`);
            }
            const targetProps: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(targetEntity);
            const inverseProp: PropertyMetadata | undefined = targetProps[metadata.inverseSide];
            if (inverseProp?.type !== Relation.MANY_TO_ONE) {
                throw new Error(`Could not find inverse many-to-one relation "${metadata.inverseSide}" on ${targetEntity.name}`);
            }
            const fkColumn: string | undefined = inverseProp.joinColumn;
            const rawSql: string = `(SELECT COUNT(*) FROM "${targetMeta.tableName}" `
                + `WHERE "${targetMeta.tableName}"."${fkColumn}" = $alias$) ${operator} ${value}`;
            return Raw(alias => rawSql.replaceAll('$alias$', alias));
        }

        // MANY_TO_MANY
        const ormRelation: ToRelationMetadata | undefined = this.typeOrmDataSource
            .getMetadata(entityClass)
            .findRelationWithPropertyPath(propertyName);
        if (ormRelation?.isManyToMany !== true || !ormRelation.junctionEntityMetadata) {
            throw new Error(`Could not resolve many-to-many relation metadata for ${entityClass.name}.${propertyName}`);
        }
        const junctionTable: string = ormRelation.junctionEntityMetadata.tableName;
        const ownFkColumn: string = ormRelation.junctionEntityMetadata.columns[0].databaseName;
        const rawSql: string = `(SELECT COUNT(*) FROM "${junctionTable}" `
            + `WHERE "${junctionTable}"."${ownFkColumn}" = $alias$) ${operator} ${value}`;
        return Raw(alias => rawSql.replaceAll('$alias$', alias));
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected buildRelationIncludesOperator<T>(
        entityClass: Newable<T>,
        propertyName: string,
        metadata: RelationMetadata<BaseEntity>,
        entities: BaseEntity[]
    ): FindOperator<unknown> {
        if (entities.length === 0) {
            return Raw(() => 'TRUE');
        }

        if (metadata.type === Relation.ONE_TO_MANY) {
            const targetEntity: Newable<BaseEntity> = metadata.target();
            const targetMeta: EntityMetadata | undefined = MetadataUtilities.getEntityMetadata(targetEntity);
            if (!targetMeta) {
                throw new EntityMetadataMissingError(targetEntity, `used in ${entityClass.name}.${propertyName}`);
            }
            const targetProps: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(targetEntity);
            const inverseProp: PropertyMetadata | undefined = targetProps[metadata.inverseSide];
            if (inverseProp?.type !== Relation.MANY_TO_ONE) {
                throw new Error(`Could not find inverse many-to-one relation "${metadata.inverseSide}" on ${targetEntity.name}`);
            }
            const fkColumn: string | undefined = inverseProp.joinColumn;
            const ids: string = entities.map(e => `'${e.id}'`).join(', ');
            const rawSql: string = `(SELECT COUNT(*) FROM "${targetMeta.tableName}" `
                + `WHERE "${targetMeta.tableName}"."${fkColumn}" = $alias$ `
                + `AND "${targetMeta.tableName}"."id" IN (${ids})) = ${entities.length}`;
            return Raw(alias => rawSql.replaceAll('$alias$', alias));
        }

        // MANY_TO_MANY
        const ormRelation: ToRelationMetadata | undefined = this.typeOrmDataSource
            .getMetadata(entityClass)
            .findRelationWithPropertyPath(propertyName);
        if (ormRelation?.isManyToMany !== true || !ormRelation.junctionEntityMetadata) {
            throw new Error(`Could not resolve many-to-many relation metadata for ${entityClass.name}.${propertyName}`);
        }
        const junctionTable: string = ormRelation.junctionEntityMetadata.tableName;
        const ownFkColumn: string = ormRelation.junctionEntityMetadata.columns[0].databaseName;
        const targetFkColumn: string = ormRelation.junctionEntityMetadata.columns[1].databaseName;
        const ids: string = entities.map(e => `'${e.id}'`).join(', ');
        const rawSql: string = `(SELECT COUNT(*) FROM "${junctionTable}" `
            + `WHERE "${junctionTable}"."${ownFkColumn}" = $alias$ `
            + `AND "${junctionTable}"."${targetFkColumn}" IN (${ids})) = ${entities.length}`;
        return Raw(alias => rawSql.replaceAll('$alias$', alias));
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected buildRelationIsIncludedInOperator<T>(
        entityClass: Newable<T>,
        propertyName: string,
        metadata: RelationMetadata<BaseEntity>,
        entities: BaseEntity[]
    ): FindOperator<unknown> {
        if (entities.length === 0) {
            return Raw(() => 'FALSE');
        }

        if (metadata.type === Relation.ONE_TO_MANY) {
            const targetEntity: Newable<BaseEntity> = metadata.target();
            const targetMeta: EntityMetadata | undefined = MetadataUtilities.getEntityMetadata(targetEntity);
            if (!targetMeta) {
                throw new EntityMetadataMissingError(targetEntity, `used in ${entityClass.name}.${propertyName}`);
            }
            const targetProps: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(targetEntity);
            const inverseProp: PropertyMetadata | undefined = targetProps[metadata.inverseSide];
            if (inverseProp?.type !== Relation.MANY_TO_ONE || !inverseProp.joinColumn) {
                throw new Error(`Could not find inverse many-to-one relation "${metadata.inverseSide}" on ${targetEntity.name}`);
            }
            const fkColumn: string = inverseProp.joinColumn;
            const ids: string = entities.map(e => `'${e.id}'`).join(', ');
            const rawSql: string = `NOT EXISTS (SELECT 1 FROM "${targetMeta.tableName}" `
                + `WHERE "${targetMeta.tableName}"."${fkColumn}" = $alias$ `
                + `AND "${targetMeta.tableName}"."id" NOT IN (${ids}))`;
            return Raw(alias => rawSql.replaceAll('$alias$', alias));
        }

        // MANY_TO_MANY
        const ormRelation: ToRelationMetadata | undefined = this.typeOrmDataSource
            .getMetadata(entityClass)
            .findRelationWithPropertyPath(propertyName);
        if (ormRelation?.isManyToMany !== true || !ormRelation.junctionEntityMetadata) {
            throw new Error(`Could not resolve many-to-many relation metadata for ${entityClass.name}.${propertyName}`);
        }
        const junctionTable: string = ormRelation.junctionEntityMetadata.tableName;
        const ownFkColumn: string = ormRelation.junctionEntityMetadata.columns[0].databaseName;
        const targetFkColumn: string = ormRelation.junctionEntityMetadata.columns[1].databaseName;
        const ids: string = entities.map(e => `'${e.id}'`).join(', ');
        const rawSql: string = `NOT EXISTS (SELECT 1 FROM "${junctionTable}" `
            + `WHERE "${junctionTable}"."${ownFkColumn}" = $alias$ `
            + `AND "${junctionTable}"."${targetFkColumn}" NOT IN (${ids}))`;
        return Raw(alias => rawSql.replaceAll('$alias$', alias));
    }

    // ── JSONB SQL generation (moved from PostgresDataSource) ────

    private buildJsonbCondition(
        jsonbAlias: string,
        whereFilter: Where<Record<string, unknown>>,
        propertyMetadataMap: Record<string, PropertyMetadata>
    ): string {
        if (Array.isArray(whereFilter)) {
            return '(' + whereFilter
                .map(f => `(${this.buildJsonbCondition(jsonbAlias, f, propertyMetadataMap)})`)
                .join(' OR ') + ')';
        }

        const andParts: string[] = [];
        for (const [key, filterValue] of Object.entries(whereFilter as Record<string, unknown>)) {
            const propMeta: PropertyMetadata = propertyMetadataMap[key];
            andParts.push(this.buildJsonbFieldCondition(jsonbAlias, key, filterValue, propMeta));
        }
        return andParts.length > 0 ? andParts.join(' AND ') : 'TRUE';
    }

    private buildJsonbWhereCondition(
        jsonPath: string,
        val: unknown,
        propMeta: PropertyMetadata | undefined,
        fieldKey: string
    ): string {
        if (propMeta?.type === 'object') {
            return this.buildJsonbCondition(
                jsonPath,
                val as Where<Record<string, unknown>>,
                MetadataUtilities.getModelProperties(propMeta.cls())
            );
        }
        if (propMeta?.type === 'array') {
            if (propMeta.items.type !== 'object') {
                throw new Error(`"where" on array field "${fieldKey}" requires object items`);
            }
            const itemMeta: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(propMeta.items.cls());
            const elemAlias: string = `elem_${fieldKey}`;
            return `EXISTS (SELECT 1 FROM jsonb_array_elements(${jsonPath}) AS ${elemAlias} WHERE `
                + this.buildJsonbCondition(elemAlias, val as Where<Record<string, unknown>>, itemMeta) + ')';
        }
        throw new Error(`"where" operator used on a non-object, non-array JSONB field "${fieldKey}"`);
    }

    private buildJsonbFieldCondition(
        jsonbAlias: string,
        fieldKey: string,
        filterValue: unknown,
        propMeta: PropertyMetadata | undefined
    ): string {
        // Guard against relations inside JSONB
        if (propMeta && (
            propMeta.type === Relation.HAS_ONE
            || propMeta.type === Relation.BELONGS_TO_ONE
            || propMeta.type === Relation.MANY_TO_ONE
            || propMeta.type === Relation.ONE_TO_MANY
            || propMeta.type === Relation.MANY_TO_MANY
        )) {
            throw new Error(`Cannot filter on relation "${fieldKey}" inside a JSONB column. `
                + 'Relations are not supported as part of embedded JSON objects/arrays.');
        }

        const jsonPath: string = `${jsonbAlias}->'${fieldKey}'`;
        const textPath: string = `${jsonbAlias}->>'${fieldKey}'`;
        const cast: string = this.getJsonbCast(propMeta);
        const castPath: string = `(${textPath})${cast}`;

        if (filterValue === null) {
            return `${jsonPath} = 'null'::jsonb`;
        }

        if (typeof filterValue === 'string' || typeof filterValue === 'number'
            || typeof filterValue === 'boolean' || filterValue instanceof Date) {
            return `${castPath} = ${this.toSqlLiteral(filterValue)}`;
        }

        if (Array.isArray(filterValue)) {
            // exact array match
            const literal: string = this.toJsonbLiteral(filterValue);
            return `(${jsonPath} @> ${literal} AND ${jsonPath} <@ ${literal})`;
        }

        if (typeof filterValue !== 'object') {
            throw new Error(`Unexpected JSONB filter value for field "${fieldKey}": ${JSON.stringify(filterValue)}`);
        }

        return this.buildJsonbOperatorCondition(filterValue, jsonPath, castPath, fieldKey, textPath, propMeta);
    }

    private buildJsonbOperatorCondition(
        filterValue: object,
        jsonPath: string,
        castPath: string,
        fieldKey: string,
        textPath: string,
        propMeta: PropertyMetadata | undefined
    ): string {
        const filterObj: Record<string, unknown> = filterValue as Record<string, unknown>;
        const conditions: string[] = [];

        for (const [op, val] of Object.entries(filterObj)) {
            const handler: JsonbOperatorHandler | undefined = this.jsonbOperatorHandlers[op as WhereFilterKeys];
            if (handler == undefined) {
                throw new Error(`Unknown JSONB filter operator "${op}" on field "${fieldKey}"`);
            }
            conditions.push(handler(jsonPath, textPath, castPath, val, fieldKey, propMeta));
        }

        return conditions.length > 0 ? conditions.join(' AND ') : 'TRUE';
    }

    private toSqlLiteral(val: unknown): string {
        if (val === null) {
            return 'NULL';
        }
        if (typeof val === 'boolean') {
            return val ? 'TRUE' : 'FALSE';
        }
        if (typeof val === 'number') {
            return String(val);
        }
        if (val instanceof Date) {
            return `'${val.toISOString()}'`;
        }
        if (typeof val === 'string') {
            return `'${val.replaceAll('\'', '\'\'')}'`;
        }
        throw new Error(`Cannot convert value of type "${typeof val}" to a SQL literal`);
    }

    private toJsonbLiteral(val: object): string {
        return `'${JSON.stringify(val).replaceAll('\'', '\'\'')}'::jsonb`;
    }

    private getJsonbCast(propMeta: PropertyMetadata | undefined): string {
        if (!propMeta) {
            return '';
        }
        switch (propMeta.type) {
            case 'number': {
                return '::numeric';
            }
            case 'date': {
                return '::timestamptz';
            }
            case 'boolean': {
                return '::boolean';
            }
            case 'string':
            case 'object':
            case Relation.HAS_ONE:
            case Relation.BELONGS_TO_ONE:
            case Relation.ONE_TO_MANY:
            case Relation.MANY_TO_ONE:
            case Relation.MANY_TO_MANY:
            case 'array':
            case 'file':
            case 'unknown': {
                return '';
            }
        }
    }

    private lengthKeyToSqlOperator(lengthKey: string): string {
        switch (lengthKey) {
            case 'length': {
                return '=';
            }
            case 'lengthGreaterThan': {
                return '>';
            }
            case 'lengthGreaterThanEquals': {
                return '>=';
            }
            case 'lengthLesserThan': {
                return '<';
            }
            case 'lengthLesserThanEquals': {
                return '<=';
            }
            default: {
                throw new Error(`Unknown length filter key: ${lengthKey}`);
            }
        }
    }
}