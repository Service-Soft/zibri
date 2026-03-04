import { PropertyMetadata } from '../../entity/decorators/property.decorator';
import { NumberPropertyMetadata } from '../../entity/models/number-property-metadata.model';
import { QueryParamMetadata, HeaderParamMetadata, PathParamMetadata } from '../../routing/decorators/param.decorator';
import { NumberParamMetadata } from '../../routing/models/number-param-metadata.model';
import { ObjectUtilities } from '../../utilities/object.utilities';
import { IsRequiredValidationProblem, TypeMismatchValidationProblem, ValidationProblem } from '../validation-problem.model';

/**
 * Validates the given number property.
 * @param key - The key of the property.
 * @param property - The actual value.
 * @param metadata - The metadata of the property.
 * @param parentKey - The key of the parent, if it exists.
 * @param entity - The entity that this value belongs to.
 * @returns All validation problems found.
 */
export function validateNumber(
    key: string,
    property: unknown,
    metadata: PropertyMetadata | QueryParamMetadata | HeaderParamMetadata | PathParamMetadata,
    parentKey: string | undefined,
    entity: unknown | undefined
): ValidationProblem[] {
    const meta: NumberPropertyMetadata | NumberParamMetadata = metadata as NumberPropertyMetadata | NumberParamMetadata;
    const fullKey: string = parentKey ? `${parentKey}.${key}` : key;
    if (
        property == undefined
        && (meta as NumberPropertyMetadata).default == undefined
        && (typeof metadata.required === 'boolean' ? metadata.required : metadata.required(entity))
    ) {
        return [new IsRequiredValidationProblem(fullKey)];
    }
    if (
        property == undefined
        && (
            !(typeof metadata.required === 'boolean' ? metadata.required : metadata.required(entity))
            || (meta as NumberPropertyMetadata).default != undefined
        )
    ) {
        return [];
    }
    if (typeof property !== 'number') {
        return [new TypeMismatchValidationProblem(fullKey, 'number')];
    }
    if (meta.enum && !ObjectUtilities.values(meta.enum).includes(property)) {
        return [{ key: fullKey, message: `needs to match one of "${ObjectUtilities.values(meta.enum)}"` }];
    }
    if (meta.min != undefined && property < meta.min) {
        return [{ key: fullKey, message: `needs to be at least ${meta.min}` }];
    }
    if (meta.max != undefined && property > meta.max) {
        return [{ key: fullKey, message: `needs to be at most ${meta.max}` }];
    }
    return [];
}