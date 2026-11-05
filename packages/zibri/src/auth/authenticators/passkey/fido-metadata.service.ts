import { X509Certificate } from 'node:crypto';

import type { MDSJWTPayload, MetadataBLOBPayloadEntry } from '@simplewebauthn/server';
import type { CompactVerifyResult } from 'jose';

import { FidoMetadataServiceInterface } from './fido-metadata-service.interface';
import { SimpleWebAuthnHelpers } from './simple-web-authn-helpers.type';
import { Injectable } from '../../../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../di/inject.function';
import { InternalError } from '../../../error-handling/internal-error.model';
import { JsonUtilities } from '../../../utilities/json.utilities';
import { Ms } from '../../../utilities/ms';
import { optionalPeer } from '../../../utilities/optional-peer.function';

/**
 * The module of `jose`, which checks the signature of the metadata.
 */
type Jose = typeof import('jose');

/**
 * The header of the metadata, a JWT.
 */
type BlobHeader = {
    /**
     * The certificates of the signer, base64 encoded, the signer's own first.
     */
    x5c?: unknown
};

/**
 * The metadata as it was last downloaded and verified.
 */
type VerifiedMetadata = {
    /**
     * The serial number of the list, which only ever goes up.
     */
    serialNumber: number,
    /**
     * When to download the list again.
     */
    refreshAt: Date,
    /**
     * The entries, by the model they are about.
     */
    entries: Map<string, MetadataBLOBPayloadEntry>
};

/**
 * Where the FIDO Alliance publishes its metadata.
 */
export const FIDO_METADATA_SERVICE_URL: string = 'https://mds.fidoalliance.org/';

/**
 * The roots the FIDO Alliance signs its metadata under: GlobalSign Root CA - R3 and GlobalSign Root R46.
 */
