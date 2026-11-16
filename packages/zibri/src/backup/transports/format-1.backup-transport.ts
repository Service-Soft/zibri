import { BackupTransportSessionInterface } from './backup-transport-session.interface';
import { BackupTransportSupporting } from './backup-transport.interface';
import { BaseBackupTransport } from './base.backup-transport';

/**
 * Format 1 of the backups, kept through the sessions of a transport of `v2`: the members of `v1` over its sessions,
 * which the backup service stores, finds and deletes backups of format 1 with.
 */
// TODO 4.0: removed with v1 of BackupTransportInterface, once format 1 backups are read through sessions alone
export class Format1BackupTransport extends BaseBackupTransport {
    /**
     * Creates the transport reading and writing format 1 through the given transport.
     * @param transport - The transport the backups are kept in.
     */
    constructor(readonly transport: BackupTransportSupporting<'v2'>) {
        super();
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    get name(): string {
        return this.transport.name;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async openSession(): Promise<BackupTransportSessionInterface> {
        return await this.transport.openSession();
    }
}