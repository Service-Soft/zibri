// Everything a running application needs, and nothing that reads source: the compiler reaches TypeScript, and is the
// package zibri-tsx-compiler. What only compiled templates and the other Zibri packages use is in `internal.ts`, and a
// file whose names are split between the two is re-exported by name.
import * as internal from './internal';

export { type Diagnostic, DiagnosticSeverity, type SourceSpan } from './diagnostics/diagnostic.model';
export { $raw,
    createContext,
    escapeAttribute,
    escapeText,
    isRaw,
    provideContext,
    raw,
    type Raw,
    type RenderContext,
    useContext } from './runtime/server-runtime';
export { type Ref, type RefOptions, type Refs, type RefTarget, useRef, useRefs } from './runtime/refs';
export * from './runtime/state';
export * from './runtime/effect';
export * from './runtime/input';
export { type RenderEnvironment } from './runtime/render-environment';
export { type CompiledPage, type LocaleData, type ProvidedContext, renderPage, type RenderPageOptions } from './runtime/render-page';
export * from './jsx/jsx.model';
export * from './jsx/jsx-element-attributes.model';
export * from './jsx/intrinsic-elements.model';
export * from './markdown/mdx-components.model';
// Also surfaced from the main entry (not only the `./email` subpath) so consumers on classic module
// resolution, like zibri's CommonJS build, can re-export the email components.
export * from './email/index';

// TODO 4.0: remove these, what 3.0 exported here before `internal.ts` held it. Declared rather than re-exported: a
// specifier with its JSDoc above it cannot start on the line of the brace, as the shared lint config asks of an export
/**
 * Used by compiled templates and the other Zibri packages.
 * @deprecated Import it from `zibri-tsx/internal`, which any release can change. Removed here in 4.0.
 */
export type AccessShape = internal.AccessShape;
/**
 * Used by compiled templates and the other Zibri packages.
 * @deprecated Import it from `zibri-tsx/internal`, which any release can change. Removed here in 4.0.
 */
export type AllPropsExcept = internal.AllPropsExcept;
/**
 * Used by compiled templates and the other Zibri packages.
 * @deprecated Import it from `zibri-tsx/internal`, which any release can change. Removed here in 4.0.
 */
export const attr: typeof internal.attr = internal.attr;
/**
 * Used by compiled templates and the other Zibri packages.
 * @deprecated Import it from `zibri-tsx/internal`, which any release can change. Removed here in 4.0.
 */
export const buildClientScript: typeof internal.buildClientScript = internal.buildClientScript;
/**
 * Used by compiled templates and the other Zibri packages.
 * @deprecated Import it from `zibri-tsx/internal`, which any release can change. Removed here in 4.0.
 */
export const buildVendorTags: typeof internal.buildVendorTags = internal.buildVendorTags;
/**
 * Used by compiled templates and the other Zibri packages.
 * @deprecated Import it from `zibri-tsx/internal`, which any release can change. Removed here in 4.0.
 */
export const CLIENT_HOOK_SOURCES: typeof internal.CLIENT_HOOK_SOURCES = internal.CLIENT_HOOK_SOURCES;
/**
 * Used by compiled templates and the other Zibri packages.
 * @deprecated Import it from `zibri-tsx/internal`, which any release can change. Removed here in 4.0.
 */
export type ClientInstanceEntry = internal.ClientInstanceEntry;
/**
 * Used by compiled templates and the other Zibri packages.
 * @deprecated Import it from `zibri-tsx/internal`, which any release can change. Removed here in 4.0.
 */
export type ClientPropMarker = internal.ClientPropMarker;
/**
 * Used by compiled templates and the other Zibri packages.
 * @deprecated Import it from `zibri-tsx/internal`, which any release can change. Removed here in 4.0.
 */
export type ClientPropRegistryEntry = internal.ClientPropRegistryEntry;
/**
 * Used by compiled templates and the other Zibri packages.
 * @deprecated Import it from `zibri-tsx/internal`, which any release can change. Removed here in 4.0.
 */
export type CompiledComponent = internal.CompiledComponent;
/**
 * Used by compiled templates and the other Zibri packages.
 * @deprecated Import it from `zibri-tsx/internal`, which any release can change. Removed here in 4.0.
 */
export type ComponentClientMeta = internal.ComponentClientMeta;
/**
 * Used by compiled templates and the other Zibri packages.
 * @deprecated Import it from `zibri-tsx/internal`, which any release can change. Removed here in 4.0.
 */