export const FIDO_METADATA_SERVICE_ROOT_CERTIFICATES: string[] = [
    `-----BEGIN CERTIFICATE-----
MIIDXzCCAkegAwIBAgILBAAAAAABIVhTCKIwDQYJKoZIhvcNAQELBQAwTDEgMB4G
A1UECxMXR2xvYmFsU2lnbiBSb290IENBIC0gUjMxEzARBgNVBAoTCkdsb2JhbFNp
Z24xEzARBgNVBAMTCkdsb2JhbFNpZ24wHhcNMDkwMzE4MTAwMDAwWhcNMjkwMzE4
MTAwMDAwWjBMMSAwHgYDVQQLExdHbG9iYWxTaWduIFJvb3QgQ0EgLSBSMzETMBEG
A1UEChMKR2xvYmFsU2lnbjETMBEGA1UEAxMKR2xvYmFsU2lnbjCCASIwDQYJKoZI
hvcNAQEBBQADggEPADCCAQoCggEBAMwldpB5BngiFvXAg7aEyiie/QV2EcWtiHL8
RgJDx7KKnQRfJMsuS+FggkbhUqsMgUdwbN1k0ev1LKMPgj0MK66X17YUhhB5uzsT
gHeMCOFJ0mpiLx9e+pZo34knlTifBtc+ycsmWQ1z3rDI6SYOgxXG71uL0gRgykmm
KPZpO/bLyCiR5Z2KYVc3rHQU3HTgOu5yLy6c+9C7v/U9AOEGM+iCK65TpjoWc4zd
QQ4gOsC0p6Hpsk+QLjJg6VfLuQSSaGjlOCZgdbKfd/+RFO+uIEn8rUAVSNECMWEZ
XriX7613t2Saer9fwRPvm2L7DWzgVGkWqQPabumDk3F2xmmFghcCAwEAAaNCMEAw
DgYDVR0PAQH/BAQDAgEGMA8GA1UdEwEB/wQFMAMBAf8wHQYDVR0OBBYEFI/wS3+o
LkUkrk1Q+mOai97i3Ru8MA0GCSqGSIb3DQEBCwUAA4IBAQBLQNvAUKr+yAzv95ZU
RUm7lgAJQayzE4aGKAczymvmdLm6AC2upArT9fHxD4q/c2dKg8dEe3jgr25sbwMp
jjM5RcOO5LlXbKr8EpbsU8Yt5CRsuZRj+9xTaGdWPoO4zzUhw8lo/s7awlOqzJCK
6fBdRoyV3XpYKBovHd7NADdBj+1EbddTKJd+82cEHhXXipa0095MJ6RMG3NzdvQX
mcIfeg7jLQitChws/zyrVQ4PkX4268NXSb7hLi18YIvDQVETI53O9zJrlAGomecs
Mx86OyXShkDOOyyGeMlhLxS67ttVb9+E7gUJTb0o2HLO02JQZR7rkpeDMdmztcpH
WD9f
-----END CERTIFICATE-----`,
    `-----BEGIN CERTIFICATE-----
MIIFWjCCA0KgAwIBAgISEdK7udcjGJ5AXwqdLdDfJWfRMA0GCSqGSIb3DQEBDAUA
MEYxCzAJBgNVBAYTAkJFMRkwFwYDVQQKExBHbG9iYWxTaWduIG52LXNhMRwwGgYD
VQQDExNHbG9iYWxTaWduIFJvb3QgUjQ2MB4XDTE5MDMyMDAwMDAwMFoXDTQ2MDMy
MDAwMDAwMFowRjELMAkGA1UEBhMCQkUxGTAXBgNVBAoTEEdsb2JhbFNpZ24gbnYt
c2ExHDAaBgNVBAMTE0dsb2JhbFNpZ24gUm9vdCBSNDYwggIiMA0GCSqGSIb3DQEB
AQUAA4ICDwAwggIKAoICAQCsrHQy6LNl5brtQyYdpokNRbopiLKkHWPd08EsCVeJ
OaFV6Wc0dwxu5FUdUiXSE2te4R2pt32JMl8Nnp8semNgQB+msLZ4j5lUlghYruQG
vGIFAha/r6gjA7aUD7xubMLL1aa7DOn2wQL7Id5m3RerdELv8HQvJfTqa1VbkNud
316HCkD7rRlr+/fKYIje2sGP1q7Vf9Q8g+7XFkyDRTNrJ9CG0Bwta/OrffGFqfUo
0q3v84RLHIf8E6M6cqJaESvWJ3En7YEtbWaBkoe0G1h6zD8K+kZPTXhc+CtI4wSE
y132tGqzZfxCnlEmIyDLPRT5ge1lFgBPGmSXZgjPjHvjK8Cd+RTyG/FWaha/LIWF
zXg4mutCagI0GIMXTpRW+LaCtfOW3T3zvn8gdz57GSNrLNRyc0NXfeD412lPFzYE
+cCQYDdF3uYM2HSNrpyibXRdQr4G9dlkbgIQrImwTDsHTUB+JMWKmIJ5jqSngiCN
I/onccnfxkF0oE32kRbcRoxfKWMxWXEM2G/CtjJ9++ZdU6Z+Ffy7dXxd7Pj2Fxzs
x2sZy/N78CsHpdlseVR2bJ0cpm4O6XkMqCNqo98bMDGfsVR7/mrLZqrcZdCinkqa
ByFrgY/bxFn63iLABJzjqls2k+g9vXqhnQt2sQvHnf3PmKgGwvgqo6GDoLclcqUC
4wIDAQABo0IwQDAOBgNVHQ8BAf8EBAMCAYYwDwYDVR0TAQH/BAUwAwEB/zAdBgNV
HQ4EFgQUA1yrc4GHqMywptWU4jaWSf8FmSwwDQYJKoZIhvcNAQEMBQADggIBAHx4
7PYCLLtbfpIrXTncvtgdokIzTfnvpCo7RGkerNlFo048p9gkUbJUHJNOxO97k4Vg
JuoJSOD1u8fpaNK7ajFxzHmuEajwmf3lH7wvqMxX63bEIaZHU1VNaL8FpO7XJqti
2kM3S+LGteWygxk6x9PbTZ4IevPuzz5i+6zoYMzRx6Fcg0XERczzF2sUyQQCPtIk
pnnpHs6i58FZFZ8d4kuaPp92CC1r2LpXFNqD6v6MVenQTqnMdzGxRBF6XLE+0xRF
FRhiJBPSy03OXIPBNvIQtQ6IbbjhVp+J3pZmOUdkLG5NrmJ7v2B0GbhWrJKsFjLt
rWhV/pi60zTe9Mlhww6G9kuEYO4Ne7UyWHmRVSyBQ7N0H3qqJZ4d16GLuc1CLgSk
ZoNNiTW2bKg2SnkheCLQQrzRQDGQob4Ez8pn7fXwgNNgyYMqIgXQBztSvwyeqiv5
u+YfjyW6hY0XHgL+XVAEV8/+LbzvXMAaq7afJMbfc2hIkCwU9D9SGuTSyxTDYWnP
4vkYxboznxSjBF25cfe1lNj2M8FawTSLfJvdkzrnE6JwYZ+vj+vYxXX4M2bUdGc6
N3ec592kD3ZDZopD8p/7DEJ4Y9HiD2971KE9dJeFt0g5QdYg/NA6s/rob8SKunE3
vouXsXgxT7PntgMTzlSdriVZzH81Xwj3QEUxeCp6
-----END CERTIFICATE-----`
];

// the list the FIDO Alliance publishes was 10.6 MB in October 2026, over the http client's default
// limit, and grows with every model certified
const MAX_METADATA_SIZE: '100mb' = '100mb';

/**
 * Default implementation of the FIDO metadata service: downloads what a FIDO Metadata Service
 * publishes about models of devices, verifies it, and keeps it in memory until the list says it is
 * next updated.
 */
