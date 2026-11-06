import { createContext, RenderContext } from 'zibri';

/**
 * The id of the tab a tab bar shows, which its panels follow.
 */
export const CurrentTab: RenderContext<string> = createContext('');
