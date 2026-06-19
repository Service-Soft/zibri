import { createServer, Server } from 'http';
import { AddressInfo } from 'net';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import express from 'express';
import NodeFormData from 'form-data';

import { HttpClientResponse } from './http-client-response.model';
import { HttpClientInterface } from './http-client.interface';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { initDiContainer } from '../di/init-di-container.function';
import { inject } from '../di/inject.function';
import { Property } from '../entity/decorators/property.decorator';
import { KnownHeader } from '../http/known-header.enum';
import { MimeType } from '../http/mime-type.enum';
import { FormDataBodyParser } from '../parsing/form-data/form-data.body-parser';
import { FormData } from '../parsing/form-data/form-data.model';
import { JsonBodyParser } from '../parsing/json/json.body-parser';
import { Parser } from '../parsing/parser';
import { JsonUtilities } from '../utilities/json.utilities';

class Item {
    @Property.string()
    name!: string;

    @Property.number()
    value!: number;
}

class FormDataItem {
    @Property.file({ allowedMimeTypes: [MimeType.JSON] })
    file!: File;

    @Property.array({ items: { type: 'file' }, totalMaxSize: '5mb' })
    files!: File[];
}

describe('post', () => {
    let server: Server;
    let baseUrl: string;
    let http: HttpClientInterface;

    beforeAll(async () => {
        initDiContainer();
        // create mock api
        const app: express.Express = express();
        app.post('/valid', (_req, res) => {
            res.json({ name: 'ok', value: 42 });
        });
        app.post('/invalid', (_req, res) => {
            res.json({ name: 'broken', value: 'not-a-number' });
        });
        app.post('/form-data/valid', (_req, res) => {
            const form: NodeFormData = new NodeFormData();
            form.append('file', JsonUtilities.stringify({ hello: 'world' }), {
                filename: 'payload.json',
                contentType: MimeType.JSON
            });
            form.append('files', JsonUtilities.stringify({ hello: 'world2' }), {
                filename: 'files.json',
                contentType: MimeType.JSON
            });
            form.append('files', JsonUtilities.stringify({ hello: 'world3' }), {
                filename: 'files.json',
                contentType: MimeType.JSON
            });
            const headers: NodeFormData.Headers = form.getHeaders();
            res.setHeader(KnownHeader.CONTENT_TYPE, headers['content-type'] as string);
            form.pipe(res);
        });
        app.post('/form-data/invalid', (_req, res) => {
            const form: NodeFormData = new NodeFormData();
            form.append('file', JsonUtilities.stringify({ hello: 'world' }), {
                filename: 'payload.json',
                contentType: MimeType.JSON
            });
            const headers: NodeFormData.Headers = form.getHeaders();
            res.setHeader(KnownHeader.CONTENT_TYPE, headers['content-type'] as string);
            form.pipe(res);
        });
        server = createServer(app);
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

        baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

        const parser: Parser = inject(ZIBRI_DI_TOKENS.PARSER) as Parser;
        parser['bodyParsers'].push(inject(JsonBodyParser), inject(FormDataBodyParser));
        http = inject(ZIBRI_DI_TOKENS.HTTP_CLIENT);
    });

    afterAll(async () => {
        await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
    });

    it('valid response should pass validation', async () => {
        const res: HttpClientResponse<Item> = await http.post(`${baseUrl}/valid`, undefined, { responseBody: Item });
        expect(res).toBeDefined();
        expect(res.body.name).toBe('ok');
        expect(res.body.value).toBe(42);
    });

    it('invalid response should trigger validation error', async () => {
        await expect(http.post(`${baseUrl}/invalid`, undefined, { responseBody: Item })).rejects.toThrow();
    });

    it('valid form data response should pass validation', async () => {
        const res: HttpClientResponse<FormData<FormDataItem>> = await http.post(
            `${baseUrl}/form-data/valid`,
            undefined,
            {
                responseBody: {
                    modelClass: FormDataItem,
                    type: MimeType.FORM_DATA
                }
            }
        );
        expect(res).toBeDefined();
        expect(res.body.value.file.size).toBe(17);
        expect(res.body.value.files.length).toBe(2);
    });

    it('invalid form data response should trigger validation error', async () => {
        await expect(http.post(`${baseUrl}/form-data/invalid`, undefined, { responseBody: { modelClass: FormDataItem, type: MimeType.FORM_DATA } })).rejects.toThrow();
    });
});