/**
 * Polls until the predicate holds, or gives up.
 * @param predicate - What has to become true.
 * @param timeoutMs - How long to keep asking.
 * @param describeState - What the failure says instead of the predicate: the state it found, such as a row's status.
 * @throws When the predicate still does not hold once the time is up.
 */
export async function waitUntil(
    predicate: () => Promise<boolean> | boolean,
    timeoutMs: number = 5000,
    describeState?: () => Promise<string> | string
): Promise<void> {
    const start: number = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (await predicate()) {
            return;
        }
        await new Promise(resolve => setTimeout(resolve, 20));
    }
    const found: string = describeState == undefined ? '' : `: ${await describeState()}`;
    throw new Error(`waitUntil: condition was not met in time${found}`);
}