import assert from 'assert';

import { beforeAll, describe, expect, it } from '@jest/globals';

import { XmlAttribute } from './xml-attribute.decorator';
import { XmlText } from './xml-text.decorator';
import { XmlBodyParser } from './xml.body-parser';
import { initDiContainer } from '../../di/init-di-container.function';
import { Property } from '../../entity/decorators/property.decorator';
import { BadRequestError } from '../../error-handling/errors/bad-request.error';
import { InternalError } from '../../error-handling/internal-error.model';
import { GlobalRegistry } from '../../global/global-registry';
import { MimeType } from '../../http/mime-type.enum';
import { HttpClientResponse } from '../../http-client/http-client-response.model';
import { BodyMetadata } from '../../routing/decorators/body-metadata.model';
import { resolveBodyMetadata } from '../../routing/resolve-body-metadata.function';
import { Newable } from '../../types/newable.type';
import { ValidationProblem } from '../../validation/validation-problem.model';
import { ValidationService } from '../../validation/validation.service';
import { WebsocketRequest } from '../../websocket/models/websocket-request.model';

/**
 * What a body turned into once it was read and checked.
 */
type Received = {
    /**
     * The body as the handler would get it.
     */
    value: unknown,
    /**
     * What validation found wrong with it.
     */
    problems: ValidationProblem[]
};

/**
 * Reads an xml body the way a websocket message is read: parsed by the xml body parser, then validated.
 * @param cls - The model the body is declared as.
 * @param body - What the caller sent.
 * @returns The value the handler would get, and what validation reported.
 */
async function receive(cls: Newable<unknown>, body: unknown): Promise<Received> {
    const metadata: BodyMetadata = resolveBodyMetadata({ type: MimeType.XML, modelClass: cls }, 0);
    assert(metadata.type === MimeType.XML);
    const request: WebsocketRequest = new WebsocketRequest();
    request.body = body;
    const value: unknown = new XmlBodyParser().parseFromWebsocketRequest(request, metadata);
    const problems: ValidationProblem[] = await new ValidationService().getBodyValidationProblems(value, metadata);
    return { value, problems };
}

class ListedObject {
    @Property.string()
    Key!: string;

    @Property.number({ format: 'integer' })
    Size!: number;

    @Property.date()
    LastModified!: Date;
}

class ListBucketResult {
    @Property.string()
    Name!: string;

    @Property.boolean()
    IsTruncated!: boolean;

    @Property.array({ items: { type: 'object', cls: () => ListedObject }, required: false })
    Contents?: ListedObject[];
}

class Price {
    @XmlAttribute()
    @Property.string()
    currency!: string;

    @XmlText()
    @Property.number()
    amount!: number;
}

class Item {
    @Property.string()
    name!: string;

    @Property.object({ cls: () => Price })
    Price!: Price;
}

const listing: string = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">',
    '    <Name>backups</Name>',
    '    <IsTruncated>false</IsTruncated>',
    '    <Contents>',
    '        <Key>daily &amp; weekly/metadata.json</Key>',
    '        <Size>42</Size>',
    '        <LastModified>2026-09-24T10:00:00.000Z</LastModified>',
    '    </Contents>',
    '</ListBucketResult>'
].join('\n');

beforeAll(() => {
    initDiContainer();
    // validation problems are translated, which needs an application that exists
    GlobalRegistry.markAppAsCreated();
});

