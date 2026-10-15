/**
 * A SCIM resource or message as it is sent over http: whatever attributes the protocol gives it.
 */
export class ScimBody {
    [attribute: string]: unknown
}