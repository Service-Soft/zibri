import { Property } from '../../entity/decorators/property.decorator';

/**
 * What a resource of a WebDAV server is, as its `resourcetype` property says: a collection, a folder, holds
 * the `collection` element, and a file holds none. A server may add elements of its own, such as a calendar.
 */
export class WebDavResourceType {
    /**
     * The empty element marking a folder, or undefined for a file.
     */
    @Property.unknown({ required: false })
    collection?: unknown;
}