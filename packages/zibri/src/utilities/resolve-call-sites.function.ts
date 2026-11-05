/**
 * Somewhere for `captureStackTrace` to hang the frames it collects.
 */
type StackHolder = {
    /**
     * The frames, as whatever the current `prepareStackTrace` chose to return for them.
     */
    stack?: unknown
};

/**
 * Collects the frames of the current call stack without rendering any of them into text.
 * @param below - The function whose own frame, and every frame it called, are left out.
 * @returns The frames, starting at whatever called `below`. Empty when `Error.stackTraceLimit` is 0.
 */
export function resolveCallSites(below: Function): NodeJS.CallSite[] {
    // reading `error.stack` would be the obvious way and is the expensive one: the default
    // prepareStackTrace renders every frame into text, and that formatting is most of what makes
    // materializing a stack costly. Swapping it for one that hands back the frames skips it entirely
    const originalPrepareStackTrace: typeof Error.prepareStackTrace = Error.prepareStackTrace;
    try {
        Error.prepareStackTrace = (_error, callSites) => callSites;
        const holder: StackHolder = {};
        Error.captureStackTrace(holder, below);
        // whatever prepareStackTrace returns is what `stack` holds, and the one above returns the frames
        return (holder.stack ?? []) as NodeJS.CallSite[];
    }
    finally {
        Error.prepareStackTrace = originalPrepareStackTrace;
    }
}