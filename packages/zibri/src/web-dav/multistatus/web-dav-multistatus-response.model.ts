import { Property } from '../../entity/decorators/property.decorator';
import { XmlElement } from '../../parsing/xml/xml-element.decorator';
import { WebDavPropstat } from './web-dav-propstat.model';

/**
 * What a multistatus answer says of one resource.
 */
export class WebDavMultistatusResponse {
    /**
     * Where the resource is, as a path or a url, encoded.
     */
    @Property.string()
    href!: string;

    /**
     * Its properties, grouped by their status.
     */
    @XmlElement('propstat')
    @Property.array({ required: false, items: { type: 'object', cls: () => WebDavPropstat, allowAdditionalProperties: true } })
    propstats?: WebDavPropstat[];

    /**
     * The status of the resource as a whole, which a server answers in place of its properties, such as for one it
     * could not read.
     */
    @Property.string({ required: false })
    status?: string;
}
