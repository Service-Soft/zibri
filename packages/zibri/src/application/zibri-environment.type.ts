/**
 * Where an application runs: on a developer's machine, or serving its users.
 *
 * In `'development'`, what only a deployment can provide has a stand-in: an application that
 * provides no email transport logs every mail instead of sending it. In `'production'`, it does not
 * start without one.
 */
export type ZibriEnvironment = 'development' | 'production';

/**
 * Every environment an application can run in.
 */
export const ZIBRI_ENVIRONMENTS: readonly ZibriEnvironment[] = ['development', 'production'];