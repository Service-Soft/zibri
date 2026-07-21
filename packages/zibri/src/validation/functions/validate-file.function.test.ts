import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { validateFile } from './validate-file.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { PropertyMetadata } from '../../entity/decorators/property.decorator';
import { FilePropertyMetadata } from '../../entity/models/file-property-metadata.model';
import { MimeType } from '../../http/mime-type.enum';
import { File } from '../../parsing/form-data/file.model';
import { IsRequiredValidationProblem,
    MaxFileSizeValidationProblem,
    MimeTypeMismatchValidationProblem,
    TypeMismatchValidationProblem,
    ValidationProblem } from '../validation-problem.model';

function meta(overrides: Partial<FilePropertyMetadata> = {}): FilePropertyMetadata {
    return {
        required: true,
        type: 'file',
        description: undefined,
        allowedMimeTypes: 'all',
        maxSize: '5mb',
        exclude: false,
        excludeFromChangeSets: false,
        ...overrides
    };
}

function createFile(overrides: Partial<File> = {}): File {
    return new File({
        fieldname: 'file',
        originalname: 'test.pdf',
        mimetype: MimeType.PDF,
        size: 1024,
        destination: '/tmp',
        filename: 'test.pdf',
        path: '/tmp/test.pdf' as File['path'],
        ...overrides
    });
}

describe('validateFile', () => {
    let server: StartedTestServer;

    beforeAll(async () => {
        server = await startTestServer({});
    }, 15000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    it('returns no problems for a valid file within size and mime constraints', async () => {
        const problems: ValidationProblem[] = await validateFile('file', createFile(), meta(), undefined, undefined);
        expect(problems).toEqual([]);
    });

    it('throws an InternalError if the metadata type is not "file"', async () => {

        await expect(validateFile('file', createFile(), { type: 'string' } as PropertyMetadata, undefined, undefined)).rejects.toThrow();
    });

    it('returns IsRequiredValidationProblem when required and missing', async () => {
        const problems: ValidationProblem[] = await validateFile('file', undefined, meta({ required: true }), undefined, undefined);
        expect(problems).toHaveLength(1);
        expect(problems[0]).toBeInstanceOf(IsRequiredValidationProblem);
    });

    it('returns no problems when not required and missing', async () => {
        const problems: ValidationProblem[] = await validateFile('file', undefined, meta({ required: false }), undefined, undefined);
        expect(problems).toEqual([]);
    });

    it('returns TypeMismatchValidationProblem when the value is not a File instance', async () => {
        const problems: ValidationProblem[] = await validateFile('file', { not: 'a file' }, meta(), undefined, undefined);
        expect(problems).toHaveLength(1);
        expect(problems[0]).toBeInstanceOf(TypeMismatchValidationProblem);
    });

    describe('max size', () => {
        it('accepts a file exactly at the max size boundary (inclusive)', async () => {
            const oneKb: number = 1024;
            const problems: ValidationProblem[] = await validateFile(
                'file',
                createFile({ size: oneKb }),
                meta({ maxSize: '1kb' }),
                undefined,
                undefined
            );
            expect(problems).toEqual([]);
        });

        it('rejects a file larger than the max size', async () => {
            const problems: ValidationProblem[] = await validateFile(
                'file',
                createFile({ size: 1025 }),
                meta({ maxSize: '1kb' }),
                undefined,
                undefined
            );
            expect(problems).toHaveLength(1);
            expect(problems[0]).toBeInstanceOf(MaxFileSizeValidationProblem);
        });
    });

    describe('mime type', () => {
        it('bypasses the check when allowedMimeTypes is "all"', async () => {
            const problems: ValidationProblem[] = await validateFile(
                'file',
                createFile({ mimetype: 'application/x-anything' }),
                meta({ allowedMimeTypes: 'all' }),
                undefined,
                undefined
            );
            expect(problems).toEqual([]);
        });

        it('accepts a file whose mime type is in the allow-list', async () => {
            const problems: ValidationProblem[] = await validateFile(
                'file',
                createFile({ mimetype: MimeType.PDF }),
                meta({ allowedMimeTypes: [MimeType.PDF] }),
                undefined,
                undefined
            );
            expect(problems).toEqual([]);
        });

        it('rejects a file whose mime type is not in the allow-list', async () => {
            const problems: ValidationProblem[] = await validateFile(
                'file',
                createFile({ mimetype: MimeType.PNG }),
                meta({ allowedMimeTypes: [MimeType.PDF] }),
                undefined,
                undefined
            );
            expect(problems).toHaveLength(1);
            expect(problems[0]).toBeInstanceOf(MimeTypeMismatchValidationProblem);
        });
    });
});