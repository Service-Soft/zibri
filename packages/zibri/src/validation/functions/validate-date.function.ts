import { HttpRequestContext } from '../../context/request/http-request.context';
import { WebsocketRequestContext } from '../../context/request/websocket-request.context';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { PropertyMetadata } from '../../entity/decorators/property.decorator';
import { DatePropertyMetadata } from '../../entity/models/date-property-metadata.model';
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
    if (property == undefined) {
        const context: HttpRequestContext | WebsocketRequestContext | undefined = inject(ZIBRI_DI_TOKENS.CURRENT_REQUEST_CONTEXT);
        const isRequired: boolean = typeof metadata.required === 'boolean' ? metadata.required : await metadata.required(entity, context);
        if ((meta as DatePropertyMetadata).default == undefined && isRequired) {
            return [new IsRequiredValidationProblem(fullKey)];
        }
        if (!isRequired || (meta as DatePropertyMetadata).default != undefined) {
            return [];
        }
    }
    if (!(property instanceof Date)) {
        return [new TypeMismatchValidationProblem(fullKey, 'date')];
    }
    if (meta.before != undefined && new Date(property).getTime() >= meta.before.getTime()) {
        return [{ key: fullKey, message: $ts`should be before "${$f.dateTime(meta.before)}"` }];
    }
    if (meta.after != undefined && new Date(property).getTime() <= meta.after.getTime()) {
        return [{ key: fullKey, message: $ts`should be after "${$f.dateTime(meta.after)}"` }];
    }
    return [];
}