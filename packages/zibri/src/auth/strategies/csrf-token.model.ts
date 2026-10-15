import { Property } from '../../entity/decorators/property.decorator';

/**
 * The token against cross-site request forgery the client of a login sends with its requests.
 */
export class CsrfToken {
    /**
     * The token.
     */
    @Property.string()
    csrfToken!: string;
}