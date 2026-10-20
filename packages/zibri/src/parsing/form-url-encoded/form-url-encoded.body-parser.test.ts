import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createInMemoryDataSource } from 'zibri-testing';

import { defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function.ts';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function.ts';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default.ts';
import { inject } from '../../di/inject.function.ts';
import { Property } from '../../entity/decorators/property.decorator.ts';
import { KnownHeader } from '../../http/known-header.enum.ts';
import { MimeType } from '../../http/mime-type.enum.ts';
import { HttpClientResponse } from '../../http-client/http-client-response.model.ts';
import { Response as RouteResponse } from '../../open-api/decorators/response.decorator.ts';
import { Body } from '../../routing/decorators/body.decorator.ts';
import { Controller } from '../../routing/decorators/controller.decorator.ts';
import { Post } from '../../routing/decorators/post.decorator.ts';
import { JsonUtilities } from '../../utilities/json.utilities.ts';

class SignUpForm {
    @Property.string()
    name!: string;

    @Property.number()
    age!: number;

    @Property.boolean()
    newsletter!: boolean;

    @Property.date({ required: false })
    birthday?: Date;

    @Property.array({ items: { type: 'number' }, required: false })
    favorites?: number[];
}

class SearchByName {
    @Property.string()
    name!: string;
}

class SearchById {
    @Property.number()
    id!: number;
}

@Controller('/forms')
class FormController {
    @RouteResponse.object(SignUpForm)
    @Post('/sign-up')
    signUp(
        @Body(SignUpForm, { type: MimeType.FORM_URL_ENCODED })
        form: SignUpForm
    ): SignUpForm {
        return form;
    }

    @RouteResponse.object(SearchByName)
    @Post('/open')
    open(
        @Body(SearchByName, { type: MimeType.FORM_URL_ENCODED, allowAdditionalProperties: true })
        form: SearchByName
    ): SearchByName {
        return form;
    }

    @RouteResponse.object(SearchByName)
    @Post('/tiny')
    tiny(
        @Body(SearchByName, { type: MimeType.FORM_URL_ENCODED, maxSize: '10b' })
        form: SearchByName
    ): SearchByName {
        return form;
    }

    @RouteResponse.object(SearchById)
    @Post('/search')
    search(
        @Body.oneOf({ type: MimeType.FORM_URL_ENCODED, shapes: [{ type: 'object', cls: () => SearchById }, { type: 'object', cls: () => SearchByName }] })
        form: SearchById | SearchByName
    ): SearchById | SearchByName {
        return form;
    }
}

describe('FormUrlEncodedBodyParser', () => {
    let server: StartedTestServer;
    let baseUrl: string;

    beforeAll(async () => {
        server = await startTestServer({
            dataSources: [createInMemoryDataSource({ entities: defaultTestServerEntities })],
            controllers: [FormController]
        });
        baseUrl = await server.start();
    }, 15000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    /**
     * Posts a form the way a browser does.
     * @param path - The route.
     * @param form - The fields, in order.
     * @returns The response.
     */
    async function post(path: string, form: [string, string][]): Promise<Response> {
        return await fetch(`${baseUrl}/forms${path}`, {
            method: 'POST',
            headers: { [KnownHeader.CONTENT_TYPE]: MimeType.FORM_URL_ENCODED },
            body: new URLSearchParams(form).toString()
        });
    }

    it('reads each field as the type of its property', async () => {
        const res: Response = await post('/sign-up', [['name', 'Ada Lovelace'], ['age', '36'], ['newsletter', 'true'], ['birthday', '1815-12-10T00:00:00.000Z']]);

        expect(res.status).toBe(200);
        expect(await res.json()).toStrictEqual({ name: 'Ada Lovelace', age: 36, newsletter: true, birthday: '1815-12-10T00:00:00.000Z' });
    });

    it('reads a field sent once per item as a list of that item type', async () => {
        const res: Response = await post('/sign-up', [['name', 'Ada'], ['age', '36'], ['newsletter', 'false'], ['favorites', '3'], ['favorites', '7.5']]);

        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({ favorites: [3, 7.5] });
    });

    it('reads a list field sent once as a list of one item', async () => {
        // what a form with a single item checked sends, and what an OAuth2 client sends for one resource
        const res: Response = await post('/sign-up', [['name', 'Ada'], ['age', '36'], ['newsletter', 'false'], ['favorites', '3']]);

        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({ favorites: [3] });
    });

    it('answers 400 for a field the model does not declare', async () => {
        const res: Response = await post('/sign-up', [['name', 'Ada'], ['age', '36'], ['newsletter', 'true'], ['admin', 'true']]);

        expect(res.status).toBe(400);
    });

    it('answers 400 for a field named after a member every object has, rather than reading it as a property', async () => {
        const proto: Response = await post('/sign-up', [['name', 'Ada'], ['age', '36'], ['newsletter', 'true'], ['__proto__', 'x']]);
        const constructor: Response = await post('/sign-up', [['name', 'Ada'], ['age', '36'], ['newsletter', 'true'], ['constructor', 'x']]);

        expect(proto.status).toBe(400);
        expect(constructor.status).toBe(400);
    });

    it('keeps the fields the model does not declare where it allows them', async () => {
        const res: Response = await post('/open', [['name', 'Ada'], ['session_state', 'abc']]);

        expect(res.status).toBe(200);
    });

    it('answers 400 for a value its property cannot hold', async () => {
        const res: Response = await post('/sign-up', [['name', 'Ada'], ['age', 'thirty-six'], ['newsletter', 'true']]);

        expect(res.status).toBe(400);
    });

    it('answers 413 for a form larger than the body may be', async () => {
        const res: Response = await post('/tiny', [['name', 'a name longer than ten bytes']]);

        expect(res.status).toBe(413);
    });

    it('reads a form that can be one of several classes as the first it fits', async () => {
        const byId: Response = await post('/search', [['id', '42']]);
        const byName: Response = await post('/search', [['name', 'Ada']]);

        expect(await byId.json()).toStrictEqual({ id: 42 });
        expect(await byName.json()).toStrictEqual({ name: 'Ada' });
    });

    it('answers 415 for a json body sent to a route that takes a form', async () => {
        const res: Response = await fetch(`${baseUrl}/forms/sign-up`, {
            method: 'POST',
            headers: { [KnownHeader.CONTENT_TYPE]: MimeType.JSON },
            body: JsonUtilities.stringify({ name: 'Ada', age: 36, newsletter: true })
        });

        expect(res.status).toBe(415);
    });

    it('reads a response the http client receives as a form into its model', async () => {
        const answering: Server = createServer((_, res) => {
            res.writeHead(200, { [KnownHeader.CONTENT_TYPE]: MimeType.FORM_URL_ENCODED });
            res.end('id=7');
        });
        await new Promise<void>(resolve => answering.listen(0, '127.0.0.1', resolve));
        const address: AddressInfo | string | null = answering.address();
        try {
            if (address == undefined || typeof address === 'string') {
                throw new Error('The server listens at no port');
            }

            const res: HttpClientResponse<SearchById> = await inject(ZIBRI_DI_TOKENS.HTTP_CLIENT).get(
                `http://127.0.0.1:${address.port}/`,
                { responseBody: { type: MimeType.FORM_URL_ENCODED, modelClass: SearchById } }
            );

            expect(res.body).toStrictEqual({ id: 7 });
        }
        finally {
            await new Promise(resolve => answering.close(resolve));
        }
    });
});