@Injectable({ register: 'onUse' })
export class FidoMetadataService implements FidoMetadataServiceInterface {
    // the last list verified, by where it was downloaded from and the roots it was verified under
    private readonly verified: Map<string, VerifiedMetadata> = new Map();
    // the download in flight, so registrations arriving together download the list once. Gone once it
    // ends, so a failed one is tried again by the next registration
    private readonly downloads: Map<string, Promise<VerifiedMetadata>> = new Map();

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findEntry(url: string, rootCertificates: string[], aaguid: string): Promise<MetadataBLOBPayloadEntry | undefined> {
        const metadata: VerifiedMetadata = await this.resolveMetadata(url, rootCertificates);
        return metadata.entries.get(aaguid);
    }

    private async resolveMetadata(url: string, rootCertificates: string[]): Promise<VerifiedMetadata> {
        // the roots belong to the key: a list verified under other roots says nothing about these
        const key: string = [url, ...rootCertificates].join('\n');
        const current: VerifiedMetadata | undefined = this.verified.get(key);
        if (current != undefined && current.refreshAt.getTime() > Date.now()) {
            return current;
        }
        let download: Promise<VerifiedMetadata> | undefined = this.downloads.get(key);
        if (download == undefined) {
            download = this.downloadAndKeep(key, url, rootCertificates, current);
            this.downloads.set(key, download);
        }
        return await download;
    }

    private async downloadAndKeep(
        key: string,
        url: string,
        rootCertificates: string[],
        current: VerifiedMetadata | undefined
    ): Promise<VerifiedMetadata> {
        try {
            const metadata: VerifiedMetadata = await this.downloadMetadata(url, rootCertificates, current);
            this.verified.set(key, metadata);
            return metadata;
        }
        finally {
            this.downloads.delete(key);
        }
    }

    private async downloadMetadata(
        url: string,
        rootCertificates: string[],
        current: VerifiedMetadata | undefined
    ): Promise<VerifiedMetadata> {
        const response: Response = await inject(ZIBRI_DI_TOKENS.HTTP_CLIENT)
            .fetchForLibrary(url, { method: 'GET' }, { maxResponseSize: MAX_METADATA_SIZE });
        if (!response.ok) {
            throw new InternalError(`The metadata service at ${url} answered ${response.status}.`);
        }
        const payload: MDSJWTPayload = await this.verifyBlob(await response.text(), rootCertificates);
        if (current != undefined && payload.no < current.serialNumber) {
            // an older list than the one already verified, which is what replaying a list from before
            // a model was reported compromised looks like
            throw new InternalError(
                `The metadata service at ${url} published list ${payload.no}, older than list ${current.serialNumber}.`
            );
        }
        const nextUpdate: Date = new Date(`${payload.nextUpdate}T00:00:00Z`);
        return {
            serialNumber: payload.no,
            // a list past its update that has not been replaced yet is asked for again in an hour,
            // rather than on every registration until it is
            refreshAt: nextUpdate.getTime() > Date.now() ? nextUpdate : new Date(Date.now() + Ms.HOUR),
            entries: new Map(payload.entries.filter(e => e.aaguid != undefined).map(e => [e.aaguid ?? '', e]))
        };
    }

    /**
     * Verifies that the list is signed by a certificate issued under one of the roots, and reads it.
     * @param blob - The list, a JWT carrying the certificates of its signer.
     * @param rootCertificates - The roots, PEM encoded.
     * @returns What the list says.
     * @throws When the certificates do not lead to one of the roots, or the signature does not verify.
     */
    private async verifyBlob(blob: string, rootCertificates: string[]): Promise<MDSJWTPayload> {
        const helpers: SimpleWebAuthnHelpers = optionalPeer('@simplewebauthn/server/helpers', 'Passkey attestation');
        const jose: Jose = optionalPeer('jose', 'Passkey attestation');
        const header: BlobHeader = JsonUtilities.parse(Buffer.from(blob.split('.')[0] ?? '', 'base64url').toString('utf8'));
        const certificates: string[] = Array.isArray(header.x5c) ? header.x5c.filter((c): c is string => typeof c === 'string') : [];
        const chain: string[] = certificates.map(c => helpers.convertCertBufferToPEM(Buffer.from(c, 'base64')));
        const signer: string | undefined = chain[0];
        if (signer == undefined) {
            throw new InternalError('The metadata carries no certificate of its signer.');
        }
        // without a root, the library's check passes any chain at all
        if (!rootCertificates.length) {
            throw new InternalError('The metadata cannot be verified without a root certificate to verify it under.');
        }
        await helpers.validateCertificatePath(chain, rootCertificates);
        // the signer's key as a node key: jose recognizes a key from another realm by instanceof
        const verified: CompactVerifyResult = await jose.compactVerify(blob, new X509Certificate(signer).publicKey, {
            algorithms: ['RS256', 'ES256', 'PS256']
        });
        const payload: MDSJWTPayload = JsonUtilities.parse(Buffer.from(verified.payload).toString('utf8'));
        if (typeof payload.no !== 'number' || typeof payload.nextUpdate !== 'string' || !Array.isArray(payload.entries)) {
            throw new InternalError('The metadata is not a list of the shape FIDO publishes.');
        }
        return payload;
    }
}