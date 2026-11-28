import { TenantS3TransportSecret } from '../../backup/tenant/tenant-s3-transport-secret.model';
import { TenantS3TransportSettings } from '../../backup/tenant/tenant-s3-transport-settings.model';
import { TenantTransportNetwork } from '../../backup/tenant/tenant-transport-network.model';
import { BadRequestError } from '../../error-handling/errors/bad-request.error';
import { InternalError } from '../../error-handling/internal-error.model';
import { $ts } from '../../localization/translate.function';
import { StorageUtilities } from '../../storage/storage.utilities';
import { Newable } from '../../types/newable.type';
import { FileStoreInterface } from '../stores/file-store.interface';
import { S3FileStore } from '../stores/s3.file-store';
import { TenantFileStoreKindInterface } from './tenant-file-store-kind.interface';

/**
 * A bucket of an S3 compatible storage a tenant keeps its files in, over https.
 *
 * A bucket is reached over https, whose certificate names the host, so a name pointed inside after the check cannot
 * answer for it. A redirect the bucket answers with is followed only to a host that passes the same check.
 */
// what a tenant configures of a bucket is the same for its backups and its files, so the models are the ones
// of the backups. The kind stays apart, since it builds a file store rather than a transport
export class S3TenantFileStoreKind implements TenantFileStoreKindInterface<TenantS3TransportSettings, TenantS3TransportSecret> {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly name: string = 's3';

    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly settingsModel: Newable<TenantS3TransportSettings> = TenantS3TransportSettings;

    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly secretModel: Newable<TenantS3TransportSecret> = TenantS3TransportSecret;

    // eslint-disable-next-line jsdoc/require-jsdoc
    validateSettings(
        settings: TenantS3TransportSettings,
        _: TenantS3TransportSecret,
        network: Pick<TenantTransportNetwork, 'allowPrivateNetworks'>
    ): void {
        if (!settings.endpoint.startsWith('https://') && !network.allowPrivateNetworks) {
            throw new BadRequestError($ts`The endpoint of a bucket needs to be https.`);
        }
        if (!['virtual-hosted', 'path'].includes(settings.addressingStyle)) {
            throw new BadRequestError($ts`The addressing style of a bucket needs to be virtual-hosted or path.`);
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async createStore(
        name: string,
        settings: TenantS3TransportSettings,
        secret: TenantS3TransportSecret,
        network: TenantTransportNetwork
    ): Promise<FileStoreInterface> {
        const endpoint: URL = new URL(settings.endpoint);
        if (endpoint.protocol !== 'https:' && !network.allowPrivateNetworks) {
            throw new InternalError(`The endpoint of the file store "${name}" needs to be https, and is ${endpoint.protocol}.`);
        }
        // in either style, since no bucket holds anything else: named in the host, a ":" or a "/" in it would
        // lead the requests to another host or port than the one checked
        StorageUtilities.validateBucketName(`file store "${name}"`, settings.bucket);
        // the host the requests go to, which for a bucket named in the host is the bucket's own below the
        // endpoint's, and may lead elsewhere than the endpoint does
        await network.resolveAddress(
            settings.addressingStyle === 'virtual-hosted' ? `${settings.bucket}.${endpoint.hostname}` : endpoint.hostname
        );
        return new S3FileStore(
            name,
            {
                endpoint: settings.endpoint,
                bucket: settings.bucket,
                region: settings.region,
                credentials: { accessKeyId: settings.accessKeyId, secretAccessKey: secret.secretAccessKey },
                serverSideEncryption: 'bucket-default',
                prefix: settings.prefix ?? undefined,
                addressingStyle: settings.addressingStyle
            },
            // every hop held to what the endpoint is held to: a redirect is followed with the request's method
            // and body, to wherever the tenant's service says
            async to => {
                await network.resolveAddress(to.hostname);
            }
        );
    }
}