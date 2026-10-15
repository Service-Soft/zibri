import { DiContainer, DiProvider } from 'zibri';

/**
 * Registers the application's providers ahead of its own init, which registers them again.
 *
 * The harness builds things before the application does - the logger it quiets, the data sources
 * it points at containers - and the container keeps whatever it built. Built from the defaults, a
 * suite's own `LOGGER_TRANSPORTS` would never reach the logger the application goes on to use.
 * @param providers - The providers the application is built with.
 */
export function registerAheadOfInit(providers: DiProvider<unknown>[]): void {
    for (const provider of providers) {
        DiContainer.getInstance().register(provider);
    }
}