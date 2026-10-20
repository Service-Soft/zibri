// The compiler half of this package, kept off the main entry point on purpose.
//
// Parsing, analyzing and emitting all run on TypeScript's own syntax tree, which is a build-time
// dependency an application has no reason to carry. The main entry is what a running application
// imports - the server runtime, the render path and the email components - so anything that reads
// source lives behind this subpath instead, and a deployed bundle never pulls a compiler in after it.
export * from './codegen/compile.ts';
export * from './semantics/client-packages.ts';
export * from './semantics/symbols.ts';
export * from './semantics/component.ts';
export * from './semantics/binding.ts';
export * from './semantics/validate.ts';
export * from './semantics/walk.ts';
export * from './codegen/server/print.ts';
export * from './codegen/server/render-codegen.ts';
export * from './codegen/client/handlers.ts';
export * from './codegen/client/client-codegen.ts';
// the build steps belong here for the same reason: both read template source to decide what to
// emit, so both reach the parser.
export * from './build/templates.ts';
export * from './build/vendor.ts';