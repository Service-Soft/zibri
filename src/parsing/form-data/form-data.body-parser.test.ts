import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { File } from './file.model';
import { FormData as ZibriFormData } from './form-data.model';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { Property } from '../../entity/decorators/property.decorator';
import { MimeType } from '../../http/mime-type.enum';
import { Body } from '../../routing/decorators/body.decorator';
import { Controller } from '../../routing/decorators/controller.decorator';
import { Post } from '../../routing/decorators/post.decorator';

class UploadDto {
    @Property.string()
    label!: string;

    @Property.file({ allowedMimeTypes: 'all', maxSize: '1kb' })
    file!: File;
}

@Controller('/upload')
class UploadController {
    @Post('/')
    async upload(
        @Body(UploadDto, { type: MimeType.FORM_DATA })
        form: ZibriFormData<UploadDto>
    ): Promise<{ label: string, filename: string, size: number }> {
        const res: { label: string, filename: string, size: number } = {
            label: form.value.label,
            filename: form.value.file.originalname,
            size: form.value.file.size
        };
        await form.cleanup();
        return res;
    }

    // a tiny overall body size budget, to exercise the stream-level (busboy) size guard distinctly
    // from the per-file @Property.file maxSize validation rule
    @Post('/tiny-budget')
    async tinyBudget(
        @Body(UploadDto, { type: MimeType.FORM_DATA, baseMaxSize: '10b' })
        form: ZibriFormData<UploadDto>
    ): Promise<{ label: string }> {
        const res: { label: string } = { label: form.value.label };
        await form.cleanup();
        return res;
    }
}

describe('FormDataBodyParser', () => {
    let server: StartedTestServer;
    let baseUrl: string;

    beforeAll(async () => {
        server = await startTestServer({ controllers: [UploadController] });
        baseUrl = await server.start();
    }, 15000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    it('parses a multipart form with a text field and a small file', async () => {
        const form: FormData = new FormData();
        form.append('label', 'hello');
        form.append('file', new Blob(['small content'], { type: 'text/plain' }), 'note.txt');

        const res: Response = await fetch(`${baseUrl}/upload`, { method: 'POST', body: form });

        expect(res.status).toBe(200);
        // eslint-disable-next-line typescript/no-unsafe-assignment
        const body: { label: string, filename: string, size: number } = await res.json();
        expect(body.label).toBe('hello');
        expect(body.filename).toBe('note.txt');
        expect(body.size).toBe('small content'.length);
    });

    it('rejects a file exceeding the per-property maxSize with a 400 validation error', async () => {
        const form: FormData = new FormData();
        form.append('label', 'too big');
        form.append('file', new Blob(['x'.repeat(2000)], { type: 'text/plain' }), 'big.txt');

        const res: Response = await fetch(`${baseUrl}/upload`, { method: 'POST', body: form });

        expect(res.status).toBe(400);
    });

    it('rejects a request exceeding the overall body size budget with a 413 while still streaming', async () => {
        const form: FormData = new FormData();
        form.append('label', 'x'.repeat(500));
        form.append('file', new Blob(['x'.repeat(500)], { type: 'text/plain' }), 'big.txt');

        const res: Response = await fetch(`${baseUrl}/upload/tiny-budget`, { method: 'POST', body: form });

        expect(res.status).toBe(413);
    });

    it('parses unicode filenames correctly', async () => {
        const form: FormData = new FormData();
        form.append('label', 'unicode');
        // eslint-disable-next-line cspell/spellchecker
        form.append('file', new Blob(['x']), 'ünïcödé-🎉.txt');

        const res: Response = await fetch(`${baseUrl}/upload`, { method: 'POST', body: form });

        expect(res.status).toBe(200);
        // eslint-disable-next-line typescript/no-unsafe-assignment
        const body: { filename: string } = await res.json();
        // eslint-disable-next-line cspell/spellchecker
        expect(body.filename).toBe('ünïcödé-🎉.txt');
    });
});