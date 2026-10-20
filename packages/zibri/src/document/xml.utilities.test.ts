import assert from 'assert';

import { beforeAll, describe, expect, it } from 'vitest';

import { XmlUtilities } from './xml.utilities.ts';
import { initDiContainer } from '../di/init-di-container.function.ts';
import { Property } from '../entity/decorators/property.decorator.ts';
import { OneOf } from '../entity/models/one-of.model.ts';
import { ValidationError } from '../error-handling/errors/validation.error.ts';
import { InternalError } from '../error-handling/internal-error.model.ts';
import { GlobalRegistry } from '../global/global-registry.ts';
import { MimeType } from '../http/mime-type.enum.ts';
import { XmlAttribute } from '../parsing/xml/xml-attribute.decorator.ts';
import { XmlElement } from '../parsing/xml/xml-element.decorator.ts';
import { XmlMixed } from '../parsing/xml/xml-mixed.decorator.ts';
import { XmlNamespace } from '../parsing/xml/xml-namespace.decorator.ts';
import { XmlRoot } from '../parsing/xml/xml-root.decorator.ts';
import { XmlText } from '../parsing/xml/xml-text.decorator.ts';
import { XmlBodyParser } from '../parsing/xml/xml.body-parser.ts';
import { BodyMetadata } from '../routing/decorators/body-metadata.model.ts';
import { resolveBodyMetadata } from '../routing/resolve-body-metadata.function.ts';
import { Newable } from '../types/newable.type.ts';
import { BigNumber } from '../utilities/number.utilities.ts';
import { WebsocketRequest } from '../websocket/models/websocket-request.model.ts';

class CompletedPart {
    @Property.number({ format: 'integer' })
    PartNumber!: number;

    @Property.string()
    ETag!: string;
}

@XmlRoot({ namespace: 'http://s3.amazonaws.com/doc/2006-03-01/' })
class CompleteMultipartUpload {
    @XmlElement('Part')
    @Property.array({ items: { type: 'object', cls: () => CompletedPart } })
    parts!: CompletedPart[];
}

class Amount {
    @XmlAttribute('currencyID')
    @Property.string()
    currency!: string;

    @XmlText()
    @Property.number({ format: 'bignumber' })
    value!: BigNumber;
}

@XmlRoot({ name: 'Line' })
class InvoiceLine {
    @XmlAttribute()
    @Property.string()
    id!: string;

    @XmlElement('Note')
    @Property.string({ required: false })
    note?: string;

    @XmlElement('LineExtensionAmount')
    @Property.object({ cls: () => Amount })
    amount!: Amount;

    @XmlElement('IssueDate')
    @Property.date()
    issued!: Date;
}

class Placeholder {
    @XmlAttribute()
    @Property.string()
    id!: string;
}

class Greeting {
    @XmlAttribute('xml:space')
    @Property.string({ required: false })
    space?: string;

    @XmlMixed()
    @Property.array({ items: { type: 'oneOf', shapes: { text: { type: 'string' }, x: { type: 'object', cls: () => Placeholder } } } })
    parts!: OneOf<{ text: string, x: Placeholder }>[];
}

class Letter {
    @XmlElement('Greeting')
    @Property.array({ items: { type: 'object', cls: () => Greeting } })
    lines!: Greeting[];
}

const greeting: Greeting = {
    space: 'preserve',
    parts: [{ shape: 'text', value: 'Hello ' }, { shape: 'x', value: { id: 'name' } }, { shape: 'text', value: ' & welcome!' }]
};

@XmlNamespace('urn:example:header')
class Header {
    @Property.string()
    id!: string;
}

@XmlRoot({ namespace: 'urn:example:envelope', prefixes: { h: 'urn:example:header' } })
class Envelope {
    @Property.object({ cls: () => Header })
    header!: Header;

    @Property.string()
    body!: string;
}

@XmlRoot({ namespace: 'urn:example:envelope' })
class Unprefixed {
    @Property.object({ cls: () => Header })
    header!: Header;
}

class Batch {
    @Property.object({ cls: () => CompleteMultipartUpload })
    upload!: CompleteMultipartUpload;
}

class MixedWithElement {
    @XmlMixed()
    @Property.array({ items: { type: 'oneOf', shapes: { text: { type: 'string' }, x: { type: 'object', cls: () => Placeholder } } } })
    parts!: OneOf<{ text: string, x: Placeholder }>[];

    @Property.string()
    extra!: string;
}

const line: InvoiceLine = {
    id: 'a"1',
    note: 'nuts & <bolts>',
    amount: { currency: 'EUR', value: new BigNumber('1e21') },
    issued: new Date('2026-09-24T10:00:00.000Z')
};

/**
 * Reads a document back the way an xml body is read.
 * @param cls - The model the document is read as.
 * @param xml - The document.
 * @returns What the handler would get.
 */
