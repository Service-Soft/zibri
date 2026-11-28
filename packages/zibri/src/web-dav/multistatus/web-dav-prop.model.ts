import { Property } from '../../entity/decorators/property.decorator';
import { XmlElement } from '../../parsing/xml/xml-element.decorator';
import { WebDavResourceType } from './web-dav-resource-type.model';

/**
 * The properties of a resource a WebDAV server answers a PROPFIND with, by their names in the `DAV:` namespace.
 * Any other property asked for stays on the object under its own name.
 */
export class WebDavProp {
    /**
     * Whether the resource is a folder.
     */
    @XmlElement('resourcetype')
    @Property.object({ required: false, cls: () => WebDavResourceType, allowAdditionalProperties: true })
    resourceType?: WebDavResourceType;

    /**
     * How many bytes a file holds, as text.
     */
    // text rather than a number: a property the server cannot give is answered as an empty element
    @XmlElement('getcontentlength')
    @Property.string({ required: false })
    contentLength?: string;

    /**
     * The ETag of the resource, quotes included.
     */
    @XmlElement('getetag')
    @Property.string({ required: false })
    etag?: string;

    /**
     * When the resource was last changed, as an http date.
     */
    @XmlElement('getlastmodified')
    @Property.string({ required: false })
    lastModified?: string;
}