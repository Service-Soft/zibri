import { DefinedPermissions, definePermissions, DefinedPlatformPermissions, definePlatformPermissions } from '../../../auth/roles/define-permissions.function';

// eslint-disable-next-line typescript/typedef
const TEST_PERMISSIONS = ['member-admin', 'member-user'] as const;

// eslint-disable-next-line typescript/typedef
const TEST_PLATFORM_PERMISSIONS = ['admin', 'user'] as const;

/**
 * The tenant permissions of the test fixtures: one per tenant role of `MemberRoles`, named like it,
 * so that a check asks for exactly what that role allows.
 */
export const TestPermissions: DefinedPermissions<typeof TEST_PERMISSIONS> = definePermissions(TEST_PERMISSIONS);

/**
 * The platform permissions of the test fixtures: one per platform role of `Roles`, named like it.
 */
export const TestPlatformPermissions: DefinedPlatformPermissions<typeof TEST_PLATFORM_PERMISSIONS>
    = definePlatformPermissions(TEST_PLATFORM_PERMISSIONS);