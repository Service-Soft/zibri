import { HttpRequestContext } from '../../context/request/http-request.context';
import { WebsocketRequestContext } from '../../context/request/websocket-request.context';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { PropertyMetadata } from '../../entity/decorators/property.decorator';
import { BooleanPropertyMetadata } from '../../entity/models/boolean-property-metadata.model';
import { QueryParamMetadata, HeaderParamMetadata, PathParamMetadata } from '../../routing/decorators/param.decorator';
import { BooleanParamMetadata } from '../../routing/models/boolean-param-metadata.model';
import { IsRequiredValidationProblem, TypeMismatchValidationProblem, ValidationProblem } from '../validation-problem.model';

/**
 * Validates the given boolean property.
 * @param key - The key of the property.
 * @param property - The actual value.
 * @param metadata - The metadata of the property.
 * @param parentKey - The key of the parent, if it exists.
 * @param entity - The entity that the value belongs to.
 * @returns All validation problems found.
 */
export async function validateBoolean(
    key: string,
    property: unknown,
    metadata: PropertyMetadata | QueryParamMetadata | HeaderParamMetadata | PathParamMetadata,
    parentKey: string | undefined,
    entity: unknown | undefined
): Promise<ValidationProblem[]> {
    const meta: BooleanPropertyMetadata | BooleanParamMetadata = metadata as BooleanPropertyMetadata | BooleanParamMetadata;
    const fullKey: string = parentKey ? `${parentKey}.${key}` : key;
    if (property == undefined) {
        const context: HttpRequestContext | WebsocketRequestContext | undefined = inject(ZIBRI_DI_TOKENS.CURRENT_REQUEST_CONTEXT);
        const isRequired: boolean = typeof metadata.required === 'boolean' ? metadata.required : await metadata.required(entity, context);
        if ((meta as BooleanPropertyMetadata).default == undefined && isRequired) {
            return [new IsRequiredValidationProblem(fullKey)];
        }
        if (!isRequired || (meta as BooleanPropertyMetadata).default != undefined) {
            return [];
        }
    }
    if (typeof property !== 'boolean') {
        return [new TypeMismatchValidationProblem(fullKey, 'boolean')];
    }
    return [];
}