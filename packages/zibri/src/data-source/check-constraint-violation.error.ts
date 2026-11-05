import { type UniqueConstraintViolationError } from './unique-constraint-violation.error';
import { PropertyReferenceUtilities } from './where/property-reference.utilities';
import { HttpRequestContext } from '../context/request/http-request.context';
import { WebsocketRequestContext } from '../context/request/websocket-request.context';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { BaseEntity } from '../entity/base-entity.model';
import { EntityCheck } from '../entity/models/entity-check.model';
import { KeyWhere } from '../entity/models/unique-declaration.model';
import { BadRequestError } from '../error-handling/errors/bad-request.error';
import { ValidationProblemCode } from '../error-handling/validation-problem-code.enum';
import { LocaleCode } from '../localization/models/locale-code.model';
import { $t, $ts } from '../localization/translate.function';
import { Newable } from '../types/newable.type';
import { JsonUtilities } from '../utilities/json.utilities';
import { MetadataUtilities } from '../utilities/metadata.utilities';
import { type ValidationProblem } from '../validation/validation-problem.model';

/**
 * An error for a write that a check of its entity refuses.
 *
 * One error for every store, for the reason {@link UniqueConstraintViolationError} is one: the check
 * is declared on the entity, so whoever reacts to it must not have to know which store refused it.
 *
 * Over http it answers 400 with the check as its one problem, under the key `body`: a row breaking a
 * rule of its entity is the caller's to change.
 */
export class CheckConstraintViolationError extends BadRequestError {

    /**
     * The properties the check names.
     */
    readonly properties: string[];

    /**
     * The code of the check, `check` for one declared as its filter alone.
     */
    readonly code: string;

    /**
     * The check as a problem of the request: its code and its message, in the language of the request.
     */
    readonly problems: ValidationProblem[];

    constructor(entityClass: Newable<BaseEntity>, check: KeyWhere, options?: ErrorOptions) {
        const properties: string[] = CheckConstraintViolationError.resolveProperties(check);
        const entityName: string = entityClass.name;
        super($ts`The ${entityName} breaks the check on "${properties.join(', ')}".`, options);
        this.name = 'CheckConstraintViolationError';
        this.properties = properties;

        const declared: EntityCheck = CheckConstraintViolationError.findDeclaredCheck(entityClass, check)
            ?? CheckConstraintViolationError.resolveFilterCheck(check);
        const context: HttpRequestContext | WebsocketRequestContext | undefined = inject(ZIBRI_DI_TOKENS.CURRENT_REQUEST_CONTEXT);
        const locale: LocaleCode = inject(ZIBRI_DI_TOKENS.LOCALIZE_SERVICE).resolveSupportedLocale(context);
        this.code = declared.code;
        // under the key a check of the body as a whole is answered with by the validation, as the
        // store cannot tell which object of the request the row was written from
        this.problems = [{ key: 'body', code: declared.code, message: declared.message.getValue(locale) }];
    }

    /**
     * Resolves the properties a check names, in the order its branches first name them: each one it
     * compares, followed by the ones it compares that one with.
     * @param check - The check.
     * @returns The properties.
     */
    static resolveProperties(check: KeyWhere): string[] {
        const branches: object[] = Array.isArray(check) ? check : [check];
        return [
            ...new Set(branches.flatMap(branch => Object.entries(branch).flatMap(
                ([key, condition]) => [key, ...PropertyReferenceUtilities.resolveReferenced(condition)]
            )))
        ];
    }

    /**
     * Writes out a check declared as its filter alone.
     * @param where - The filter.
     * @returns The check, answered with the code `check` and a message naming what it compares.
     */
    static resolveFilterCheck(where: KeyWhere): EntityCheck {
        const properties: string = CheckConstraintViolationError.resolveProperties(where).join(', ');
        return { where, code: ValidationProblemCode.CHECK, message: $t`breaks the check on "${properties}"` };
    }

    /**
     * Finds the check an entity declares with the given filter.
     * @param entityClass - The entity.
     * @param where - The filter, as the store handed it back.
     * @returns The check, or undefined for a filter the entity does not declare.
     */
    private static findDeclaredCheck(entityClass: Newable<BaseEntity>, where: KeyWhere): EntityCheck | undefined {
        const checks: EntityCheck[] = MetadataUtilities.getEntityMetadata(entityClass)?.checks ?? [];
        // by its json as well, because a store keeping its checks hands back a copy read from it - and a
        // newer release beside this one may have listed a check this one does not declare
        const json: string = JsonUtilities.stringify(where);
        return checks.find(check => check.where === where) ?? checks.find(check => JsonUtilities.stringify(check.where) === json);
    }
}