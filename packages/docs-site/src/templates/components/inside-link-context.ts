import { createContext, RenderContext } from 'zibri';

// whether what renders is inside a link already, where a code span naming an export leads nowhere of its own, as a link
// holds no link
export const InsideLinkContext: RenderContext<boolean> = createContext(false);