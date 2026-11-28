import { Property } from '../../../entity/decorators/property.decorator';

/**
 * What asking for a link to log in with is sent with.
 */
export class RequestLoginLinkInput {
    /**
     * The email of the account the link logs in.
     */
    @Property.string({ format: 'email' })
    email!: string;
}