import { Property } from '../entity/decorators/property.decorator.ts';
import { HttpStatus } from '../http/http-status.enum.ts';
import { TranslatedString } from '../localization/models/translated-string.model.ts';
import { XmlElement } from '../parsing/xml/xml-element.decorator.ts';
import { XmlRoot } from '../parsing/xml/xml-root.decorator.ts';

/**
 * What a refused or failed request answers with, when it answers in json or in xml.
 */
@XmlRoot({ name: 'Error' })
export class ErrorResponseBody {
    /**
     * The http status of the response.
     */
    @Property.number({ format: 'integer' })
    status!: HttpStatus;

    /**
     * The name of the error, eg. `NotFoundError`.
     */
    @Property.string()
    name!: string;

    /**
     * The whole message, as one string.
     */
    @Property.string()
    message!: string;

    /**
     * The message, split into the paragraphs it was written as.
     */
    @XmlElement('paragraph')
    @Property.array({ items: { type: 'string' } })
    paragraphs!: TranslatedString[];

    /**
     * The trace this request belongs to, for finding the log lines it caused.
     */
    @Property.string({ required: false })
    traceId: string | undefined;
}