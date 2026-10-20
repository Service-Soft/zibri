import { HttpRequestContext } from '../../context/request/http-request.context.ts';
import { WebsocketRequestContext } from '../../context/request/websocket-request.context.ts';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default.ts';
import { inject } from '../../di/inject.function.ts';
import { PropertyMetadata } from '../../entity/decorators/property.decorator.ts';
import { FilePropertyMetadata, fileSizeToBytes } from '../../entity/models/file-property-metadata.model.ts';
import { InternalError } from '../../error-handling/internal-error.model.ts';
import { MimeType } from '../../http/mime-type.enum.ts';
import { File } from '../../parsing/form-data/file.model.ts';
import { NumberUtilities } from '../../utilities/number.utilities.ts';
import { MaxFileSizeValidationProblem, IsRequiredValidationProblem, TypeMismatchValidationProblem, ValidationProblem, MimeTypeMismatchValidationProblem } from '../validation-problem.model.ts';

/**
 * Validates the given file property.
 * @param key - The key of the property.
 * @param property - The actual value.
 * @param metadata - The metadata of the property.
 * @param parentKey - The key of the parent, if it exists.
 * @param entity - The entity that the file belongs to.
 * @returns All validation problems found.
 * @throws When the property is not a file property.
 */
export async function validateFile(
    key: string,
    property: unknown,
    metadata: PropertyMetadata,
    parentKey: string | undefined,
    entity: unknown | undefined
): Promise<ValidationProblem[]> {
    if (metadata.type !== 'file') {
        throw new InternalError(`Tried to validate a file but received metadata of type "${metadata.type}"`);
    }
    const fullKey: string = parentKey ? `${parentKey}.${key}` : key;
    if (property == undefined && 'required' in metadata) {
        const context: HttpRequestContext | WebsocketRequestContext | undefined = inject(ZIBRI_DI_TOKENS.CURRENT_REQUEST_CONTEXT);
        const isRequired: boolean = typeof metadata.required === 'boolean' ? metadata.required : await metadata.required(entity, context);
        return isRequired ? [new IsRequiredValidationProblem(fullKey)] : [];
    }
    return fileValueProblems(fullKey, property, metadata);
}

/**
 * The problems of a file value, judged by the value alone.
 *
 * Everything about a file except whether it may be left out, which can depend on the request.
 * What decides which of several shapes a value is uses exactly this, so it cannot disagree with
 * validation about any rule it looks at.
 * @param fullKey - The key the problems are reported under.
 * @param property - The value.
 * @param metadata - What the file is declared as.
 * @returns All validation problems found.
 */
export function fileValueProblems(fullKey: string, property: unknown, metadata: FilePropertyMetadata): ValidationProblem[] {
    if (!(property instanceof File)) {
        return [new TypeMismatchValidationProblem(fullKey, 'file')];
    }

    if (NumberUtilities.new(property.size).isGreaterThan(fileSizeToBytes(metadata.maxSize))) {
        return [new MaxFileSizeValidationProblem(fullKey, metadata.maxSize)];
    }
    if (metadata.allowedMimeTypes !== 'all' && !metadata.allowedMimeTypes.includes(property.mimetype as MimeType)) {
        return [new MimeTypeMismatchValidationProblem(fullKey, metadata.allowedMimeTypes)];
    }
    return [];
}