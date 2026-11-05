import { X509Certificate } from 'node:crypto';

import { beforeAll, describe, expect, it } from '@jest/globals';
import { createFakeKeyPair, FakeKeyPair } from 'zibri-testing';

import { ClientCertificateHeaderUtilities } from './client-certificate-header.utilities';

let client: X509Certificate;
let authority: X509Certificate;

/**
 * The fingerprint of what was found, to compare it with the certificate it should be.
 * @param encoded - What was found.
 * @returns The fingerprint, or undefined when nothing was found.
 */
function fingerprintOf(encoded: Buffer | undefined): string | undefined {
    return encoded == undefined ? undefined : new X509Certificate(encoded).fingerprint256;
}

/**
 * A certificate as base64 DER.
 * @param certificate - The certificate.
 * @returns Its DER bytes in base64.
 */
function base64Of(certificate: X509Certificate): string {
    return certificate.raw.toString('base64');
}

describe('ClientCertificateHeaderUtilities', () => {
    beforeAll(async () => {
        const ca: FakeKeyPair = await createFakeKeyPair('CN=Header test authority', { authority: true });
        authority = new X509Certificate(ca.certificate);
        client = new X509Certificate((await createFakeKeyPair('CN=header-client', { issuer: ca })).certificate);
    });

    describe('rfc9440', () => {
        it('reads the byte sequence', () => {
            const found: Buffer | undefined = ClientCertificateHeaderUtilities.findEncodedCertificate(`:${base64Of(client)}:`, 'rfc9440');

            expect(fingerprintOf(found)).toBe(client.fingerprint256);
        });

        it('finds nothing in a value that is not a byte sequence', () => {
            expect(ClientCertificateHeaderUtilities.findEncodedCertificate(base64Of(client), 'rfc9440')).toBeUndefined();
            expect(ClientCertificateHeaderUtilities.findEncodedCertificate('::', 'rfc9440')).toBeUndefined();
            expect(ClientCertificateHeaderUtilities.findEncodedCertificate('', 'rfc9440')).toBeUndefined();
        });
    });

    describe('url-encoded-pem', () => {
        it('reads the URL encoded PEM', () => {
            const found: Buffer | undefined = ClientCertificateHeaderUtilities.findEncodedCertificate(
                encodeURIComponent(client.toString()),
                'url-encoded-pem'
            );

            expect(fingerprintOf(found)).toBe(client.fingerprint256);
        });

        it('finds nothing in an empty value, or one that is not URL encoded', () => {
            expect(ClientCertificateHeaderUtilities.findEncodedCertificate('', 'url-encoded-pem')).toBeUndefined();
            expect(ClientCertificateHeaderUtilities.findEncodedCertificate('%E0%A4%A', 'url-encoded-pem')).toBeUndefined();
        });
    });

    describe('xfcc', () => {
        it('reads the certificate of the last element, past quoted commas, semicolons and quotes', () => {
            const earlier: string = `By=spiffe://cluster/gateway;Cert="${encodeURIComponent(authority.toString())}"`;
            // in the order Envoy writes them, so the quoted subject comes after the certificate: split
            // at its comma, the last element would be the end of the subject, with no certificate
            const last: string = [
                'By=spiffe://cluster/ns/default/sa/api',
                'Hash=468ed33be74eee6556d90c0149c1309e9ba61d6425303443c0748a02dd8de688',
                `Cert="${encodeURIComponent(client.toString())}"`,
                String.raw`Subject="CN=header-client,O=Acme\, Inc.;OU=\"ops\""`,
                'URI=spiffe://cluster/ns/default/sa/client'
            ].join(';');

            const found: Buffer | undefined = ClientCertificateHeaderUtilities.findEncodedCertificate(`${earlier},${last}`, 'xfcc');

            expect(fingerprintOf(found)).toBe(client.fingerprint256);
        });

        it('reads a certificate that is not quoted', () => {
            const found: Buffer | undefined = ClientCertificateHeaderUtilities.findEncodedCertificate(
                `By=spiffe://cluster/api;cert=${encodeURIComponent(client.toString())}`,
                'xfcc'
            );

            expect(fingerprintOf(found)).toBe(client.fingerprint256);
        });

        it('finds nothing when the last element has no certificate, even when an earlier one has', () => {
            const earlier: string = `By=spiffe://cluster/gateway;Cert="${encodeURIComponent(client.toString())}"`;

            const found: Buffer | undefined = ClientCertificateHeaderUtilities.findEncodedCertificate(
                `${earlier},By=spiffe://cluster/api;Hash=468ed33b;URI=spiffe://cluster/client`,
                'xfcc'
            );

            expect(found).toBeUndefined();
        });
    });

    describe('traefik', () => {
        it('reads the first certificate of the chain', () => {
            const value: string = `${encodeURIComponent(base64Of(client))},${encodeURIComponent(base64Of(authority))}`;

            const found: Buffer | undefined = ClientCertificateHeaderUtilities.findEncodedCertificate(value, 'traefik');

            expect(fingerprintOf(found)).toBe(client.fingerprint256);
        });

        it('finds nothing in an empty value', () => {
            expect(ClientCertificateHeaderUtilities.findEncodedCertificate('', 'traefik')).toBeUndefined();
        });
    });
});