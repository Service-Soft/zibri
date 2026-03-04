import { PropertyMetadata } from '../../entity/decorators/property.decorator';
import { fileSizeToBytes } from '../../entity/models/file-property-metadata.model';
import { MimeType } from '../../http/mime-type.enum';
import { File } from '../../parsing/form-data/file.model';
import { BigNumberUtilities } from '../../utilities/big-number.utilities';
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
export function validateFile(
    key: string,
    property: unknown,
    metadata: PropertyMetadata,
    parentKey: string | undefined,
    entity: unknown | undefined
): ValidationProblem[] {
    if (metadata.type !== 'file') {
        throw new Error(`Tried to validate a file but received metadata of type "${metadata.type}"`);
    }
    const fullKey: string = parentKey ? `${parentKey}.${key}` : key;
    if (
        property == undefined
        && 'required' in metadata
        && (typeof metadata.required === 'boolean' ? metadata.required : metadata.required(entity))
    ) {
        return [new IsRequiredValidationProblem(fullKey)];
    }
    if (
        property == undefined
        && 'required' in metadata
        && !(typeof metadata.required === 'boolean' ? metadata.required : metadata.required(entity))
    ) {
        return [];
    }
    if (!(property instanceof File)) {
        return [new TypeMismatchValidationProblem(fullKey, 'file')];
    }

    if (BigNumberUtilities.new(property.size).isGreaterThan(fileSizeToBytes(metadata.maxSize))) {
        return [new MaxFileSizeValidationProblem(fullKey, metadata.maxSize)];
    }
    if (metadata.allowedMimeTypes !== 'all' && !metadata.allowedMimeTypes.includes(property.mimetype as MimeType)) {
        return [new MimeTypeMismatchValidationProblem(fullKey, metadata.allowedMimeTypes)];
    }
    return [];
}