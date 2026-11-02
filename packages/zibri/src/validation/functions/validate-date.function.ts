import { HttpRequestContext } from '../../context/request/http-request.context';
import { WebsocketRequestContext } from '../../context/request/websocket-request.context';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { PropertyMetadata } from '../../entity/decorators/property.decorator';
import { DatePropertyMetadata } from '../../entity/models/date-property-metadata.model';
import { ValidationProblemCode } from '../../error-handling/validation-problem-code.enum';
import { $f } from '../../localization/format.function';
import { $ts } from '../../localization/translate.function';
import { QueryParamMetadata, HeaderParamMetadata, PathParamMetadata } from '../../routing/decorators/param.decorator';
import { DateParamMetadata } from '../../routing/models/date-param-metadata.model';
import { IsRequiredValidationProblem, TypeMismatchValidationProblem, ValidationProblem } from '../validation-problem.model';

/**
 * Validates the given date property.
 * @param key - The key of the property.
 * @param property - The actual value.
 * @param metadata - The metadata of the property.
 * @param parentKey - The key of the parent, if it exists.
 * @param entity - The entity that this value belongs to.
 * @returns All validation problems found.
 */
export async function validateDate(
    key: string,
    property: unknown,
    metadata: PropertyMetadata | QueryParamMetadata | HeaderParamMetadata | PathParamMetadata,
    parentKey: string | undefined,
    entity: unknown | undefined
): Promise<ValidationProblem[]> {
    const meta: DatePropertyMetadata | DateParamMetadata = metadata as DatePropertyMetadata | DateParamMetadata;
    const fullKey: string = parentKey ? `${parentKey}.${key}` : key;
    const context: HttpRequestContext | WebsocketRequestContext | undefined = inject(ZIBRI_DI_TOKENS.CURRENT_REQUEST_CONTEXT);
    if (property == undefined) {
        const isRequired: boolean = typeof metadata.required === 'boolean' ? metadata.required : await metadata.required(entity, context);
        if ((meta as DatePropertyMetadata).default == undefined && isRequired) {
            return [new IsRequiredValidationProblem(fullKey)];
        }
        if (!isRequired || (meta as DatePropertyMetadata).default != undefined) {
            return [];
        }
    }
    const problems: ValidationProblem[] = dateValueProblems(fullKey, property);
    return problems.length || !(property instanceof Date) ? problems : dateBoundProblems(fullKey, property, meta, entity, context);
}

/**
 * The problems of a date value, judged by the value alone.
 *
 * Everything about a date except whether it may be left out and its bounds, which can depend on the
 * request and on the object the date is on. What decides which of several shapes a value is uses
 * exactly this, so it cannot disagree with validation about any rule it looks at.
 * @param fullKey - The key the problems are reported under.
 * @param property - The value.
 * @returns All validation problems found.
 */
export function dateValueProblems(fullKey: string, property: unknown): ValidationProblem[] {
    return !(property instanceof Date) ? [new TypeMismatchValidationProblem(fullKey, 'date')] : [];
}

/**
 * The problems of a date with the bounds of its property, which are asked for each value.
 * @param fullKey - The key the problems are reported under.
 * @param property - The date.
 * @param meta - What the date is declared as.
 * @param entity - The object the date is on.
 * @param context - The current request.
 * @returns All validation problems found.
 */
function dateBoundProblems(
    fullKey: string,
    property: Date,
    meta: DatePropertyMetadata | DateParamMetadata,
    entity: unknown,
    context: HttpRequestContext | WebsocketRequestContext | undefined
): ValidationProblem[] {
    const before: Date | undefined = meta.before?.(entity, context);
    if (before != undefined && property.getTime() >= before.getTime()) {
        return [{ key: fullKey, code: ValidationProblemCode.BEFORE, message: $ts`should be before "${$f.dateTime(before)}"` }];
    }
    const after: Date | undefined = meta.after?.(entity, context);
    return after != undefined && property.getTime() <= after.getTime()
        ? [{ key: fullKey, code: ValidationProblemCode.AFTER, message: $ts`should be after "${$f.dateTime(after)}"` }]
        : [];
}