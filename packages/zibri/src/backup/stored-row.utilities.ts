import { BaseEntity } from '../entity/base-entity.model';
import { PropertyMetadata } from '../entity/decorators/property.decorator';
import { isRelationMetadata } from '../entity/models/is-relation-metadata.function';
import { parseObject } from '../parsing/functions/parse-object.function';
import { Newable } from '../types/newable.type';
import { MetadataUtilities } from '../utilities/metadata.utilities';
import { ObjectUtilities } from '../utilities/object.utilities';

/**
 * Encodes how a relation of a row is written, or says it is left out with undefined.
 */
export type StoredRelationEncoder = (key: string, value: unknown) => unknown;

/**
 * A row as stored, written as a line of JSON and read back into what it was stored as: every column as
 * JSON, a file as base64.
 */
export abstract class StoredRowUtilities {
    /**
     * A row as a line holds it, in the order the row holds its values.
     * @param entityClass - The entity.
     * @param row - The row as stored.
     * @param encodeRelation - How a relation is written, or nothing to leave every relation out.
     * @returns What the line holds.
     */
    static encode(entityClass: Newable<BaseEntity>, row: BaseEntity, encodeRelation?: StoredRelationEncoder): Record<string, unknown> {
        const properties: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(entityClass);
        const encoded: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(row)) {
            const property: PropertyMetadata | undefined = properties[key];
            if (property == undefined) {
                continue;
            }
            if (isRelationMetadata(property)) {
                const related: unknown = encodeRelation?.(key, value);
                if (related !== undefined) {
                    encoded[key] = related;
                }
                continue;
            }
            encoded[key] = property.type === 'file' && Buffer.isBuffer(value) ? value.toString('base64') : value;
        }
        return encoded;
    }

    /**
     * A row as a line holds it, read back into what it was stored as.
     * @param entityClass - The entity.
     * @param encoded - What the line holds.
     * @returns The row, which the caller checks for what it needs, such as an id.
     */
    static decode(entityClass: Newable<BaseEntity>, encoded: Record<string, unknown>): unknown {
        const parsed: unknown = parseObject({ ...encoded }, entityClass);
        if (typeof parsed !== 'object' || parsed == undefined) {
            return parsed;
        }
        for (const [key, property] of ObjectUtilities.entries(MetadataUtilities.getModelProperties(entityClass))) {
            const value: unknown = Reflect.get(parsed, key);
            if (property.type === 'file' && typeof value === 'string') {
                Reflect.set(parsed, key, Buffer.from(value, 'base64'));
            }
        }
        return parsed;
    }
}