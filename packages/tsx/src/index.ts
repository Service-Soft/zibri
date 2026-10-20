// Everything a running application needs, and nothing that reads source: the parser, the analysis
// and the code generation are on the `./compiler` subpath, because they reach TypeScript and an
// application has no reason to ship one. See `src/compiler.ts`.
export * from './diagnostics/diagnostic.model.ts';
export * from './runtime/server-runtime.ts';
export * from './runtime/access-shape.ts';
export * from './codegen/server/jsx-text.ts';
export * from './codegen/client/reattach.ts';
export * from './codegen/client/hooks.ts';
export * from './runtime/server-hooks.ts';
export * from './runtime/render-page.ts';
export * from './vendor-file-name.ts';
export * from './jsx/jsx.model.ts';
export * from './jsx/jsx-element-attributes.model.ts';
export * from './jsx/intrinsic-elements.model.ts';
// Also surfaced from the main entry (not only the `./email` subpath) so consumers on classic module
// resolution, like zibri's CommonJS build, can re-export the email components.
export * from './email/index.ts';