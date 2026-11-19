// from zibri-contract, so that the contract library of an api declares the permissions of the application, zibri's
// own spread in, and both sides name them by the same object
// eslint-disable-next-line stylistic/max-len, jsdoc/require-jsdoc
export { definePermissions, type DefinedPermissions, definePlatformPermissions, type DefinedPlatformPermissions, type PermissionKey } from 'zibri-contract';