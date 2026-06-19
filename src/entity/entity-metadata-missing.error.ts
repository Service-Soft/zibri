import { BaseEntity } from './base-entity.model';
import { InternalError } from '../error-handling/internal-error.model';
import { Newable } from '../types/newable.type';

/**
 * An error that gets thrown when entity metadata that is required is missing.
 */
export class EntityMetadataMissingError extends InternalError {
    constructor(entity: Newable<BaseEntity>, usage: string = '', options?: ErrorOptions) {
        super([
            `Could not find entity metadata for ${entity.name} ${usage}`,
            'Did you forget to decorate it with @Entity?'
        ], options);
        this.name = 'EntityMetadataMissingError';
    }
}