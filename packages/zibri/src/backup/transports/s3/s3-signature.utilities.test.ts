import { describe, expect, it } from '@jest/globals';

import { S3SignatureUtilities } from './s3-signature.utilities';

// the examples AWS publishes for signature version 4 on S3, with their credentials and their results:
// https://docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html
const accessKeyId: string = 'AKIAIOSFODNN7EXAMPLE';
const secretAccessKey: string = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
const date: Date = new Date('2013-05-24T00:00:00.000Z');
const emptyHash: string = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

describe('S3SignatureUtilities', () => {
    it('signs a get request with a header of its own', () => {
        const headers: Record<string, string> = S3SignatureUtilities.resolveHeaders({
            method: 'GET',
            url: new URL('https://examplebucket.s3.amazonaws.com/test.txt'),
            headers: { range: 'bytes=0-9' },
            payloadHash: emptyHash,
            accessKeyId,
            secretAccessKey,
            region: 'us-east-1',
            date
        });

        expect(headers['authorization']).toBe(
            'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, '
            + 'SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, '
            + 'Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41'
        );
        expect(headers).toEqual(expect.objectContaining({ 'x-amz-date': '20130524T000000Z', 'x-amz-content-sha256': emptyHash }));
    });

    it('signs a put request by the hash of its body', () => {
        const body: string = 'Welcome to Amazon S3.';

        const headers: Record<string, string> = S3SignatureUtilities.resolveHeaders({
            method: 'PUT',
            url: new URL(`https://examplebucket.s3.amazonaws.com/${S3SignatureUtilities.encode('test$file.text')}`),
            headers: { date: 'Fri, 24 May 2013 00:00:00 GMT', 'x-amz-storage-class': 'REDUCED_REDUNDANCY' },
            payloadHash: S3SignatureUtilities.hash(body),
            accessKeyId,
            secretAccessKey,
            region: 'us-east-1',
            date
        });

        expect(headers['authorization']).toBe(
            'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, '
            + 'SignedHeaders=date;host;x-amz-content-sha256;x-amz-date;x-amz-storage-class, '
            + 'Signature=98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd'
        );
    });

    it('signs a query without a value', () => {
        const headers: Record<string, string> = S3SignatureUtilities.resolveHeaders({
            method: 'GET',
            url: new URL('https://examplebucket.s3.amazonaws.com/?lifecycle'),
            headers: {},
            payloadHash: emptyHash,
            accessKeyId,
            secretAccessKey,
            region: 'us-east-1',
            date
        });

        expect(headers['authorization']).toContain('Signature=fea454ca298b7da1c68078a5d1bdbfbbe0d65c699e0f91ac7a200a0136783543');
    });

    it('signs a query by its parameters in order, whatever order they are sent in', () => {
        const headers: Record<string, string> = S3SignatureUtilities.resolveHeaders({
            method: 'GET',
            url: new URL('https://examplebucket.s3.amazonaws.com/?prefix=J&max-keys=2'),
            headers: {},
            payloadHash: emptyHash,
            accessKeyId,
            secretAccessKey,
            region: 'us-east-1',
            date
        });

        expect(headers['authorization']).toContain('Signature=34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7');
    });

    it('encodes what the signature counts as reserved', () => {
        expect(S3SignatureUtilities.encode('a b/c!(d)*e\'f~g')).toBe('a%20b%2Fc%21%28d%29%2Ae%27f~g');
    });
});