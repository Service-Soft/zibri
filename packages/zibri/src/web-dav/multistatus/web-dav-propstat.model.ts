import { Property } from '../../entity/decorators/property.decorator';
import { WebDavProp } from './web-dav-prop.model';

/**
 * Properties of a resource that share a status: those the server found, under `HTTP/1.1 200 OK`, and those it
 * could not give, such as under `HTTP/1.1 404 Not Found`.
 */
export class WebDavPropstat {
    /**
     * The properties.
     */
    @Property.object({ cls: () => WebDavProp, allowAdditionalProperties: true })
    prop!: WebDavProp;

    /**
     * Their status, as a status line, such as `HTTP/1.1 200 OK`.
     */
    @Property.string()
    status!: string;
}