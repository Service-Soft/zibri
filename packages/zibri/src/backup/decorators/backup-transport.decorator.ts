import { Injectable } from '../../di/decorators/injectable.decorator.ts';
import { DiVariants } from '../../di/models/di-variant.model.ts';

/**
 * Marks a class that should be a backup transport. Needs to implement "BackupTransportInterface".
 */
export function BackupTransport(): ClassDecorator {
    return target => {
        Injectable({ variant: DiVariants.BACKUP_TRANSPORT })(target);
    };
}