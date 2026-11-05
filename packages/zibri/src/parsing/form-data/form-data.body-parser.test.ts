import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { File } from './file.model';
import { FormData as ZibriFormData } from './form-data.model';
import { TestTimeouts } from '../../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
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

class AmountsDto {
    @Property.array({ items: { type: 'number' } })
    amounts!: number[];
}

@Controller('/upload')
class UploadController {
    @Post('/amounts')
    async amounts(
        @Body(AmountsDto, { type: MimeType.FORM_DATA })
        form: ZibriFormData<AmountsDto>
    ): Promise<{ amounts: number[] }> {
        await form.cleanup();
        return { amounts: form.value.amounts };
    }

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
        // parsing a body touches no store, so the in-memory one does
        server = await startTestServer({
            controllers: [UploadController],
            dataSources: [createInMemoryDataSource({ entities: defaultTestServerEntities, repositories: defaultTestServerRepositories })]
        });
        baseUrl = await server.start();
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server?.shutdown();
    }, TestTimeouts.inMemory.shutdown);

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

    // big enough that the refusal lands while the body is still arriving, the case that reset: the
    // parser destroyed the request stream, so the caller got an ECONNRESET it could not tell from a
    // dropped network, and retried
    it('answers a body far over the budget with 413 rather than resetting the connection', async () => {
        const form: FormData = new FormData();
        form.append('file', new Blob(['x'.repeat(4 * 1024 * 1024)], { type: 'text/plain' }), 'big.txt');

        const res: Response = await fetch(`${baseUrl}/upload/tiny-budget`, { method: 'POST', body: form });

        expect(res.status).toBe(413);
    }, 30000);

    // a byte counter is no guard against forty one-byte files, which weigh nothing: each opens a
    // write stream while it arrives, so enough of them is EMFILE and a process that can no longer
    // accept a socket, all under any size limit
    it('refuses a body carrying more files than it will hold open', async () => {
        const form: FormData = new FormData();
        form.append('label', 'many files');
        for (let i: number = 0; i < 40; i++) {
            form.append(`file-${i}`, new Blob(['x'], { type: 'text/plain' }), `f-${i}.txt`);
        }

        expect((await fetch(`${baseUrl}/upload`, { method: 'POST', body: form })).status).toBe(413);
    });

    // the same shape without touching the disk: parsing work that costs the server and weighs nothing
    it('refuses a body carrying more fields than it will parse', async () => {
        const form: FormData = new FormData();
        for (let i: number = 0; i < 600; i++) {
            form.append(`field-${i}`, 'x');
        }

        expect((await fetch(`${baseUrl}/upload`, { method: 'POST', body: form })).status).toBe(413);
    });

    it('answers 400 for a text field the model does not declare, rather than failing to handle it', async () => {
        const form: FormData = new FormData();
        form.append('label', 'hello');
        form.append('file', new Blob(['small content'], { type: 'text/plain' }), 'note.txt');
        form.append('somethingElse', 'not declared on UploadDto');

        const res: Response = await fetch(`${baseUrl}/upload`, { method: 'POST', body: form });

        // every field the client sent is put on the value, declared or not, and the parser then
        // read the property metadata for each of them without checking there was any. An extra
        // field is a request anybody can send, so that was a 500 on hostile input where the
        // validation layer already has an answer for it
        expect(res.status).toBe(400);
    });

    it('answers 400 for a file field the model does not declare, rather than failing to handle it', async () => {
        const form: FormData = new FormData();
        form.append('label', 'hello');
        form.append('file', new Blob(['small content'], { type: 'text/plain' }), 'note.txt');
        form.append('extraFile', new Blob(['more content'], { type: 'text/plain' }), 'extra.txt');

        const res: Response = await fetch(`${baseUrl}/upload`, { method: 'POST', body: form });

        expect(res.status).toBe(400);
    });

    it('answers 400 for a file field named after a member every object has, and keeps answering afterwards', async () => {
        // a part named `constructor` found `Object` under its name on a plain object, pushed to it,
        // and threw inside a stream listener where nothing caught it, so one request ended the process
        for (const name of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
            const form: FormData = new FormData();
            form.append('label', 'hello');
            form.append(name, new Blob(['x'], { type: 'text/plain' }), 'x.txt');

            const res: Response = await fetch(`${baseUrl}/upload`, { method: 'POST', body: form });

            expect(res.status).toBe(400);
        }

        const form: FormData = new FormData();
        form.append('label', 'still here');
        form.append('file', new Blob(['x'], { type: 'text/plain' }), 'note.txt');
        const after: Response = await fetch(`${baseUrl}/upload`, { method: 'POST', body: form });
        expect(after.status).toBe(200);
    });

    it('answers 400 for a text field named after a member every object has, rather than reading it as a property', async () => {
        for (const name of ['constructor', '__proto__']) {
            const form: FormData = new FormData();
            form.append('label', 'hello');
            form.append('file', new Blob(['x'], { type: 'text/plain' }), 'note.txt');
            form.append(name, 'x');

            const res: Response = await fetch(`${baseUrl}/upload`, { method: 'POST', body: form });

            // `__proto__` was dropped without a word, where every other undeclared field is reported
            expect(res.status).toBe(400);
        }
    });

    it('reads a field sent once per item as a list of that item type', async () => {
        const form: FormData = new FormData();
        form.append('amounts', '1');
        form.append('amounts', '2.5');

        const res: Response = await fetch(`${baseUrl}/upload/amounts`, { method: 'POST', body: form });

        // a repeated field was handed on as the texts it arrived as, so a list of numbers was a 400
        expect(res.status).toBe(200);
        expect(await res.json()).toStrictEqual({ amounts: [1, 2.5] });
    });

    it('answers 400 for a field sent as text and as a file, rather than failing to handle it', async () => {
        const form: FormData = new FormData();
        form.append('label', 'hello');
        form.append('file', 'not a file');
        form.append('file', new Blob(['small content'], { type: 'text/plain' }), 'note.txt');

        const res: Response = await fetch(`${baseUrl}/upload`, { method: 'POST', body: form });

        // was an InternalError, so any caller could make the application answer 500
        expect(res.status).toBe(400);
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