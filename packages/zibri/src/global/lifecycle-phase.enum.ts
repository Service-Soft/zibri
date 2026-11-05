/**
 * The phases an application runs once, in this order, on its way up. Each is the point at which the
 * lifecycle hook of the same name runs.
 *
 * The shutdown hooks have no phase here: they run on whatever exists when the application shuts
 * down, so a value built at any point before then takes part in them.
 */
export enum LifecyclePhase {
    BEFORE_APP_INIT = 'beforeAppInit',
    ON_APP_INIT = 'onAppInit',
    AFTER_APP_INIT = 'afterAppInit',
    ON_APP_START = 'onAppStart',
    AFTER_APP_START = 'afterAppStart'
}