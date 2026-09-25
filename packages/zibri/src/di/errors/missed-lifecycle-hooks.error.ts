import { InternalError } from '../../error-handling/internal-error.model';
import { Newable } from '../../types/newable.type';
import { MetadataUtilities } from '../../utilities/metadata.utilities';

/**
 * Get the message for a class first built after the phases it asked to take part in.
 * @param declaredClass - The class that was about to be built.
 * @returns The message as a string.
 */
function getMissedLifecycleHooksMessage(declaredClass: Newable<unknown>): string {
    const lines: string[] = [
        `"${declaredClass.name}" declares a lifecycle hook and is being built for the first time now,`,
        'after the phases it asked to take part in have passed - so those hooks are not going to run.',
        'The application initializes whatever declares a hook, and this class reached none of that:',
        'it is registered on first use, or the token it is provided under was given to something else.',
        'Name it in the application\'s additionalLifecycleServices to have it built at startup.'
    ];
    const declaredIn: string | undefined = MetadataUtilities.getFilePath(declaredClass);
    if (declaredIn != undefined) {
        lines.push(`It was declared in ${declaredIn}.`);
    }
    return lines.join('\n');
}

/**
 * An error to throw when a class that takes part in the lifecycle is first built after its phases.
 *
 * A lifecycle hook is a request to be made ready at a point in the application's life, and the only
 * moment the framework can honour it is that point. A class first reached afterwards - one recorded
 * on first use, or one whose token an application provided something else for - is built with none
 * of that having happened, and it has no way to tell: its methods work, and whatever the hook was
 * supposed to arrange is simply absent.
 *
 * Refused rather than run late, because `inject()` is synchronous and a hook may return a promise:
 * running one here would hand back a value whose preparation is still in flight, which is a quieter
 * failure than this one rather than a fix for it. That is the same reasoning `UnresolvedAsyncProviderError`
 * carries for a value that has to be awaited before it exists.
 */
export class MissedLifecycleHooksError extends InternalError {
    constructor(declaredClass: Newable<unknown>, options?: ErrorOptions) {
        super(getMissedLifecycleHooksMessage(declaredClass), options);
        this.name = 'MissedLifecycleHooksError';
    }
}