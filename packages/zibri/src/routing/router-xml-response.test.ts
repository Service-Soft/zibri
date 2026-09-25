import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { Body } from './decorators/body.decorator';
import { Controller } from './decorators/controller.decorator';
import { Delete } from './decorators/delete.decorator';
import { Get } from './decorators/get.decorator';
import { Post } from './decorators/post.decorator';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { XmlUtilities } from '../document/xml.utilities';
import { Property } from '../entity/decorators/property.decorator';
import { HttpStatus } from '../http/http-status.enum';
import { KnownHeader } from '../http/known-header.enum';
import { MimeType } from '../http/mime-type.enum';
import { Response } from '../open-api/decorators/response.decorator';
import type { PaginationResult } from '../open-api/pagination-result.model';
import { XmlAttribute } from '../parsing/xml/xml-attribute.decorator';
import { XmlElement } from '../parsing/xml/xml-element.decorator';
import { XmlRoot } from '../parsing/xml/xml-root.decorator';

class OrderLine {
    @Property.string()
    name!: string;
}

@XmlRoot({ name: 'Order', namespace: 'urn:example:orders' })
class Order {
    @XmlAttribute('id')
    @Property.string()
    orderId!: string;

    @XmlElement('Line')
    @Property.array({ items: { type: 'object', cls: () => OrderLine } })
    lines!: OrderLine[];
}

const order: Order = { orderId: '42', lines: [{ name: 'pen & paper' }, { name: 'ink' }] };

@Controller('/orders')
class OrderController {
    @Response.object(Order, { status: HttpStatus.CREATED, mimeTypes: [MimeType.JSON, MimeType.XML] })
    @Post()
    create(@Body(Order, { type: MimeType.XML }) created: Order): Order {
        return created;
    }

    @Response.object(Order, { mimeTypes: [MimeType.XML, MimeType.JSON] })
    @Get('/xml-first')
    findXmlFirst(): Order {
        return order;
    }

    @Response.paginated(Order, { mimeTypes: [MimeType.JSON, MimeType.XML] })
    @Get('/paginated')
    findPaginated(): PaginationResult<Order> {
        return { items: [order], totalAmount: 1 };
    }

    @Response.object(Order, { mimeTypes: [MimeType.JSON, MimeType.XML] })
    @Response.empty()
    @Get('/missing')
    findMissing(): Order | undefined {
        return undefined;
    }

    @Response.empty()
    @Delete('/:id')
    deleteById(): void {}

    @Response.object(Order, { mimeTypes: [MimeType.XML] })
    @Get('/broken')
    findBroken(): Partial<Order> {
        // less than the model it is declared as
        return { orderId: '42' };
    }
}

describe('Router - answering with xml', () => {
    let server: StartedTestServer;
    let baseUrl: string;
    let xml: string;

    beforeAll(async () => {
        server = await startTestServer({ controllers: [OrderController] });
        baseUrl = await server.start();
        xml = await XmlUtilities.generateFrom(Order, order);
    }, 25000);

    afterAll(async () => {
        await server.shutdown();
    }, 15000);

    /**
     * Sends the order as xml, accepting what is given.
     * @param accept - The accept header, if any.
     * @returns The response.
     */
    async function create(accept: string | undefined): Promise<globalThis.Response> {
        return await fetch(`${baseUrl}/orders`, {
            method: 'POST',
            headers: { [KnownHeader.CONTENT_TYPE]: MimeType.XML, ...accept == undefined ? {} : { [KnownHeader.ACCEPT]: accept } },
            body: xml
        });
    }

    it('answers with xml when the request accepts it, with the status the route declares', async () => {
        const res: globalThis.Response = await create(MimeType.XML);

        expect(res.status).toBe(HttpStatus.CREATED);
        expect(res.headers.get(KnownHeader.CONTENT_TYPE)).toContain(MimeType.XML);
        expect(res.headers.get(KnownHeader.VARY)?.toLowerCase()).toContain('accept');
        expect(await res.text()).toBe(xml);
    }, 15000);

    it('answers the same route with json when the request accepts that', async () => {
        const res: globalThis.Response = await create(MimeType.JSON);

        expect(res.status).toBe(HttpStatus.CREATED);
        expect(res.headers.get(KnownHeader.CONTENT_TYPE)).toContain(MimeType.JSON);
        expect(await res.json()).toEqual(order);
    }, 15000);

    it('answers with the first format the route names when the request names none', async () => {
        expect((await create(undefined)).headers.get(KnownHeader.CONTENT_TYPE)).toContain(MimeType.JSON);

        const xmlFirst: globalThis.Response = await fetch(`${baseUrl}/orders/xml-first`, { headers: { [KnownHeader.ACCEPT]: '*/*' } });
        expect(xmlFirst.headers.get(KnownHeader.CONTENT_TYPE)).toContain(MimeType.XML);
    }, 15000);

    it('answers a page with xml, as one element holding an element per item', async () => {
        const res: globalThis.Response = await fetch(`${baseUrl}/orders/paginated`, { headers: { [KnownHeader.ACCEPT]: MimeType.XML } });

        expect(res.status).toBe(HttpStatus.OK);
        expect(await res.text()).toBe([
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<PaginationResult>',
            '<items id="42"><Line><name>pen &#x26; paper</name></Line><Line><name>ink</name></Line></items>',
            '<totalAmount>1</totalAmount>',
            '</PaginationResult>'
        ].join(''));
    }, 15000);

    it('answers 406 when the request accepts neither', async () => {
        expect((await create(MimeType.CSV)).status).toBe(HttpStatus.NOT_ACCEPTABLE);
    }, 15000);

    it('answers 500 rather than a document that does not fit the model', async () => {
        const res: globalThis.Response = await fetch(`${baseUrl}/orders/broken`, { headers: { [KnownHeader.ACCEPT]: MimeType.XML } });

        expect(res.status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    }, 15000);

    it('answers an empty result with 204, whichever of the formats the request reads', async () => {
        const xml: globalThis.Response = await fetch(`${baseUrl}/orders/missing`, { headers: { [KnownHeader.ACCEPT]: MimeType.XML } });
        const json: globalThis.Response = await fetch(`${baseUrl}/orders/missing`, { headers: { [KnownHeader.ACCEPT]: MimeType.JSON } });

        expect(xml.status).toBe(HttpStatus.NO_CONTENT);
        expect(json.status).toBe(HttpStatus.NO_CONTENT);
    }, 15000);

    it('does not refuse a request reading xml on a route that only ever answers empty', async () => {
        const res: globalThis.Response = await fetch(`${baseUrl}/orders/42`, {
            method: 'DELETE',
            headers: { [KnownHeader.ACCEPT]: MimeType.XML }
        });

        expect(res.status).toBe(HttpStatus.NO_CONTENT);
    }, 15000);

    // last in the file on purpose: it replaces the running application with one that refuses to start,
    // and nothing after it would be looking at the server the tests above started
    it('refuses to start a route whose responses answer in different formats', async () => {
        @Controller('/mismatched-orders', { allowOrphan: true })
        class MismatchedOrderController {
            // json alone, next to an empty response answering json and xml
            @Response.object(Order)
            @Response.empty()
            @Get()
            find(): Order | undefined {
                return undefined;
            }
        }

        await expect(server.reInit({ controllers: [MismatchedOrderController] })).rejects.toThrow(/written in different formats/);
    }, 60000);
});