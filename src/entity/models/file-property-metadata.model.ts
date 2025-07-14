import { BasePropertyMetadata } from './base-property-metadata.model';
import { MimeType } from '../../http';
import { OmitStrict } from '../../types';

/**
 * Possible file size values.
 */
export type FileSize = `${number}b` | `${number}kb` | `${number}mb` | `${number}gb`;

/**
 * Resolves a file size to bytes.
 * @param size - The file size to resolve to bytes.
 * @returns The amount of bytes.
 */
export function fileSizeToBytes(size: FileSize): number {
    if (size.endsWith('gb')) {
        const [amount] = size.split('gb');
        return Number(amount) * 1073741824;
    }
    if (size.endsWith('mb')) {
        const [amount] = size.split('mb');
        return Number(amount) * 1048576;
    }
    if (size.endsWith('kb')) {
        const [amount] = size.split('kb');
        return Number(amount) * 1024;
    }
    const [amount] = size.split('b');
    return Number(amount);
}

/**
 * Metadata for file properties.
 */
export type FilePropertyMetadata = BasePropertyMetadata & {
    /**
     * The type of the property.
     */
    type: 'file',
    /**
     * The allowed mime types.
     */
    allowedMimeTypes: MimeType[] | 'all',
    /**
     * The maximum file size.
     */
    maxSize: FileSize
};

/**
 * Input Metadata for file properties.
 */
export type FilePropertyMetadataInput = Partial<OmitStrict<FilePropertyMetadata, 'type'>>;