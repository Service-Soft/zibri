/**
 * The schemas of SCIM (RFC 7643, RFC 7644) that resources and messages name.
 */
export enum ScimSchema {
    USER = 'urn:ietf:params:scim:schemas:core:2.0:User',
    GROUP = 'urn:ietf:params:scim:schemas:core:2.0:Group',
    ENTERPRISE_USER = 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User',
    LIST_RESPONSE = 'urn:ietf:params:scim:api:messages:2.0:ListResponse',
    PATCH_OP = 'urn:ietf:params:scim:api:messages:2.0:PatchOp',
    ERROR = 'urn:ietf:params:scim:api:messages:2.0:Error',
    SERVICE_PROVIDER_CONFIG = 'urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig',
    RESOURCE_TYPE = 'urn:ietf:params:scim:schemas:core:2.0:ResourceType',
    SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:Schema',
    BULK_REQUEST = 'urn:ietf:params:scim:api:messages:2.0:BulkRequest',
    BULK_RESPONSE = 'urn:ietf:params:scim:api:messages:2.0:BulkResponse'
}