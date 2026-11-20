import { OmitStrict } from '../../types/omit-strict.type';
import { UserLogin } from './user-login.model';

/**
 * A login as the strategy carrying it lists it: a `UserLogin` without what only the auth service
 * knows, which strategy it is and whether the request asking carries it.
 */
export type ListedLogin = OmitStrict<UserLogin, 'strategy' | 'current'>;