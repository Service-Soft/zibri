import { Relation } from './relation.enum';
import { type BaseEntity } from '../base-entity.model';
import { type PropertyMetadata, type RelationMetadata } from '../decorators/property.decorator';

/**
 * Every kind of relation, as the `type` its metadata carries.
 */
const RELATION_TYPES: Set<string> = new Set(Object.values(Relation));

/**
 * Checks whether a property's metadata declares a relation to another entity.
 * @param metadata - The metadata to check.
 * @returns True if it is the metadata of a relation.
 */
export function isRelationMetadata(metadata: PropertyMetadata | undefined): metadata is RelationMetadata<BaseEntity> {
    return metadata != undefined && RELATION_TYPES.has(metadata.type);
}