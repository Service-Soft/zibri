import { createContext, RenderContext } from 'zibri';

// the file of the page that renders, such as `guides/writing-a-page.md`, which its links are relative to
export const DocsPageContext: RenderContext<string> = createContext('');