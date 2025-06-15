import { fileSizeToBytes, PropertyMetadata } from '../../entity';
import { MimeType } from '../../http';
import { File } from '../../parsing';
import { MaxFileSizeValidationProblem, IsRequiredValidationProblem, TypeMismatchValidationProblem, ValidationProblem, MimeTypeMismatchValidationProblem } from '../validation-problem.model';

export function validateFile(
    key: string,
    property: unknown,
    metadata: PropertyMetadata,
    parentKey: string | undefined
): ValidationProblem[] {
    if (metadata.type !== 'file') {
        throw new Error(`Tried to validate a file but received metadata of type "${metadata.type}"`);
    }
    const fullKey: string = parentKey ? `${parentKey}.${key}` : key;
    if (property == undefined && 'required' in metadata && metadata.required) {
        return [new IsRequiredValidationProblem(fullKey)];
    }
    if (property == undefined && 'required' in metadata && !metadata.required) {
        return [];
    }
    if (!(property instanceof File)) {
        return [new TypeMismatchValidationProblem(fullKey, 'file')];
    }

    if (property.size > fileSizeToBytes(metadata.maxSize)) {
        return [new MaxFileSizeValidationProblem(fullKey, metadata.maxSize)];
    }
    if (metadata.allowedMimeTypes !== 'all' && !metadata.allowedMimeTypes.includes(property.mimetype as MimeType)) {
        return [new MimeTypeMismatchValidationProblem(fullKey, metadata.allowedMimeTypes)];
    }
    return [];
}