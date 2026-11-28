import { Property } from '../../entity/decorators/property.decorator';
import { XmlElement } from '../../parsing/xml/xml-element.decorator';
import { WebDavMultistatusResponse } from './web-dav-multistatus-response.model';

/**
 * The `multistatus` a WebDAV server answers a PROPFIND with (RFC 4918, section 14.16): one response per resource.
 */
export class WebDavMultistatus {
    /**
     * The resources.
     */
    @XmlElement('response')
    @Property.array({ required: false, items: { type: 'object', cls: () => WebDavMultistatusResponse, allowAdditionalProperties: true } })
    responses?: WebDavMultistatusResponse[];
}
