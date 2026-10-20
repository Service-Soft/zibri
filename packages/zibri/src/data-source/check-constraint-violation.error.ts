import { KeyWhere } from '../entity/models/unique-declaration.model.ts';
import { BadRequestError } from '../error-handling/errors/bad-request.error.ts';
import { $ts } from '../localization/translate.function.ts';

/**
 * An error for a write that a check of its entity refuses.
 *
 * One error for every store, for the reason {@link UniqueConstraintViolationError} is one: the check
 * is declared on the entity, so whoever reacts to it must not have to know which store refused it.
 *
 * Over http it answers 400: a row breaking a rule of its entity is the caller's to change.
 */
export class CheckConstraintViolationError extends BadRequestError {

    /**
     * The properties the check names.
     */
    readonly properties: string[];

    constructor(entityName: string, check: KeyWhere, options?: ErrorOptions) {
        const properties: string[] = CheckConstraintViolationError.resolveProperties(check);
        super($ts`The ${entityName} breaks the check on "${properties.join(', ')}".`, options);
        this.name = 'CheckConstraintViolationError';
        this.properties = properties;
    }

    /**
     * Resolves the properties a check names, in the order its branches first name them.
     * @param check - The check.
     * @returns The properties.
     */
    static resolveProperties(check: KeyWhere): string[] {
        const branches: object[] = Array.isArray(check) ? check : [check];
        return [...new Set(branches.flatMap(branch => Object.keys(branch)))];
    }
}