import { BinaryLike, createHash, createHmac } from 'node:crypto';

import { S3SigningInput } from './s3-signing-input.model.ts';

// the names signature version 4 gives its algorithm, its service and its scope. They are part of the
// protocol every S3 compatible service speaks, and expected verbatim whoever runs the service - none
// of them points at AWS
const ALGORITHM: string = 'AWS4-HMAC-SHA256';
const KEY_PREFIX: string = 'AWS4';
const SCOPE_TERMINATOR: string = 'aws4_request';
const SERVICE: string = 's3';

/**
 * Signs requests to S3 compatible services, with signature version 4.
 */
export abstract class S3SignatureUtilities {
    /**
     * Resolves the headers a request is sent with: the ones it was given, plus the date, the hash of the body and the signature.
     * @param input - The request to sign.
     * @returns The headers to send. `host` is not among them, the http client sets it from the url.
     */
    static resolveHeaders(input: S3SigningInput): Record<string, string> {
        // 20130524T000000Z, and the date part of it for the scope
        const amzDate: string = input.date.toISOString().replaceAll(/[:-]|\.\d{3}/g, '');
        const scope: string = `${amzDate.slice(0, 8)}/${input.region}/${SERVICE}/${SCOPE_TERMINATOR}`;
        const headers: Record<string, string> = {
            ...input.headers,
            'x-amz-content-sha256': input.payloadHash,
            'x-amz-date': amzDate
        };

        const entries: [string, string][] = [['host', input.url.host], ...Object.entries(headers)];
        const signed: [string, string][] = entries
            .map(([name, value]): [string, string] => [name.toLowerCase(), value.trim().replaceAll(/\s+/g, ' ')])
            // by code unit rather than by locale, which is the order the service sorts them in
            .sort(([a], [b]) => a < b ? -1 : 1);
        const signedHeaders: string = signed.map(([name]) => name).join(';');

        const canonicalRequest: string = [
            input.method,
            // the path as it is sent: S3 encodes it once, where other services using this signature encode it twice
            input.url.pathname,
            S3SignatureUtilities.resolveCanonicalQuery(input.url),
            ...signed.map(([name, value]) => `${name}:${value}`),
            '',
            signedHeaders,
            input.payloadHash
        ].join('\n');
        const stringToSign: string = [ALGORITHM, amzDate, scope, S3SignatureUtilities.hash(canonicalRequest)].join('\n');

        let key: Buffer = S3SignatureUtilities.hmac(`${KEY_PREFIX}${input.secretAccessKey}`, amzDate.slice(0, 8));
        for (const part of [input.region, SERVICE, SCOPE_TERMINATOR]) {
            key = S3SignatureUtilities.hmac(key, part);
        }
        const signature: string = S3SignatureUtilities.hmac(key, stringToSign).toString('hex');

        return {
            ...headers,
            authorization: `${ALGORITHM} Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
        };
    }

    /**
     * Encodes a value the way a signature expects it in a path segment or a query: everything but the unreserved characters.
     * @param value - The value to encode.
     * @returns The encoded value.
     */
    static encode(value: string): string {
        // encodeURIComponent leaves !'()* alone, which the signature counts as reserved
        return encodeURIComponent(value).replaceAll(/[!'()*]/g, character => `%${S3SignatureUtilities.toHex(character)}`);
    }

    /**
     * Hashes a body the way a signature expects it.
     * @param value - The body.
     * @returns Its sha256 in hex.
     */
    static hash(value: BinaryLike): string {
        return createHash('sha256')
            .update(value)
            .digest('hex');
    }

    private static resolveCanonicalQuery(url: URL): string {
        const parameters: string[] = [...url.searchParams.entries()]
            .map(([name, value]) => `${S3SignatureUtilities.encode(name)}=${S3SignatureUtilities.encode(value)}`);
        // encoded, so only ascii is left, where the default order is the order of the bytes
        return parameters.sort().join('&');
    }

    private static hmac(key: BinaryLike, value: string): Buffer {
        return createHmac('sha256', key)
            .update(value)
            .digest();
    }

    private static toHex(character: string): string {
        return character.charCodeAt(0)
            .toString(16)
            .toUpperCase();
    }
}