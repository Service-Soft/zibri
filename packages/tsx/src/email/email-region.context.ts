import { createContext, RenderContext } from '../runtime/server-runtime';

/**
 * The part of an email document a component renders in: directly in `Mjml`, in `MjHead`, or in `MjBody`.
 */
export type EmailRegion = 'document' | 'head' | 'body';

/**
 * The part of the document a component renders in, which decides where an `MjRaw` puts its markup. A component
 * rendered on its own is in the body.
 */
export const EmailRegionContext: RenderContext<EmailRegion> = createContext<EmailRegion>('body');