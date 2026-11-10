import { createContext, RenderContext } from '../runtime/server-runtime';

/**
 * The url the `MjNavbar` a link is in puts before the link's `href`, or undefined when it has none.
 */
export const NavbarBaseUrlContext: RenderContext<string | undefined> = createContext<string | undefined>(undefined);