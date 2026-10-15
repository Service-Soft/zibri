/**
 * One operation of a SCIM patch request (RFC 7644, 3.5.2).
 */
export type ScimPatchOperation = {
    /**
     * What the operation does. SCIM names it in any case, and identity providers differ: Entra ID
     * writes `Add`, others `add`.
     */
    op: 'add' | 'remove' | 'replace' | 'Add' | 'Remove' | 'Replace' | 'ADD' | 'REMOVE' | 'REPLACE',
    /**
     * The attribute it changes, eg. `name.givenName` or `members[value eq "2819c223"]`. Without one,
     * `value` names the attributes it changes.
     */
    path: string | undefined,
    /**
     * The value to add or to replace with, or the items to remove.
     */
    value: unknown
};