describe('XmlBodyParser', () => {
    it('reads a document into the model, with its text decoded and its values typed', async () => {
        await expect(receive(ListBucketResult, listing)).resolves.toEqual({
            value: {
                Name: 'backups',
                IsTruncated: false,
                Contents: [{ Key: 'daily & weekly/metadata.json', Size: 42, LastModified: new Date('2026-09-24T10:00:00.000Z') }]
            },
            problems: []
        });
    });

    it('reads every repeated element into a list property', async () => {
        const two: string = listing.replace(
            '</ListBucketResult>',
            '<Contents><Key>b</Key><Size>1</Size><LastModified>2026-09-25T10:00:00.000Z</LastModified></Contents></ListBucketResult>'
        );

        const { value, problems } = await receive(ListBucketResult, two);

        expect(problems).toEqual([]);
        expect(value).toEqual(expect.objectContaining({ Contents: [expect.objectContaining({ Size: 42 }), expect.objectContaining({ Key: 'b' })] }));
    });

    it('reads a list property that has no elements as absent', async () => {
        const empty: string = '<ListBucketResult><Name>backups</Name><IsTruncated>false</IsTruncated></ListBucketResult>';

        await expect(receive(ListBucketResult, empty)).resolves.toEqual({
            value: { Name: 'backups', IsTruncated: false },
            problems: []
        });
    });

    it('reads attributes and the element\'s own text into the properties marked for them', async () => {
        await expect(receive(Item, '<Item><name>pen</name><Price currency="EUR">12.50</Price></Item>')).resolves.toEqual({
            value: { name: 'pen', Price: { currency: 'EUR', amount: 12.5 } },
            problems: []
        });
    });

    it('reports a missing attribute like a missing property', async () => {
        const { problems } = await receive(Item, '<Item><name>pen</name><Price>12.50</Price></Item>');

        expect(problems).toEqual([expect.objectContaining({ key: 'Price.currency' })]);
    });

    it('reports an element the model does not declare like an unknown property', async () => {
        const { problems } = await receive(Item, '<Item><name>pen</name><color>blue</color><Price currency="EUR">1</Price></Item>');

        expect(problems).toEqual([expect.objectContaining({ key: 'color' })]);
    });

    it('reads an element named __proto__ as an unknown key, rather than as the prototype of the body', async () => {
        const polluting: string = '<Item><__proto__><name>pen</name></__proto__><Price currency="EUR">1</Price></Item>';

        const { value, problems } = await receive(Item, polluting);

        expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
        expect(problems).toEqual(expect.arrayContaining([
            expect.objectContaining({ key: 'name' }),
            expect.objectContaining({ key: '__proto__' })
        ]));
    });

    it('answers 400 for an element named like a property that is read from an attribute', async () => {
        const both: string = '<Item><name>pen</name><Price currency="EUR"><currency>USD</currency>1</Price></Item>';

        await expect(receive(Item, both)).rejects.toThrow(BadRequestError);
    });

    it('answers 400 for a document that is not well formed', async () => {
        await expect(receive(Item, '<Item><name>pen</Item>')).rejects.toThrow(BadRequestError);
    });

    it('answers 400 for an element that carries the same attribute twice', async () => {
        const twice: string = '<Item><name>pen</name><Price currency="EUR" currency="USD">1</Price></Item>';

        await expect(receive(Item, twice)).rejects.toThrow(BadRequestError);
    });

    it('answers 400 for an entity the document declares itself, rather than expanding it', async () => {
        const declared: string = '<!DOCTYPE Item [<!ENTITY e "pen">]><Item><name>&e;</name><Price currency="EUR">1</Price></Item>';

        await expect(receive(Item, declared)).rejects.toThrow(BadRequestError);
    });

    it('reads an element and an attribute by their local name, whatever prefix the document gave them', async () => {
        const prefixed: string = '<i:Item xmlns:i="urn:item"><i:name>pen</i:name><i:Price i:currency="EUR">1</i:Price></i:Item>';

        await expect(receive(Item, prefixed)).resolves.toEqual({
            value: { name: 'pen', Price: { currency: 'EUR', amount: 1 } },
            problems: []
        });
    });

    it('answers 400 for a websocket body that is not text', async () => {
        await expect(receive(Item, { name: 'pen' })).rejects.toThrow(BadRequestError);
    });

    it('reads a http client response from its text', () => {
        const metadata: BodyMetadata = resolveBodyMetadata({ type: MimeType.XML, modelClass: ListBucketResult }, 0);
        assert(metadata.type === MimeType.XML);
        const res: HttpClientResponse = { status: 200, statusText: 'OK', headers: {}, rawBody: listing, body: undefined };

        expect(new XmlBodyParser().parseFromHttpClientResponse(res, metadata)).toEqual(expect.objectContaining({ Name: 'backups' }));
    });
});

describe('XmlText', () => {
    it('refuses a second property read from the same text', () => {
        expect(() => {
            class TwoTexts {
                @XmlText()
                @Property.string()
                first!: string;

                @XmlText()
                @Property.string()
                second!: string;
            }
            return TwoTexts;
        }).toThrow(InternalError);
    });
});