import { ZIBRI_BACKUP_TRANSPORT_KINDS } from 'zibri-contract';

import { BadRequestError } from '../../error-handling/errors/bad-request.error';
import { $ts } from '../../localization/translate.function';
import { Newable } from '../../types/newable.type';
import { BackupTransportSupporting } from '../transports/backup-transport.interface';
import { SftpAuthentication } from '../transports/sftp/sftp-authentication.model';
import { SftpBackupTransport } from '../transports/sftp.backup-transport';
import { TenantBackupTransportKindInterface } from './tenant-backup-transport-kind.interface';
import { TenantSftpTransportSecret } from './tenant-sftp-transport-secret.model';
import { TenantSftpTransportSettings } from './tenant-sftp-transport-settings.model';
import { TenantTransportNetwork } from './tenant-transport-network.model';

/**
 * An SFTP server a tenant keeps its backups on, logged in to with a password or a private key.
 *
 * The server is reached at the address the check resolved, and identifies itself by its host key.
 */
export class SftpTenantBackupTransportKind
implements TenantBackupTransportKindInterface<TenantSftpTransportSettings, TenantSftpTransportSecret> {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly name: string = ZIBRI_BACKUP_TRANSPORT_KINDS.SFTP;

    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly settingsModel: Newable<TenantSftpTransportSettings> = TenantSftpTransportSettings;

    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly secretModel: Newable<TenantSftpTransportSecret> = TenantSftpTransportSecret;

    // eslint-disable-next-line jsdoc/require-jsdoc
    validateSettings(_: TenantSftpTransportSettings, secret: TenantSftpTransportSecret): void {
        if ((secret.password == undefined) === (secret.privateKey == undefined)) {
            throw new BadRequestError($ts`The secret of an SFTP server needs to be a password or a private key, exactly one of them.`);
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async createTransport(
        name: string,
        settings: TenantSftpTransportSettings,
        secret: TenantSftpTransportSecret,
        network: TenantTransportNetwork
    ): Promise<BackupTransportSupporting<'v2'>> {
        const address: string = await network.resolveAddress(settings.host);
        return new SftpBackupTransport(name, {
            host: address,
            port: settings.port ?? undefined,
            username: settings.username,
            authentication: this.resolveAuthentication(name, secret),
            hostKeyFingerprint: settings.hostKeyFingerprint,
            path: settings.path
        });
    }

    private resolveAuthentication(name: string, secret: TenantSftpTransportSecret): SftpAuthentication {
        if (secret.password != undefined) {
            return { password: secret.password };
        }
        if (secret.privateKey != undefined) {
            return secret.passphrase == undefined
                ? { privateKey: secret.privateKey }
                : { privateKey: secret.privateKey, passphrase: secret.passphrase };
        }
        throw new BadRequestError($ts`The secret of the transport ${name} is neither a password nor a private key.`);
    }
}