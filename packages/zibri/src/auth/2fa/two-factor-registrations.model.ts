import { Property } from '../../entity/decorators/property.decorator';

/**
 * What `GET /2fa/registrations` of the `AuthController` answers: the second factors the logged in user
 * has enrolled.
 */
export class TwoFactorRegistrations {
    /**
     * The names of the two factor methods the user has a confirmed registration of, such as `'otp'`.
     */
    @Property.array({ items: { type: 'string' } })
    methods!: string[];
}