import { Injectable } from '../../di/decorators/injectable.decorator';
import { DiVariants } from '../../di/models/di-variant.model';

/**
 * Marks a class that should be a file store. Needs to implement `FileStoreInterface`, or extend a shipped store such
 * as `FsFileStore`.
 */
export function FileStore(): ClassDecorator {
    return target => {
        Injectable({ variant: DiVariants.FILE_STORE })(target);
    };
}