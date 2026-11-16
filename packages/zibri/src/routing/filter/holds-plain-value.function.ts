import { PropertyMetadata } from '../../entity/decorators/property.decorator';
import { isRelationMetadata } from '../../entity/models/is-relation-metadata.function';

/**
 * Whether a property holds its value as it is, which a list may be filtered and ordered by: not left out of
 * responses, not encrypted, hashed or a password, and no relation.
 * @param metadata - The metadata of the property.
 * @returns True when filtering or ordering by it gives nothing away.
 */
// a filter or an order a caller chooses tells them something about the values of every row, one guess at a time:
// a property they may not read, or one stored as a secret, would leak through it.
export function holdsPlainValue(metadata: PropertyMetadata): boolean {
    const isHidden: boolean = isRelationMetadata(metadata) || metadata.exclude !== false;
    const isSecret: boolean = metadata.type === 'string' && (metadata.encryption !== false || metadata.hash !== false || metadata.password);
    return !isHidden && !isSecret;
}