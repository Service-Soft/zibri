import { X509Certificate as PemCertificate } from 'node:crypto';
import { isIP } from 'node:net';

import { BasicConstraintsExtension,
    ExtendedKeyUsageExtension,
    Extension,
    JsonGeneralName,
    KeyUsageFlags,
    KeyUsagesExtension,
    SubjectAlternativeNameExtension,
    X509Certificate,
    X509CertificateGenerator } from '@peculiar/x509';

import { FakeKeyPairOptions } from './fake-key-pair-options.model.ts';
import { FakeKeyPair } from './fake-key-pair.model.ts';
import { FakeKeyUsage } from './fake-key-usage.type.ts';

/**
 * The key: RSA, signing with SHA-256, which SAML and every TLS server take.
 */
const ALGORITHM: RsaHashedKeyGenParams = {
    name: 'RSASSA-PKCS1-v1_5',
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: 'SHA-256'
};

const DAY_IN_MS: number = 86400000;

/**
 * Makes an RSA key and a certificate for it: what a SAML identity provider signs with, what a service
 * provider signs its requests with and has assertions encrypted to, what a TLS server proves who it
 * is with, or what a TLS client does.
 *
 * Self signed by default. A self signed certificate with `hosts` is all a client needs to trust its
 * server; a server whose own software wants an authority beside it gets one made with
 * `authority: true`, and a certificate it signs as the `issuer`.
 * @param name - Who the certificate is issued to, eg. `CN=Fake identity provider`.
 * @param options - The hosts it is valid for, and who signs it.
 * @returns The key and the certificate, PEM encoded.
 */
export async function createFakeKeyPair(name: string, options: FakeKeyPairOptions = {}): Promise<FakeKeyPair> {
    // the global web crypto rather than node's: @peculiar/x509 is typed against it
    const keys: CryptoKeyPair = await crypto.subtle.generateKey(ALGORITHM, true, ['sign', 'verify']);
    const names: JsonGeneralName[] = (options.hosts ?? []).map(host => ({ type: isIP(host) ? 'ip' : 'dns', value: host }));
    const authorityExtensions: Extension[] = [
        new BasicConstraintsExtension(true, undefined, true),
        new KeyUsagesExtension(KeyUsageFlags.keyCertSign | KeyUsageFlags.cRLSign, true)
    ];
    const keyUsages: FakeKeyUsage[] | undefined = options.authority === true ? undefined : options.keyUsages;
    const extensions: Extension[] = [
        ...names.length ? [new SubjectAlternativeNameExtension(names)] : [],
        ...options.authority === true ? authorityExtensions : [],
        ...keyUsages == undefined
            ? []
            : [new KeyUsagesExtension(keyUsages.reduce((flags, usage) => flags | KeyUsageFlags[usage], 0), true)],
        ...options.extendedKeyUsages == undefined ? [] : [new ExtendedKeyUsageExtension(options.extendedKeyUsages)]
    ];
    const notBefore: Date = options.notBefore ?? new Date(Date.now() - DAY_IN_MS);
    const notAfter: Date = options.notAfter ?? new Date(Date.now() + (DAY_IN_MS * 365));
    // no serial number, so a random one: two certificates of one issuer must not share theirs
    const certificate: X509Certificate = options.issuer == undefined
        ? await X509CertificateGenerator.createSelfSigned(
            { name, notBefore, notAfter, signingAlgorithm: ALGORITHM, keys, extensions },
            crypto
        )
        : await X509CertificateGenerator.create({
            subject: name,
            issuer: new X509Certificate(options.issuer.certificate).subject,
            notBefore,
            notAfter,
            signingAlgorithm: ALGORITHM,
            publicKey: keys.publicKey,
            signingKey: await importPrivateKey(options.issuer.privateKey),
            extensions
        }, crypto);
    const pkcs8: string = Buffer.from(await crypto.subtle.exportKey('pkcs8', keys.privateKey)).toString('base64');
    return {
        privateKey: `-----BEGIN PRIVATE KEY-----\n${pkcs8.match(/.{1,64}/g)?.join('\n') ?? pkcs8}\n-----END PRIVATE KEY-----`,
        certificate: new PemCertificate(Buffer.from(certificate.rawData)).toString()
    };
}

/**
 * Reads a private key this function made, to sign with.
 * @param pem - The key, PKCS#8 and PEM encoded.
 * @returns The key.
 */
async function importPrivateKey(pem: string): Promise<CryptoKey> {
    const der: Uint8Array<ArrayBuffer> = Uint8Array.from(Buffer.from(pem.replaceAll(/-----[^-]+-----|\s/g, ''), 'base64'));
    return await crypto.subtle.importKey('pkcs8', der, ALGORITHM, false, ['sign']);
}