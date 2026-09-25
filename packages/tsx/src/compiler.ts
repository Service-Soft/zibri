// The compiler half of this package, kept off the main entry point on purpose.
//
// Parsing, analyzing and emitting all run on TypeScript's own syntax tree, which is a build-time
// dependency an application has no reason to carry. The main entry is what a running application
// imports - the server runtime, the render path and the email components - so anything that reads
// source lives behind this subpath instead, and a deployed bundle never pulls a compiler in after it.
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
// the build steps belong here for the same reason: both read template source to decide what to
// emit, so both reach the parser.
export * from './build/templates';
export * from './build/vendor';