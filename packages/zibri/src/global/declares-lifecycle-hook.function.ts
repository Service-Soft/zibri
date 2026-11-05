import { implementsAfterAppInit } from './after-app-init.interface';
import { implementsAfterAppShutdown } from './after-app-shutdown.interface';
import { implementsAfterAppStart } from './after-app-start.interface';
import { implementsBeforeAppInit } from './before-app-init.interface';
import { implementsBeforeAppShutdown } from './before-app-shutdown.interface';
import { implementsOnAppInit } from './on-app-init.interface';
import { implementsOnAppShutdown } from './on-app-shutdown.interface';
import { implementsOnAppStart } from './on-app-start.interface';

/**
 * Whether the class behind the given prototype takes part in the application's lifecycle.
 *
 * Read off the prototype rather than an instance, which is the whole point: a method lives there
 * from the moment the class is declared, so this answers before anything has been constructed. That
 * is what lets initialization decide which classes are worth building without building them, and
 * what lets an injection say whether the value it is about to hand over missed something.
 * @param prototype - The prototype of the class to read.
 * @returns True when it declares any of the eight hooks.
 */
export function declaresLifecycleHook(prototype: unknown): boolean {
    return implementsBeforeAppInit(prototype)
        || implementsOnAppInit(prototype)
        || implementsAfterAppInit(prototype)
        || implementsOnAppStart(prototype)
        || implementsAfterAppStart(prototype)
        || implementsBeforeAppShutdown(prototype)
        || implementsOnAppShutdown(prototype)
        || implementsAfterAppShutdown(prototype);
}