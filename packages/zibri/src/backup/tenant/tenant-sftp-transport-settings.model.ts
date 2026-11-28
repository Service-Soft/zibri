import { type TenantSftpTransportSettingsModel } from 'zibri-contract';

import { Property } from '../../entity/decorators/property.decorator';

/**
 * Where a tenant's SFTP server is, who logs in, and the key it identifies itself with. The password or
 * private key is kept apart, encrypted.
 */
export class TenantSftpTransportSettings implements TenantSftpTransportSettingsModel {
    /**
     * The host of the server.
     */
    @Property.string()
    host!: string;

    /**
     * The port, 22 when not set.
     */
    @Property.number({ format: 'integer', required: false })
    port?: number | null;

    /**
     * The user that logs in.
     */
    @Property.string()
    username!: string;

    /**
     * The SHA256 fingerprint of the server's host key, as `ssh-keygen -lf` prints it.
     */
    @Property.string()
    hostKeyFingerprint!: string;

    /**
     * The folder on the server the backups go into.
     */
    @Property.string()
    path!: string;
}