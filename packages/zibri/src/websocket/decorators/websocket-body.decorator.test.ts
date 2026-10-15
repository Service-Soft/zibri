import { describe, expect, it } from '@jest/globals';

import { WebsocketBody } from './websocket-body.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { fileSizeToBytes } from '../../entity/models/file-property-metadata.model';
import { MimeType } from '../../http/mime-type.enum';
import { BodyMetadata } from '../../routing/decorators/body-metadata.model';
import { resolveMaxBodySize } from '../../routing/decorators/body.decorator';
import { MetadataUtilities } from '../../utilities/metadata.utilities';

class Message {
    @Property.string()
    text!: string;
}

class Handlers {
    sized(@WebsocketBody(Message, { maxSize: '1kb' }) message: Message): Message {
        return message;
    }

    xml(@WebsocketBody(Message, { type: MimeType.XML }) message: Message): Message {
        return message;
    }

    // @ts-expect-error a websocket body is json or xml, so it cannot be form data
    formData(@WebsocketBody(Message, { type: MimeType.FORM_DATA }) message: Message): Message {
        return message;
    }
}

describe('WebsocketBody', () => {
    it('keeps a body within the size it was given', () => {
        const metadata: BodyMetadata | undefined = MetadataUtilities.getRouteBody(Handlers, 'sized');

        expect(metadata?.type).toBe(MimeType.JSON);
        expect(metadata?.type === MimeType.OCTET_STREAM || metadata == undefined ? undefined : resolveMaxBodySize(metadata).toString())
            .toBe(fileSizeToBytes('1kb').toString());
    });

    it('declares an xml body when asked to', () => {
        const metadata: BodyMetadata | undefined = MetadataUtilities.getRouteBody(Handlers, 'xml');

        expect(metadata?.type).toBe(MimeType.XML);
    });
});