import { createPrivateKey, KeyObject, X509Certificate as PemCertificate, randomBytes, randomUUID, sign } from 'node:crypto';
import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';

import { BasicConstraintsExtension, Extension, KeyUsageFlags, KeyUsagesExtension, X509Certificate, X509CertificateGenerator } from '@peculiar/x509';
import { JsonUtilities, KnownHeader, MimeType } from 'zibri';

import { FakePasskeyAttestation } from './fake-passkey-attestation.model';

/**
 * A model of device, made up for a test.
 */
type IssuedModel = {
    /**
     * What a device of the model proves itself with.
     */
    attestation: FakePasskeyAttestation,
    /**
     * The certificate the model's attestation certificates are issued under, DER encoded.
     */
    root: Buffer
};

/**
 * A key and the certificate issued for it.
 */
// the global web crypto types rather than node's: @peculiar/x509 is typed against them, and node's
// name key usages they do not know
type Issued = {
    /**
     * The key.
     */
    keys: CryptoKeyPair,
    /**
     * Its certificate.
     */
    certificate: X509Certificate
};

/**
 * The status of a model, as the metadata service reports it (FIDO Metadata Service §3.1.4).
 */
type StatusReport = {
    /**
     * The status, eg. `FIDO_CERTIFIED` or `ATTESTATION_KEY_COMPROMISE`.
     */
    status: string,
    /**
     * Since when, as `YYYY-MM-DD`.
     */
    effectiveDate: string
};

/**
 * What the metadata service says about one model of device.
 */
type Entry = {
    /**
     * The model.
     */
    aaguid: string,
    /**
     * The certificate its attestation certificates are issued under, DER encoded.
     */
    root: Buffer,
    /**
     * What it reports about the model, latest last.
     */
    statusReports: StatusReport[]
};

const ALGORITHM: EcKeyGenParams & EcdsaParams = { name: 'ECDSA', namedCurve: 'P-256', hash: 'SHA-256' };

/**
 * The id of the certificate extension that names the model an attestation certificate is for.
 */
const AAGUID_EXTENSION: string = '1.3.6.1.4.1.45724.1.1.4';

/**
 * A FIDO Metadata Service running in the test's own process, reached over plain http on the loopback
 * interface.
 *
 * It publishes what it knows about the models of devices it was told about, signed the way the real
 * one signs it, under a root certificate of its own. It also makes those models: each comes with the
 * attestation a device of the model proves itself with.
 */
export class FakeFidoMetadataService {
    /**
     * How often the list has been downloaded.
     */
    downloads: number = 0;

    /**
     * When the list says it is next updated, as `YYYY-MM-DD`. A year from now by default.
     */
    nextUpdate: string = FakeFidoMetadataService.toDay(FakeFidoMetadataService.yearsFromNow(1));

    private readonly server: Server;
    private readonly entries: Entry[] = [];
    private serialNumber: number = 1;
    private url: string | undefined;

    private constructor(
        private readonly root: Issued,
        private readonly signer: X509Certificate,
        private readonly signerKey: KeyObject
    ) {
        this.server = createServer((req, res) => {
            this.handle(req, res);
        });
    }

    /**
     * Creates a service with a root of its own, not yet listening.
     * @returns The service.
     */
    static async create(): Promise<FakeFidoMetadataService> {
        const root: Issued = await FakeFidoMetadataService.issueRoot('CN=Fake FIDO Metadata Root');
        const signerKeys: CryptoKeyPair = await FakeFidoMetadataService.generateKeys();
        const signer: X509Certificate = await X509CertificateGenerator.create({
            serialNumber: '02',
            subject: 'CN=Fake FIDO Metadata Signer',
            issuer: root.certificate.subject,
            notBefore: FakeFidoMetadataService.yearsFromNow(-1),
            notAfter: FakeFidoMetadataService.yearsFromNow(10),
            signingAlgorithm: ALGORITHM,
            publicKey: signerKeys.publicKey,
            signingKey: root.keys.privateKey,
            extensions: [new BasicConstraintsExtension(false, undefined, true)]
        }, crypto);
        return new FakeFidoMetadataService(root, signer, await FakeFidoMetadataService.toKeyObject(signerKeys.privateKey));
    }

