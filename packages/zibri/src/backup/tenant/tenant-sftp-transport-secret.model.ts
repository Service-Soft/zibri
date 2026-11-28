import { type TenantSftpTransportSecretModel } from 'zibri-contract';

import { Property } from '../../entity/decorators/property.decorator';

/**
 * The secret a tenant's SFTP server is logged in to with: a password, or a private key in OpenSSH format,
 * exactly one of them.
 */
export class TenantSftpTransportSecret implements TenantSftpTransportSecretModel {
    /**
     * The password of the user.
     */
    @Property.string({ required: false })
    password?: string;

    /**
     * The private key of the user, in OpenSSH format, as it is written in its file.
     */
    @Property.string({ required: false })
    privateKey?: string;

    /**
     * The passphrase the private key is encrypted with, if it is.
     */
    @Property.string({ required: false })
    passphrase?: string;
}