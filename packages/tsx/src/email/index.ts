// The email components, and what writing an email with them takes. What they are built from is in `internal.ts`, and a
// file whose names are split between the two is re-exported by name.
import * as internal from '../internal';

export { type TsxComponent } from './define-email-component';
export { type EmailPaddingProps } from './dimensions';
export * from './email-layout.context';
export * from './mjml';
export * from './mj-body';
export * from './mj-section';
export * from './mj-column';
export * from './mj-text';
export * from './mj-button';
export * from './mj-image';
export * from './mj-divider';
export * from './mj-spacer';
export * from './mj-raw';
export * from './mj-group';
export * from './mj-wrapper';
export * from './mj-hero';
export * from './mj-table';
export * from './mj-social';
export * from './mj-social-element';
export * from './mj-navbar';
export * from './mj-navbar-link';
export * from './mj-carousel';
export * from './mj-carousel-image';
export * from './mj-accordion';
export * from './mj-accordion-element';
export * from './mj-accordion-title';
export * from './mj-accordion-text';
export * from './mj-head';
export * from './mj-title';
export * from './mj-preview';
export * from './mj-style';
export * from './mj-attributes';
export * from './mj-breakpoint';
export * from './mj-font';
export * from './mj-html-attributes';

// TODO 4.0: remove these, what 3.0 exported here before `internal.ts` held it. Declared rather than re-exported, as in
// `index.ts` of the package
/**
 * Used by the email components of zibri-tsx.
 * @deprecated Import it from `zibri-tsx/internal`, which any release can change. Removed here in 4.0.
 */
export type Defaults = internal.Defaults;
/**
 * Used by the email components of zibri-tsx.
 * @deprecated Import it from `zibri-tsx/internal`, which any release can change. Removed here in 4.0.
 */
export const defineEmailComponent: typeof internal.defineEmailComponent = internal.defineEmailComponent;
/**
 * Used by the email components of zibri-tsx.
 * @deprecated Import it from `zibri-tsx/internal`, which any release can change. Removed here in 4.0.
 */
export const documentDefaults: typeof internal.documentDefaults = internal.documentDefaults;
/**
 * Used by the email components of zibri-tsx.
 * @deprecated Import it from `zibri-tsx/internal`, which any release can change. Removed here in 4.0.
 */
export type EmailProps<T> = internal.EmailProps<T>;
/**
 * Used by the email components of zibri-tsx.
 * @deprecated Import it from `zibri-tsx/internal`, which any release can change. Removed here in 4.0.
 */
export type EmailRender<T> = internal.EmailRender<T>;
/**
 * Used by the email components of zibri-tsx.
 * @deprecated Import it from `zibri-tsx/internal`, which any release can change. Removed here in 4.0.
 */
export const HeadChannel: typeof internal.HeadChannel = internal.HeadChannel;
/**
 * Used by the email components of zibri-tsx.
 * @deprecated Import it from `zibri-tsx/internal`, which any release can change. Removed here in 4.0.
 */
export type HeadChannels = internal.HeadChannels;
/**
 * Used by the email components of zibri-tsx.
 * @deprecated Import it from `zibri-tsx/internal`, which any release can change. Removed here in 4.0.
 */
export const horizontalPadding: typeof internal.horizontalPadding = internal.horizontalPadding;
/**
 * Used by the email components of zibri-tsx.
 * @deprecated Import it from `zibri-tsx/internal`, which any release can change. Removed here in 4.0.
 */
export type PaddingSides = internal.PaddingSides;
/**
 * Used by the email components of zibri-tsx.
 * @deprecated Import it from `zibri-tsx/internal`, which any release can change. Removed here in 4.0.
 */
export const pixels: typeof internal.pixels = internal.pixels;
/**
 * Used by the email components of zibri-tsx.
 * @deprecated Import it from `zibri-tsx/internal`, which any release can change. Removed here in 4.0.
 */
export const resolvePadding: typeof internal.resolvePadding = internal.resolvePadding;
/**
 * Used by the email components of zibri-tsx.
 * @deprecated Import it from `zibri-tsx/internal`, which any release can change. Removed here in 4.0.
 */
export const withDefaults: typeof internal.withDefaults = internal.withDefaults;