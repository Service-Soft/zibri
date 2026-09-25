// Everything a running application needs, and nothing that reads source: the parser, the analysis
// and the code generation are on the `./compiler` subpath, because they reach TypeScript and an
// application has no reason to ship one. See `src/compiler.ts`.
export * from './diagnostics/diagnostic.model';
export * from './runtime/server-runtime';
export * from './runtime/access-shape';
export * from './codegen/server/jsx-text';
export * from './codegen/client/reattach';
export * from './codegen/client/hooks';
export * from './runtime/server-hooks';
export * from './runtime/render-page';
export * from './vendor-file-name';
export * from './jsx/jsx.model';
export * from './jsx/jsx-element-attributes.model';
export * from './jsx/intrinsic-elements.model';
// Also surfaced from the main entry (not only the `./email` subpath) so consumers on classic module
// resolution, like zibri's CommonJS build, can re-export the email components.
export * from './email/index';