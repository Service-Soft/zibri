import { Property } from '../../../entity/decorators/property.decorator';

/**
 * What a login by a link sent by email takes: the token from the link.
 */
export class LoginLinkCredentials {
    /**
     * The token from the link.
     */
    @Property.string()
    token!: string;
}