function readBack(cls: Newable<unknown>, xml: string): unknown {
    const metadata: BodyMetadata = resolveBodyMetadata({ type: MimeType.XML, modelClass: cls }, 0);
    assert(metadata.type === MimeType.XML);
    const request: WebsocketRequest = new WebsocketRequest();
    request.body = xml;
    return new XmlBodyParser().parseFromWebsocketRequest(request, metadata);
}

beforeAll(() => {
    initDiContainer();
    // validation problems are translated, which needs an application that exists
    GlobalRegistry.markAppAsCreated();
});

describe('XmlUtilities.generateFrom', () => {
    it('writes the root in its namespace, and a list as its element repeated', async () => {
        const xml: string = await XmlUtilities.generateFrom(CompleteMultipartUpload, {
            parts: [{ PartNumber: 1, ETag: '"a1"' }, { PartNumber: 2, ETag: '"b2"' }]
        });

        expect(xml).toBe([
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<CompleteMultipartUpload xmlns="http://s3.amazonaws.com/doc/2006-03-01/">',
            '<Part><PartNumber>1</PartNumber><ETag>"a1"</ETag></Part>',
            '<Part><PartNumber>2</PartNumber><ETag>"b2"</ETag></Part>',
            '</CompleteMultipartUpload>'
        ].join(''));
    });

    it('writes attributes, text and renamed elements in declaration order, with what xml reserves escaped', async () => {
        expect(await XmlUtilities.generateFrom(InvoiceLine, line)).toBe([
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<Line id="a&#x22;1">',
            '<Note>nuts &#x26; &#x3c;bolts&#x3e;</Note>',
            '<LineExtensionAmount currencyID="EUR">1000000000000000000000</LineExtensionAmount>',
            '<IssueDate>2026-09-24T10:00:00.000Z</IssueDate>',
            '</Line>'
        ].join(''));
    });

    it('leaves out a property without a value', async () => {
        const xml: string = await XmlUtilities.generateFrom(InvoiceLine, { ...line, note: undefined });

        expect(xml).not.toContain('Note');
    });

    it('writes what the body parser reads back as the same data', async () => {
        const upload: CompleteMultipartUpload = { parts: [{ PartNumber: 1, ETag: '"a1"' }, { PartNumber: 2, ETag: '"b2"' }] };
        const withBreaks: InvoiceLine = { ...line, id: 'tab\tline\nreturn\r', note: 'first\r\nsecond' };

        expect(readBack(CompleteMultipartUpload, await XmlUtilities.generateFrom(CompleteMultipartUpload, upload))).toEqual(upload);
        expect(readBack(InvoiceLine, await XmlUtilities.generateFrom(InvoiceLine, withBreaks))).toEqual(withBreaks);
    });

    it('refuses data that does not fit the model, as a mistake of the application', async () => {
        const invalid: CompleteMultipartUpload = { parts: [{ PartNumber: 1.5, ETag: '"a1"' }] };

        const generated: Promise<string> = XmlUtilities.generateFrom(CompleteMultipartUpload, invalid);

        await expect(generated).rejects.toThrow(InternalError);
        await expect(generated).rejects.toHaveProperty('cause', expect.any(ValidationError));
    });

    it('refuses text with a character xml cannot hold', async () => {
        await expect(XmlUtilities.generateFrom(InvoiceLine, { ...line, note: 'bell \u0007' })).rejects.toThrow(InternalError);
    });

    it('writes every character xml can hold, up to the edges of each range', async () => {
        // a fullwidth letter, as japanese text uses them, between the edges of the range above the
        // surrogates, and one character beyond the basic plane
        const note: string = '퟿  Ａ � \u{10000} \u{10FFFF}';

        expect(await XmlUtilities.generateFrom(InvoiceLine, { ...line, note })).toContain(`<Note>${note}</Note>`);
    });

    it('refuses a lone surrogate and the noncharacters at the end of the basic plane', async () => {
        for (const note of ['half \uD800 of a pair', '￾', '￿', 'form feed \f']) {
            await expect(XmlUtilities.generateFrom(InvoiceLine, { ...line, note })).rejects.toThrow(InternalError);
        }
    });

    it('takes the data as the type of the model', async () => {
        // @ts-expect-error a part number is a number
        await expect(XmlUtilities.generateFrom(CompletedPart, { PartNumber: '1', ETag: '"a1"' })).rejects.toThrow(InternalError);
    });

    it('writes mixed content in order, each model part as the element its shape names', async () => {
        expect(await XmlUtilities.generateFrom(Greeting, greeting)).toBe(
            '<?xml version="1.0" encoding="UTF-8"?><Greeting xml:space="preserve">Hello <x id="name"/> &#x26; welcome!</Greeting>'
        );
    });

    it('indents only between elements, never inside text', async () => {
        expect(await XmlUtilities.generateFrom(Letter, { lines: [greeting, { space: 'preserve', parts: [{ shape: 'text', value: ' bye ' }] }] }, { indent: true })).toBe([
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<Letter>',
            '  <Greeting xml:space="preserve">Hello <x id="name"/> &#x26; welcome!</Greeting>',
            '  <Greeting xml:space="preserve"> bye </Greeting>',
            '</Letter>'
        ].join('\n'));
    });

    it('writes a namespace with the prefix the root declares, and the root\'s own without one when it has none', async () => {
        expect(await XmlUtilities.generateFrom(Envelope, { header: { id: '1' }, body: 'text' })).toBe([
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<Envelope xmlns="urn:example:envelope" xmlns:h="urn:example:header">',
            '<header><h:id>1</h:id></header>',
            '<body>text</body>',
            '</Envelope>'
        ].join(''));
    });

    it('writes a model inside another document in that document\'s namespace, whatever its own root says', async () => {
        // like a page of items: the item model is the root of its own documents, not of this one
        expect(await XmlUtilities.generateFrom(Batch, { upload: { parts: [{ PartNumber: 1, ETag: '"a1"' }] } })).toBe(
            '<?xml version="1.0" encoding="UTF-8"?><Batch><upload><Part><PartNumber>1</PartNumber><ETag>"a1"</ETag></Part></upload></Batch>'
        );
    });

    it('refuses a namespace the root declares no prefix for, naming it', async () => {
        await expect(XmlUtilities.generateFrom(Unprefixed, { header: { id: '1' } })).rejects.toThrow('urn:example:header');
    });

    it('refuses a model whose mixed content sits next to a child element', async () => {
        await expect(XmlUtilities.generateFrom(MixedWithElement, { parts: [], extra: 'x' })).rejects.toThrow('@XmlMixed');
    });
});

