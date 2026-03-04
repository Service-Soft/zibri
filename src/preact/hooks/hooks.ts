import { onClient } from './on-client.hook';
import { onServer } from './on-server.hook';

/**
 * All preact hooks that are available.
 */
// eslint-disable-next-line typescript/typedef
export const preactHooks = [onClient, onServer] as const;