    /**
     * The url the list is downloaded from.
     * @returns The url.
     * @throws When the service has not been started.
     */
    get blobUrl(): string {
        if (this.url == undefined) {
            throw new Error('The fake metadata service has not been started.');
        }
        return `${this.url}/`;
    }

    /**
     * The certificate the list is signed under, which an application trusts it by.
     * @returns The certificate, PEM encoded.
     */
    get rootCertificate(): string {
        return new PemCertificate(Buffer.from(this.root.certificate.rawData)).toString();
    }

    /**
     * Starts listening on a free port of the loopback interface.
     */
    async listen(): Promise<void> {
        await new Promise<void>(resolve => this.server.listen(0, '127.0.0.1', resolve));
        const address: AddressInfo | string | null = this.server.address();
        if (address == undefined || typeof address === 'string') {
            throw new Error('The fake metadata service is not listening on a port.');
        }
        this.url = `http://127.0.0.1:${address.port}`;
    }

    /**
     * Stops listening.
     */
    async close(): Promise<void> {
        this.server.closeAllConnections();
        await new Promise<void>(resolve => this.server.close(() => resolve()));
    }

    /**
     * Makes a model of device the service knows, certified, and answers with the attestation a device
     * of the model proves itself with.
     * @returns The attestation, for a `FakePasskeyDevice`.
     */
    async addModel(): Promise<FakePasskeyAttestation> {
        const attestation: IssuedModel = await FakeFidoMetadataService.issueModel();
        this.entries.push({
            aaguid: attestation.attestation.aaguid,
            root: attestation.root,
            statusReports: [{ status: 'FIDO_CERTIFIED', effectiveDate: '2024-01-01' }]
        });
        this.serialNumber++;
        return attestation.attestation;
    }

    /**
     * Makes a model of device the service does not know, as a maker could whose devices nobody
     * certified, and answers with the attestation a device of it proves itself with.
     * @param aaguid - The model the device claims to be, which may be one the service knows. A new one
     * by default.
     * @returns The attestation, for a `FakePasskeyDevice`.
     */
    async createUnlistedModel(aaguid?: string): Promise<FakePasskeyAttestation> {
        return (await FakeFidoMetadataService.issueModel(aaguid)).attestation;
    }

    /**
     * Reports that the attestation keys of a model have leaked, from today.
     * @param aaguid - The model.
     * @throws When the service does not know the model.
     */
    reportCompromised(aaguid: string): void {
        const entry: Entry | undefined = this.entries.find(e => e.aaguid === aaguid);
        if (entry == undefined) {
            throw new Error(`The fake metadata service knows no model ${aaguid}.`);
        }
        entry.statusReports.push({ status: 'ATTESTATION_KEY_COMPROMISE', effectiveDate: FakeFidoMetadataService.toDay(new Date()) });
        this.serialNumber++;
    }

    private static async issueModel(aaguid: string = randomUUID()): Promise<IssuedModel> {
        const root: Issued = await FakeFidoMetadataService.issueRoot(`CN=Fake Attestation Root ${aaguid}`);
        const keys: CryptoKeyPair = await FakeFidoMetadataService.generateKeys();
        // the model, as a DER octet string of its 16 bytes
        const aaguidExtension: Uint8Array<ArrayBuffer> = new Uint8Array(
            Buffer.concat([Buffer.from([0x04, 0x10]), Buffer.from(aaguid.replaceAll('-', ''), 'hex')])
        );
        // the fields a packed attestation certificate has to have (WebAuthn §8.2.1)
        const certificate: X509Certificate = await X509CertificateGenerator.create({
            serialNumber: randomBytes(8).toString('hex'),
            subject: 'C=DE, O=Fake Devices, OU=Authenticator Attestation, CN=Fake Device',
            issuer: root.certificate.subject,
            notBefore: FakeFidoMetadataService.yearsFromNow(-1),
            notAfter: FakeFidoMetadataService.yearsFromNow(10),
            signingAlgorithm: ALGORITHM,
            publicKey: keys.publicKey,
            signingKey: root.keys.privateKey,
            extensions: [
                new BasicConstraintsExtension(false, undefined, true),
                new Extension(AAGUID_EXTENSION, false, aaguidExtension)
            ]
        }, crypto);
        return {
            attestation: {
                aaguid,
                privateKey: await FakeFidoMetadataService.toKeyObject(keys.privateKey),
                certificates: [Buffer.from(certificate.rawData)]
            },
            root: Buffer.from(root.certificate.rawData)
        };
    }

