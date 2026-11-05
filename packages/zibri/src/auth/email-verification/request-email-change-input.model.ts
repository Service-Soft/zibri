import { Property } from '../../entity/decorators/property.decorator';

/**
 * What asking to change the email address of a user is sent with.
 */
export class RequestEmailChangeInput {
    /**
     * The address to change to, which a link to confirm it is mailed to.
     */
    @Property.string({ format: 'email' })
    newEmail!: string;
}