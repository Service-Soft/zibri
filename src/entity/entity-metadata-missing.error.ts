import { BaseEntity } from './base-entity.model';
import { Newable } from '../types/newable.type';

/**
 * An error that gets thrown when entity metadata that is required is missing.
 */
export class EntityMetadataMissingError extends Error {
    constructor(entity: Newable<BaseEntity>, usage: string = '') {
        super([
            `Could not find entity metadata for ${entity.name} ${usage}`,
            'Did you forget to decorate it with @Entity?'
        ].join('\n'));
        this.name = 'EntityMetadataMissingError';
    }
}