export const createServerRuntime: typeof internal.createServerRuntime = internal.createServerRuntime;
/**
 * Used by compiled templates and the other Zibri packages.
 * @deprecated Import it from `zibri-tsx/internal`, which any release can change. Removed here in 4.0.
 */
export const decodeJsxEntities: typeof internal.decodeJsxEntities = internal.decodeJsxEntities;
/**
 * Used by compiled templates and the other Zibri packages.
 * @deprecated Import it from `zibri-tsx/internal`, which any release can change. Removed here in 4.0.
 */
export type FieldAccess = internal.FieldAccess;
/**
 * Used by compiled templates and the other Zibri packages.
 * @deprecated Import it from `zibri-tsx/internal`, which any release can change. Removed here in 4.0.
 */
export type HandlerMarker = internal.HandlerMarker;
/**
 * Used by compiled templates and the other Zibri packages.
 * @deprecated Import it from `zibri-tsx/internal`, which any release can change. Removed here in 4.0.
 */
export type HandlerRegistryEntry = internal.HandlerRegistryEntry;
/**
 * Used by compiled templates and the other Zibri packages.
 * @deprecated Import it from `zibri-tsx/internal`, which any release can change. Removed here in 4.0.
 */
export type HandlerSpec = internal.HandlerSpec;
/**
 * Used by compiled templates and the other Zibri packages.
 * @deprecated Import it from `zibri-tsx/internal`, which any release can change. Removed here in 4.0.
 */
export type HookData = internal.HookData;
/**
 * Used by compiled templates and the other Zibri packages.
 * @deprecated Import it from `zibri-tsx/internal`, which any release can change. Removed here in 4.0.
 */
export const HOOK_PLACEHOLDERS: typeof internal.HOOK_PLACEHOLDERS = internal.HOOK_PLACEHOLDERS;
/**
 * Used by compiled templates and the other Zibri packages.
 * @deprecated Import it from `zibri-tsx/internal`, which any release can change. Removed here in 4.0.
 */
export const isClientPropMarker: typeof internal.isClientPropMarker = internal.isClientPropMarker;
/**
 * Used by compiled templates and the other Zibri packages.
 * @deprecated Import it from `zibri-tsx/internal`, which any release can change. Removed here in 4.0.
 */
export type LineColumn = internal.LineColumn;
/**
 * Used by compiled templates and the other Zibri packages.
 * @deprecated Import it from `zibri-tsx/internal`, which any release can change. Removed here in 4.0.
 */
export const isScriptUrl: typeof internal.isScriptUrl = internal.isScriptUrl;
/**
 * Used by compiled templates and the other Zibri packages.
 * @deprecated Import it from `zibri-tsx/internal`, which any release can change. Removed here in 4.0.
 */
export type MarkerHandlerSpec = internal.MarkerHandlerSpec;
/**
 * Used by compiled templates and the other Zibri packages.
 * @deprecated Import it from `zibri-tsx/internal`, which any release can change. Removed here in 4.0.
 */
export const mergeAccessShapes: typeof internal.mergeAccessShapes = internal.mergeAccessShapes;
/**
 * Used by compiled templates and the other Zibri packages.
 * @deprecated Import it from `zibri-tsx/internal`, which any release can change. Removed here in 4.0.
 */
export type NewHandlerSpec = internal.NewHandlerSpec;
/**
 * Used by compiled templates and the other Zibri packages.
 * @deprecated Import it from `zibri-tsx/internal`, which any release can change. Removed here in 4.0.
 */
export const normalizeJsxText: typeof internal.normalizeJsxText = internal.normalizeJsxText;
/**
 * Used by compiled templates and the other Zibri packages.
 * @deprecated Import it from `zibri-tsx/internal`, which any release can change. Removed here in 4.0.
 */
export const offsetToLineColumn: typeof internal.offsetToLineColumn = internal.offsetToLineColumn;
/**
 * Used by compiled templates and the other Zibri packages.
 * @deprecated Import it from `zibri-tsx/internal`, which any release can change. Removed here in 4.0.
 */
export const projectValue: typeof internal.projectValue = internal.projectValue;
/**
 * Used by compiled templates and the other Zibri packages.
 * @deprecated Import it from `zibri-tsx/internal`, which any release can change. Removed here in 4.0.
 */
