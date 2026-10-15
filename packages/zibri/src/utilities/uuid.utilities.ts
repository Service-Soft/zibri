import { randomUUID } from 'node:crypto';

import { MetadataUtilities } from './metadata.utilities';
import { BaseEntity } from '../entity/base-entity.model';
import { PropertyMetadata, RelationMetadata } from '../entity/decorators/property.decorator';
import { Relation } from '../entity/models/relation.enum';
import { Newable } from '../types/newable.type';

/**
 * Any string a store that types its columns as uuid is able to hold.
 *
 * Deliberately looser than the rfc: the version and variant digits are not pinned. This answers
 * whether a stored value could look like this, and a value that was written is a value that can be
 * read back regardless of which version produced it.
 */
const uuidShape: RegExp = /^[\dA-Fa-f]{8}(?:-[\dA-Fa-f]{4}){3}-[\dA-Fa-f]{12}$/;

/**
 * Utilities for dealing with uuid.
 */
export abstract class UUIDUtilities {
    /**
     * Generate a new uuid.
     * @returns A v4 uuid string.
     */
    static generate(): string {
        return randomUUID();
    }

    /**
     * Whether the given value has the shape of a uuid.
     *
     * Answers what a store could be holding, not what an api accepts - the validation applied to an
     * incoming `format: 'uuid'` value is stricter, because refusing an unusual uuid at the edge only
     * costs a request, while failing to recognize one here would report a row that exists as absent.
     * @param value - The value to check.
     * @returns True if a uuid could be written exactly like this, false otherwise.
     */
    static isUuid(value: string): boolean {
        return uuidShape.test(value);
    }

    /**
     * Whether the given property holds uuids and nothing else.
     * @param property - The metadata of a property, if the entity has one by that name.
     * @returns True when every value it can hold is a uuid.
     */
    static declaresUuidFormat(property: PropertyMetadata | undefined): boolean {
        return property?.type === 'string' && property.format === 'uuid';
    }

    /**
     * The given value in the form every data source stores a uuid in, which is lower case.
     * @param value - A value given for a property that holds uuids.
     * @returns The value in lower case when it is a string, otherwise the value as it is.
     */
    static resolveCanonical(value: unknown): unknown {
        return typeof value === 'string' ? value.toLowerCase() : value;
    }

    /**
     * The entries of write data that change once its uuids are in the form every data source stores
     * them in, including those of the related rows it names.
     * @param data - The data being written for the given entity.
     * @param entityClass - The entity the data is written to.
     * @returns The changed entries, to assign over the data. A related row that changes is a copy, so
     * nothing the caller holds is changed.
     */
    static resolveCanonicalChanges(data: object, entityClass: Newable<BaseEntity>): Record<string, unknown> {
        return this.resolveCanonicalChangesOf(data, entityClass, new Set());
    }

    // a uuid names a value, not a spelling. A store that types the column as uuid compares an upper
    // and a lower case one as equal and hands back lower case, one that keeps strings compares the
    // spelling - so everything written and everything asked for is lower case, and both answer alike
    private static resolveCanonicalChangesOf(
        data: object,
        entityClass: Newable<BaseEntity>,
        seen: Set<object>
    ): Record<string, unknown> {
        // a graph of loaded rows can point back at itself, and each row only needs visiting once
        seen.add(data);
        const properties: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(entityClass);
        const entries: [string, unknown][] = Object.entries(data);
        const res: Record<string, unknown> = {};
        for (const [key, value] of entries) {
            const metadata: PropertyMetadata | undefined = properties[key];
            const canonical: unknown = this.isRelation(metadata)
                ? this.resolveCanonicalRelated(value, metadata.target(), seen)
                : this.declaresUuidFormat(metadata) ? this.resolveCanonical(value) : value;
            if (canonical !== value) {
                res[key] = canonical;
            }
        }
        return res;
    }

    private static resolveCanonicalRelated(value: unknown, target: Newable<BaseEntity>, seen: Set<object>): unknown {
        if (Array.isArray(value)) {
            const members: unknown[] = value.map(member => this.resolveCanonicalRelated(member, target, seen));
            return members.some((member, i) => member !== value[i]) ? members : value;
        }
        if (typeof value === 'string') {
            // a relation may be named by the id of the row alone
            const idProperty: PropertyMetadata | undefined = MetadataUtilities.getModelProperties(target)['id'];
            return this.declaresUuidFormat(idProperty) ? this.resolveCanonical(value) : value;
        }
        if (typeof value !== 'object' || value == undefined || seen.has(value)) {
            return value;
        }
        const changes: Record<string, unknown> = this.resolveCanonicalChangesOf(value, target, seen);
        return Object.keys(changes).length ? { ...value, ...changes } : value;
    }

    private static isRelation(metadata: PropertyMetadata | undefined): metadata is RelationMetadata<BaseEntity> {
        return metadata?.type === Relation.HAS_ONE
            || metadata?.type === Relation.BELONGS_TO_ONE
            || metadata?.type === Relation.MANY_TO_ONE
            || metadata?.type === Relation.ONE_TO_MANY
            || metadata?.type === Relation.MANY_TO_MANY;
    }
}