describe('XmlUtilities.parseFrom', () => {
    it('reads what generateFrom writes back as the same data, mixed content and namespaces included', async () => {
        const letter: Letter = { lines: [greeting] };

        expect(await XmlUtilities.parseFrom(Letter, await XmlUtilities.generateFrom(Letter, letter, { indent: true }))).toEqual(letter);
        expect(await XmlUtilities.parseFrom(Envelope, await XmlUtilities.generateFrom(Envelope, { header: { id: '1' }, body: 'text' })))
            .toEqual({ header: { id: '1' }, body: 'text' });
    });

    it('reads a document written with other prefixes, matching elements by their name', async () => {
        const xml: string = '<e:Envelope xmlns:e="urn:example:envelope" xmlns:x="urn:example:header"><e:header><x:id>1</x:id></e:header><e:body>text</e:body></e:Envelope>';

        expect(await XmlUtilities.parseFrom(Envelope, xml)).toEqual({ header: { id: '1' }, body: 'text' });
    });

    it('refuses values that break the rules of the model with a validation error', async () => {
        await expect(XmlUtilities.parseFrom(CompletedPart, '<CompletedPart><PartNumber>1.5</PartNumber><ETag>a</ETag></CompletedPart>'))
            .rejects.toThrow(ValidationError);
    });

    it('refuses a document that is not well formed', async () => {
        await expect(XmlUtilities.parseFrom(CompletedPart, '<CompletedPart><PartNumber>1</CompletedPart>')).rejects.toThrow(InternalError);
    });

    it('refuses an element that is not part of mixed content', async () => {
        await expect(XmlUtilities.parseFrom(Greeting, '<Greeting>Hello <y/></Greeting>')).rejects.toThrow(InternalError);
    });

    // evaluation/02-http-runtime-core M21: each element was added to its group by copying the group,
    // which took 13 s for these 50,000 - read before validation refuses them, so anyone could send them
    it('reads many elements of one name in time linear in how many there are', async () => {
        const xml: string = `<CompletedPart>${'<a/>'.repeat(50_000)}</CompletedPart>`;
        const startedAt: number = Date.now();

        await expect(XmlUtilities.parseFrom(CompletedPart, xml)).rejects.toThrow(ValidationError);

        expect(Date.now() - startedAt).toBeLessThan(1000);
    }, 30000);
});

describe('XmlUtilities.resolveXmlString', () => {
    it('hands a well formed document back as it is', () => {
        const xml: string = '<?xml version="1.0"?><a b="c">d</a>';

        expect(XmlUtilities.resolveXmlString(xml)).toBe(xml);
    });

    it('refuses text that is not a well formed document', () => {
        expect(() => XmlUtilities.resolveXmlString('<a><b></a>')).toThrow(InternalError);
        expect(() => XmlUtilities.resolveXmlString('just text')).toThrow(InternalError);
    });
});

describe('@XmlMixed', () => {
    it('refuses a second text of the element', () => {
        expect(() => {
            class TwoTexts {
                @XmlText()
                @Property.string()
                text!: string;

                @XmlMixed()
                @Property.array({ items: { type: 'oneOf', shapes: { text: { type: 'string' }, x: { type: 'object', cls: () => Placeholder } } } })
                parts!: OneOf<{ text: string, x: Placeholder }>[];
            }
            return TwoTexts;
        }).toThrow('only one text');
    });
});