
/**
 * Interface for an auth controller.
 */
export interface AuthControllerInterface<
    CredentialsType,
    AuthDataType,
    RefreshLoginDataType,
    RequestPasswordResetDataType,
    ConfirmPasswordResetDataType
> {
    /**
     * Logs in a user.
     */
    login: (credentials: CredentialsType) => Promise<AuthDataType>,
    /**
     * Refreshes the login of a user.
     */
    refreshLogin: (data: RefreshLoginDataType) => Promise<AuthDataType>,
    /**
     * Request a new password for a user using the request password reset data.
     */
    requestPasswordReset: (data: RequestPasswordResetDataType) => Promise<void>,
    /**
     * Confirms a new password for a user using the provided confirm password reset data.
     */
    confirmPasswordReset: (data: ConfirmPasswordResetDataType) => Promise<void>
}