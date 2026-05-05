import { HttpRequestContext } from '../../context/request/http-request.context';
import { WebsocketRequestContext } from '../../context/request/websocket-request.context';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { PropertyMetadata } from '../../entity/decorators/property.decorator';
import { fileSizeToBytes } from '../../entity/models/file-property-metadata.model';
import { MimeType } from '../../http/mime-type.enum';
import { File } from '../../parsing/form-data/file.model';
import { NumberUtilities } from '../../utilities/number.utilities';
import { MaxFileSizeValidationProblem, IsRequiredValidationProblem, TypeMismatchValidationProblem, ValidationProblem, MimeTypeMismatchValidationProblem } from '../validation-problem.model';

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
        throw new Error(`Tried to validate a file but received metadata of type "${metadata.type}"`);
    }
    const fullKey: string = parentKey ? `${parentKey}.${key}` : key;
    if (property == undefined && 'required' in metadata) {
        const context: HttpRequestContext | WebsocketRequestContext | undefined = inject(ZIBRI_DI_TOKENS.CURRENT_REQUEST_CONTEXT);
        const isRequired: boolean = typeof metadata.required === 'boolean' ? metadata.required : await metadata.required(entity, context);
        return isRequired ? [new IsRequiredValidationProblem(fullKey)] : [];
    }
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