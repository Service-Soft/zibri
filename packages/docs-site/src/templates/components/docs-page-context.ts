import { createContext, RenderContext } from 'zibri';

// the file of the page that renders, such as `auth/passkeys.md`, which its links and images are relative to
export const DocsPageContext: RenderContext<string> = createContext('');