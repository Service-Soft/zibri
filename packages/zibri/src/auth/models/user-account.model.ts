import { type BaseUser } from './base-user.model';
import { OmitStrict } from '../../types/omit-strict.type';

/**
 * A user as far as who they are, without the roles they hold: what a stored user and the user a
 * request is handed have in common.
 */
export type UserAccount = OmitStrict<BaseUser<string>, 'roles'>;