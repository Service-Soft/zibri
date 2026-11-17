// The compiler of zibri-tsx, a package of its own on purpose.
//
// Parsing, analyzing and emitting all run on TypeScript's own syntax tree, which is a build-time
// dependency an application has no reason to carry. zibri-tsx is what a running application imports -
// the server runtime, the render path and the email components - and a package a production one names
// stays in a deployment, so anything that reads source lives here, a devDependency of the application.
export * from './codegen/compile';
export * from './semantics/client-packages';
export * from './semantics/symbols';
export * from './semantics/component';
export * from './semantics/binding';
export * from './semantics/validate';
export * from './semantics/walk';
export * from './codegen/server/print';
export * from './codegen/server/render-codegen';
export * from './codegen/client/handlers';
export * from './codegen/client/client-codegen';
// markdown templates are printed by zibri-mdx, which a project installs to build them and markdown-compiler.ts loads
// once one is compiled. What it prints is declared here, and what the printed template is made of with it
export * from './markdown/markdown-compiler';
export * from './markdown/markdown-printer.model';
/**
 * The lines of a printed template, each with where in its source it comes from.
 */
export { type EmittedLines, type LineOrigin } from './codegen/source-map';
// the build steps belong here for the same reason: both read template source to decide what to
// emit, so both reach the parser.
export * from './build/templates';
export * from './build/vendor';