    private static async issueRoot(name: string): Promise<Issued> {
        const keys: CryptoKeyPair = await FakeFidoMetadataService.generateKeys();
        const certificate: X509Certificate = await X509CertificateGenerator.createSelfSigned({
            serialNumber: '01',
            name,
            notBefore: FakeFidoMetadataService.yearsFromNow(-1),
            notAfter: FakeFidoMetadataService.yearsFromNow(20),
            signingAlgorithm: ALGORITHM,
            keys,
            extensions: [
                new BasicConstraintsExtension(true, undefined, true),
                new KeyUsagesExtension(KeyUsageFlags.keyCertSign | KeyUsageFlags.cRLSign, true)
            ]
        }, crypto);
        return { keys, certificate };
    }

    private static async generateKeys(): Promise<CryptoKeyPair> {
        return await crypto.subtle.generateKey(ALGORITHM, true, ['sign', 'verify']);
    }

    private static async toKeyObject(privateKey: CryptoKey): Promise<KeyObject> {
        return createPrivateKey({ key: Buffer.from(await crypto.subtle.exportKey('pkcs8', privateKey)), format: 'der', type: 'pkcs8' });
    }

    private static toDay(date: Date): string {
        return date
            .toISOString()
            .slice(0, 10);
    }

    private static yearsFromNow(years: number): Date {
        const date: Date = new Date();
        date.setFullYear(date.getFullYear() + years);
        return date;
    }

    private handle(req: IncomingMessage, res: ServerResponse): void {
        if (req.method !== 'GET' || req.url !== '/') {
            res.writeHead(404).end();
            return;
        }
        this.downloads++;
        res.writeHead(200, { [KnownHeader.CONTENT_TYPE]: MimeType.TXT }).end(this.toBlob());
    }

    // the list is a JWT signed with the signer's key, whose certificate chain it carries (FIDO
    // Metadata Service §3.1.7)
    private toBlob(): string {
        const header: string = Buffer.from(JsonUtilities.stringify({
            alg: 'ES256',
            typ: 'JWT',
            x5c: [Buffer.from(this.signer.rawData).toString('base64')]
        })).toString('base64url');
        const payload: string = Buffer.from(JsonUtilities.stringify({
            legalHeader: 'Fake metadata, for tests only.',
            no: this.serialNumber,
            nextUpdate: this.nextUpdate,
            entries: this.entries.map(entry => this.toPayloadEntry(entry))
        })).toString('base64url');
        const signature: Buffer = sign(
            'sha256',
            Buffer.from(`${header}.${payload}`),
            { key: this.signerKey, dsaEncoding: 'ieee-p1363' }
        );
        return `${header}.${payload}.${signature.toString('base64url')}`;
    }

    private toPayloadEntry(entry: Entry): Record<string, unknown> {
        const latest: StatusReport | undefined = entry.statusReports.at(-1);
        return {
            aaguid: entry.aaguid,
            metadataStatement: {
                legalHeader: 'Fake metadata, for tests only.',
                aaguid: entry.aaguid,
                description: 'Fake Device',
                authenticatorVersion: 1,
                protocolFamily: 'fido2',
                schema: 3,
                upv: [{ major: 1, minor: 1 }],
                authenticationAlgorithms: ['secp256r1_ecdsa_sha256_raw'],
                publicKeyAlgAndEncodings: ['cose'],
                attestationTypes: ['basic_full'],
                userVerificationDetails: [[{ userVerificationMethod: 'passcode_internal' }]],
                keyProtection: ['hardware'],
                matcherProtection: ['on_chip'],
                attachmentHint: ['external'],
                tcDisplay: [],
                attestationRootCertificates: [entry.root.toString('base64')]
            },
            statusReports: entry.statusReports,
            timeOfLastStatusChange: latest?.effectiveDate ?? '2024-01-01'
        };
    }
}