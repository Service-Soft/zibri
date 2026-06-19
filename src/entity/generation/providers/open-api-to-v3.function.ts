import { convertObj, ConvertOutputOptions } from 'swagger2openapi';

import { InternalError } from '../../../error-handling/internal-error.model';
import { OpenApiDefinition } from '../../../open-api/open-api.model';

/**
 * Converts the given spec to open api v3.1.
 * @param spec - The spec to transform.
 * @returns An open api v3 spec.
 */
export async function openApiToV3(spec: unknown): Promise<OpenApiDefinition> {
    if (spec == undefined || typeof spec !== 'object' || Array.isArray(spec)) {
        throw new InternalError('Invalid OpenAPI document');
    }

    if ('swagger' in spec && spec.swagger === '2.0') {
        // eslint-disable-next-line typescript/no-explicit-any, typescript/no-unsafe-argument
        const converted: ConvertOutputOptions = await convertObj(spec as any, { patch: true, warnOnly: false });
        return {
            ...converted.openapi,
            openapi: '3.1.0'
        } as OpenApiDefinition;
    }

    if ('openapi' in spec && typeof spec.openapi === 'string') {
        if (spec.openapi.startsWith('3.1')) {
            return spec as OpenApiDefinition;
        }
        if (spec.openapi.startsWith('3.0')) {
            return {
                ...(spec as OpenApiDefinition),
                openapi: '3.1.0'
            };
        }
    }

    throw new InternalError('Unsupported OpenAPI version');
}