export const REATTACH_RUNTIME: typeof internal.REATTACH_RUNTIME = internal.REATTACH_RUNTIME;
/**
 * Used by compiled templates and the other Zibri packages.
 * @deprecated Import it from `zibri-tsx/internal`, which any release can change. Removed here in 4.0.
 */
export type ReferencedProps = internal.ReferencedProps;
/**
 * Used by compiled templates and the other Zibri packages.
 * @deprecated Import it from `zibri-tsx/internal`, which any release can change. Removed here in 4.0.
 */
export const renderChild: typeof internal.renderChild = internal.renderChild;
/**
 * Used by compiled templates and the other Zibri packages.
 * @deprecated Import it from `zibri-tsx/internal`, which any release can change. Removed here in 4.0.
 */
export type RenderServerRuntime = internal.RenderServerRuntime;
/**
 * Used by compiled templates and the other Zibri packages.
 * @deprecated Import it from `zibri-tsx/internal`, which any release can change. Removed here in 4.0.
 */
export const renderStyle: typeof internal.renderStyle = internal.renderStyle;
/**
 * Used by compiled templates and the other Zibri packages.
 * @deprecated Import it from `zibri-tsx/internal`, which any release can change. Removed here in 4.0.
 */
export const resolveAccessThroughRest: typeof internal.resolveAccessThroughRest = internal.resolveAccessThroughRest;
/**
 * Used by compiled templates and the other Zibri packages.
 * @deprecated Import it from `zibri-tsx/internal`, which any release can change. Removed here in 4.0.
 */
export const resolveCompileError: typeof internal.resolveCompileError = internal.resolveCompileError;
/**
 * Used by compiled templates and the other Zibri packages.
 * @deprecated Import it from `zibri-tsx/internal`, which any release can change. Removed here in 4.0.
 */
export const resolveReferencedKeys: typeof internal.resolveReferencedKeys = internal.resolveReferencedKeys;
/**
 * Used by compiled templates and the other Zibri packages.
 * @deprecated Import it from `zibri-tsx/internal`, which any release can change. Removed here in 4.0.
 */
export const SERVER_HOOKS: typeof internal.SERVER_HOOKS = internal.SERVER_HOOKS;
/**
 * Used by compiled templates and the other Zibri packages.
 * @deprecated Import it from `zibri-tsx/internal`, which any release can change. Removed here in 4.0.
 */
export type ServerHooks = internal.ServerHooks;
/**
 * Used by compiled templates and the other Zibri packages.
 * @deprecated Import it from `zibri-tsx/internal`, which any release can change. Removed here in 4.0.
 */
export const serverRuntime: typeof internal.serverRuntime = internal.serverRuntime;
/**
 * Used by compiled templates and the other Zibri packages.
 * @deprecated Import it from `zibri-tsx/internal`, which any release can change. Removed here in 4.0.
 */
export type ServerRuntime = internal.ServerRuntime;
/**
 * Used by compiled templates and the other Zibri packages.
 * @deprecated Import it from `zibri-tsx/internal`, which any release can change. Removed here in 4.0.
 */
export const SETUP_RUNTIME_PARAM: typeof internal.SETUP_RUNTIME_PARAM = internal.SETUP_RUNTIME_PARAM;
/**
 * Used by compiled templates and the other Zibri packages.
 * @deprecated Import it from `zibri-tsx/internal`, which any release can change. Removed here in 4.0.
 */
export const spreadAttributes: typeof internal.spreadAttributes = internal.spreadAttributes;
/**
 * Used by compiled templates and the other Zibri packages.
 * @deprecated Import it from `zibri-tsx/internal`, which any release can change. Removed here in 4.0.
 */
export const substituteHookPlaceholders: typeof internal.substituteHookPlaceholders = internal.substituteHookPlaceholders;
/**
 * Used by compiled templates and the other Zibri packages.
 * @deprecated Import it from `zibri-tsx/internal`, which any release can change. Removed here in 4.0.
 */
export const vendorFileName: typeof internal.vendorFileName = internal.vendorFileName;
/**
 * Used by compiled templates and the other Zibri packages.
 * @deprecated Import it from `zibri-tsx/internal`, which any release can change. Removed here in 4.0.
 */
export const VOID_ELEMENTS: typeof internal.VOID_ELEMENTS = internal.VOID_ELEMENTS;
/**
 * Used by compiled templates and the other Zibri packages.
 * @deprecated Import it from `zibri-tsx/internal`, which any release can change. Removed here in 4.0.
 */
export const wrapDocument: typeof internal.wrapDocument = internal.wrapDocument;