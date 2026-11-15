/**
 * Why a link to verify an address is mailed: to verify the address a user has, to change to a new
 * one, or, with `previousAddressConfirms`, to approve that change from the previous address.
 */
export type EmailVerificationPurpose = 'verification' | 'change' | 'change-approval';