import { BasePropertyMetadata } from './base-property-metadata.model';
import { MimeType } from '../../http';
import { OmitStrict } from '../../types';

export type FileSize = `${number}b` | `${number}kb` | `${number}mb` | `${number}gb`;

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

export type FilePropertyMetadata = BasePropertyMetadata & {
    type: 'file',
    allowedMimeTypes: MimeType[] | 'all',
    maxSize: FileSize
};

export type FilePropertyMetadataInput = Partial<OmitStrict<FilePropertyMetadata, 'type'>>;