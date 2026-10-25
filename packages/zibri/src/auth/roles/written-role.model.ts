import { RoleIdentity } from './role-identity.model';
import { RoleLevel } from './role-level.type';

/**
 * A role as a write leaves it: what it is written with, over what it was where the write leaves
 * something unchanged.
 */
export type WrittenRole = RoleIdentity & {
    /**
     * The id of the row, undefined for one the write creates.
     */
    id: string | undefined,
    /**
     * The level it is held at.
     */
    level: RoleLevel
};