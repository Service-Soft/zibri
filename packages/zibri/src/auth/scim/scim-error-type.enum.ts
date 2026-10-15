/**
 * What a SCIM error says went wrong, as its `scimType` (RFC 7644, 3.12).
 */
export enum ScimErrorType {
    INVALID_FILTER = 'invalidFilter',
    UNIQUENESS = 'uniqueness',
    MUTABILITY = 'mutability',
    INVALID_SYNTAX = 'invalidSyntax',
    INVALID_PATH = 'invalidPath',
    NO_TARGET = 'noTarget',
    INVALID_VALUE = 'invalidValue'
}