import { createHmac } from 'node:crypto';

import { type BaseChainedEntity } from './base-chained-entity.model';
import { BaseEntity } from '../../entity/base-entity.model';
import { type PropertyMetadata } from '../../entity/decorators/property.decorator';
import { isRelationMetadata } from '../../entity/models/is-relation-metadata.function';
import { InternalError } from '../../error-handling/internal-error.model';
import { Newable } from '../../types/newable.type';
import { JsonUtilities } from '../../utilities/json.utilities';
import { MetadataUtilities } from '../../utilities/metadata.utilities';

/**
 * Hashes the rows of chained entities, and single rows that carry a keyed hash of their own.
 */
export class ChainUtilities {
    /**
     * Resolves the hash a row is linked to its chain with.
     *
     * Over the table, the chain and the row's place in it as well as its content, so a row copied
     * into another table, another chain or another place does not hold there.
     * @param key - The signing key of the chains.
     * @param entityClass - The chained entity.
     * @param chain - The tenant of the chain, or an empty string for the rows of no tenant.
     * @param previousHash - The hash of the row before it, or of the anchor, or an empty string for the first row.
     * @param row - The row, with its place in the chain.
     * @returns The hash.
     */
    static resolveRowHash(key: Buffer, entityClass: Newable<BaseEntity>, chain: string, previousHash: string, row: object): string {
        return this.resolveMac(
            key,
            ['row', this.getTableName(entityClass), chain, previousHash, this.resolveContent(entityClass, row, 'chainHash')]
        );
    }

    /**
     * Resolves the keyed hash of one row on its own, over its table and its content, which only the
     * holder of the key can write for a row.
     * @param key - The signing key.
     * @param entityClass - The entity of the row.
     * @param row - The row.
     * @param macProperty - The property the hash is kept in, which it does not cover.
     * @returns The hash.
     */
    static resolveRowMac(key: Buffer, entityClass: Newable<BaseEntity>, row: object, macProperty: string): string {
        return this.resolveMac(key, ['mac', this.getTableName(entityClass), this.resolveContent(entityClass, row, macProperty)]);
    }

    /**
     * Resolves the seal of an anchor, which only the holder of the key can write.
     * @param key - The signing key of the chains.
     * @param entityClass - The chained entity.
     * @param chain - The tenant of the chain, or an empty string for the rows of no tenant.
     * @param sequence - The place of the last row removed.
     * @param hash - The hash of the last row removed.
     * @returns The seal.
     */
    static resolveAnchorSeal(key: Buffer, entityClass: Newable<BaseEntity>, chain: string, sequence: number, hash: string): string {
        return this.resolveMac(key, ['anchor', this.getTableName(entityClass), chain, sequence, hash]);
    }

    /**
     * Whether an entity is declared with `chained: true`, which also says it extends `BaseChainedEntity`.
     * @param entityClass - The entity.
     * @returns True when its rows are chained.
     */
    static isChained(entityClass: Newable<BaseEntity>): entityClass is Newable<BaseChainedEntity> {
        return MetadataUtilities.getEntityMetadata(entityClass)?.chained === true;
    }

    /**
     * The table of an entity, which its hashes and anchors name.
     * @param entityClass - The entity.
     * @returns Its table.
     * @throws When the class is no entity.
     */
    static getTableName(entityClass: Newable<BaseEntity>): string {
        const tableName: string | undefined = MetadataUtilities.getEntityMetadata(entityClass)?.tableName;
        if (tableName == undefined) {
            throw new InternalError(`"${entityClass.name}" is no entity.`);
        }
        return tableName;
    }

    /**
     * Writes what a row holds as one text that is the same however the store hands it back: its
     * columns in the order of their names, a value it holds none for as null, and a date as its ISO
     * form. Everything but the hash itself, the id, which a store may assign, and the relations,
     * which are rows of their own.
     * @param entityClass - The entity of the row.
     * @param row - The row.
     * @param hashProperty - The property the hash is kept in.
     * @returns The text.
     */
    private static resolveContent(entityClass: Newable<BaseEntity>, row: object, hashProperty: string): string {
        const properties: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(entityClass);
        const columns: string[] = Object.keys(properties)
            .filter(key => key !== 'id' && key !== hashProperty && !isRelationMetadata(properties[key]))
            .sort();
        return JsonUtilities.stringify(columns.map(column => [column, this.normalize(Reflect.get(row, column))]));
    }

    /**
     * A value as the content of a row holds it.
     * @param value - The value.
     * @returns The value, with no value as null, a date as its ISO form and an object's keys in order.
     */
    private static normalize(value: unknown): unknown {
        if (value == undefined) {
            // eslint-disable-next-line unicorn/no-null
            return null;
        }
        if (value instanceof Date) {
            return value.toISOString();
        }
        if (Array.isArray(value)) {
            return value.map(item => this.normalize(item));
        }
        if (typeof value === 'object' && value.constructor === Object) {
            return Object.keys(value).sort()
                .map(key => [key, this.normalize(Reflect.get(value, key))]);
        }
        return value;
    }

    private static resolveMac(key: Buffer, parts: unknown[]): string {
        return createHmac('sha256', key).update(JsonUtilities.stringify(parts))
            .digest('base64url');
    }
}