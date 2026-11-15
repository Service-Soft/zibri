/**
 * What `GET /2fa/registrations` answers.
 */
export type TwoFactorRegistrations = {
    /**
     * The names of the two factor methods the user has enrolled, like 'otp'.
     */
    methods: string[]
};