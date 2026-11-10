// What compiled templates and the other Zibri packages use from zibri-tsx beyond the public api in `index.ts`: the
// runtime a compiled template renders with, its registries and markers, and the sources of the client script. Released
// with zibri-tsx but outside its semver promise: anything here can change in any release, along with the code the
// compiler emits (see releases.md of zibri).
//
// A file whose names are split between the two entry points is re-exported by name, so a name added to it later
// reaches neither until somebody lists it. runtime-entry.test.ts notices.
export { attr,
    type BindingRegistryEntry,
    type BindingSpec,
    type ClientInstanceEntry,
    type ClientPropMarker,
    type ClientPropRegistryEntry,
    type CompiledComponent,
    type ComponentClientMeta,
    createServerRuntime,
    type HandlerMarker,
    type HandlerRegistryEntry,
    type HandlerSpec,
    type InputMarker,
    type InputRegistryEntry,
    isClientPropMarker,
    isCompiledComponent,
    isInputMarker,
    isPartReference,
    isScriptUrl,
    type MarkerHandlerSpec,
    type NewHandlerSpec,
    type PartBindingEntry,
    type PartHandlerEntry,
    type PartProp,
    type PartRecord,
    type PartReference,
    type PartSource,
    type RefRegistryEntry,
    type RegionRegistryEntry,
    renderChild,
    type RenderForm,
    type RenderRegistry,
    type RenderServerRuntime,
    renderStyle,
    resolveReferencedKeys,
    selectOption,
    serverRuntime,
    type ServerRuntime,
    type ServerState,
    spreadAttributes,
    type StateRegistryEntry,
    type TemplateRecord,
    VOID_ELEMENTS } from './runtime/server-runtime';
export * from './runtime/access-shape';
export * from './codegen/server/jsx-text';
export * from './codegen/client/reattach';
export * from './codegen/client/hooks';
export * from './runtime/server-hooks';
export { isRefMarker, REF_MARKER, type RefEntry, type RefMarker } from './runtime/refs';
export { reportRenderMistake } from './runtime/render-environment';
export * from './runtime/script-value';
export * from './runtime/translation-sources.model';
export { buildClientScript, buildVendorTags, wrapDocument } from './runtime/render-page';
export * from './vendor-file-name';
export { type LineColumn, offsetToLineColumn, resolveCompileError, resolveCompileWarning } from './diagnostics/diagnostic.model';
// what the email components of zibri-tsx are built from, and other components written by hand
export { defineEmailComponent, type EmailProps, type EmailRender, defineServerComponent } from './email/define-email-component';
export { horizontalPadding, type PaddingSides, pixels, resolvePadding, resolvePaddingOf, resolvePaddingSide } from './email/dimensions';
export * from './email/head-channels';
export * from './email/with-defaults';