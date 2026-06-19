import assert from 'node:assert';

import { HttpRequestContext } from '../../context/request/http-request.context';
import { WebsocketRequestContext } from '../../context/request/websocket-request.context';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { PropertyMetadata } from '../../entity/decorators/property.decorator';
import { NumberFormat, NumberPropertyMetadata } from '../../entity/models/number-property-metadata.model';
import { $ts } from '../../localization/translate.function';
import { INTEGER_REGEX } from '../../parsing/functions/parse-number.function';
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
// eslint-disable-next-line sonar/cognitive-complexity
export async function validateNumber(
    key: string,
    property: unknown,
    metadata: PropertyMetadata | QueryParamMetadata | HeaderParamMetadata | PathParamMetadata,
    parentKey: string | undefined,
    entity: unknown | undefined
): Promise<ValidationProblem[]> {
    const meta: NumberPropertyMetadata | NumberParamMetadata = metadata as NumberPropertyMetadata | NumberParamMetadata;
    const fullKey: string = parentKey ? `${parentKey}.${key}` : key;
    if (property == undefined) {
        const context: HttpRequestContext | WebsocketRequestContext | undefined = inject(ZIBRI_DI_TOKENS.CURRENT_REQUEST_CONTEXT);
        const isRequired: boolean = typeof metadata.required === 'boolean' ? metadata.required : await metadata.required(entity, context);
        if ((meta as NumberPropertyMetadata).default == undefined && isRequired) {
            return [new IsRequiredValidationProblem(fullKey)];
        }
        if (!isRequired || (meta as NumberPropertyMetadata).default != undefined) {
            return [];
        }
    }
    if (typeof property !== 'number' && meta.format !== 'bigint') {
        return [new TypeMismatchValidationProblem(fullKey, 'number')];
    }
    if (typeof property !== 'bigint' && meta.format === 'bigint') {
        return [new TypeMismatchValidationProblem(fullKey, 'BigIntString')];
    }

    assert(typeof property === 'bigint' || typeof property === 'number');

    if (meta.format && !isFormatValid(meta.format, property)) {
        return [{ key: fullKey, message: $ts`needs to be in format "${meta.format}"` }];
    }
    if (meta.enum && !ObjectUtilities.values(meta.enum).includes(property)) {
        return [{ key: fullKey, message: $ts`needs to match one of "${ObjectUtilities.values(meta.enum)}"` }];
    }
    if (meta.min != undefined && property < meta.min) {
        return [{ key: fullKey, message: $ts`needs to be at least ${meta.min}` }];
    }
    if (meta.max != undefined && property > meta.max) {
        return [{ key: fullKey, message: $ts`needs to be at most ${meta.max}` }];
    }
    return [];
}

// eslint-disable-next-line jsdoc/require-jsdoc
function isFormatValid(format: NumberFormat, value: number | bigint): boolean {
    switch (format) {
        case 'bigint': {
            return INTEGER_REGEX.test(value.toString());
        }
        case 'integer': {
            return Number.isInteger(value);
        }
    }
}