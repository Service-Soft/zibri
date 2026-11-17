import { Property } from '../../entity/decorators/property.decorator';

/**
 * The purposes a confirmation answers with.
 */
const CONFIRMATION_PURPOSES: Readonly<Record<string, EmailConfirmation['purpose']>> = { verification: 'verification', change: 'change' };

/**
 * What `POST /confirm-email` of the `AuthController` answers: what the link was for, and whether that
 * is done, so the page of the link says it.
 */
export class EmailConfirmation {
    /**
     * Whether the link verified an address, or was one of a change.
     */
    @Property.string({ enum: CONFIRMATION_PURPOSES })
    purpose!: 'verification' | 'change';

    /**
     * Whether it is done. False for a change that still waits for the link to the other address, with
     * `previousAddressConfirms`.
     */
    @Property.boolean()
    completed!: boolean;
}