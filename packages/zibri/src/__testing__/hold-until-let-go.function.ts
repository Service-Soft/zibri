/**
 * Runs something that holds on to a resource while a function it is given runs, and keeps it held
 * until the test lets go.
 * @param hold - Takes the resource, runs the function while holding it, and lets go once it returns.
 * @returns Lets go, and resolves once the resource is let go of. Resolves itself once the resource is
 * held.
 * @throws When taking the resource fails.
 */
export async function holdUntilLetGo(hold: (whileHeld: () => Promise<void>) => Promise<void>): Promise<() => Promise<void>> {
    let letGo: () => void = () => undefined;
    const released: Promise<void> = new Promise(resolve => letGo = resolve);
    let held: Promise<void> = Promise.resolve();
    await new Promise<void>((resolve, reject) => {
        held = hold(async () => {
            resolve();
            await released;
        });
        // a hold that fails before it is taken would leave this waiting for good
        held.catch(reject);
    });
    return async () => {
        letGo();
        await held;
    };
}