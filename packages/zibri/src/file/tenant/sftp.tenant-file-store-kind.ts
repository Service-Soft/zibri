import { TenantSftpTransportSecret } from '../../backup/tenant/tenant-sftp-transport-secret.model';
import { TenantSftpTransportSettings } from '../../backup/tenant/tenant-sftp-transport-settings.model';
import { TenantTransportNetwork } from '../../backup/tenant/tenant-transport-network.model';
import { SftpAuthentication } from '../../backup/transports/sftp/sftp-authentication.model';
import { BadRequestError } from '../../error-handling/errors/bad-request.error';
import { InternalError } from '../../error-handling/internal-error.model';
import { $ts } from '../../localization/translate.function';
import { Newable } from '../../types/newable.type';
import { FileStoreInterface } from '../stores/file-store.interface';
import { SftpFileStore } from '../stores/sftp.file-store';
import { TenantFileStoreKindInterface } from './tenant-file-store-kind.interface';

/**
 * An SFTP server a tenant keeps its files on, logged in to with a password or a private key.
 *
 * The server is reached at the address the check resolved, and identifies itself by its host key.
 */
// what a tenant configures of a server is the same for its backups and its files, so the models are the ones
// of the backups. The kind stays apart, since it builds a file store rather than a transport
export class SftpTenantFileStoreKind implements TenantFileStoreKindInterface<TenantSftpTransportSettings, TenantSftpTransportSecret> {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly name: string = 'sftp';

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
    async createStore(
        name: string,
        settings: TenantSftpTransportSettings,
        secret: TenantSftpTransportSecret,
        network: TenantTransportNetwork
    ): Promise<FileStoreInterface> {
        const address: string = await network.resolveAddress(settings.host);
        return new SftpFileStore(name, {
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
        // validateSettings refuses such a secret before it is stored
        throw new InternalError(`The secret of the file store "${name}" is neither a password nor a private key.`);
    }
}