/**
 * The framework's MJML email components and the context primitives, re-exported so templates import
 * everything from `zibri`. The components render structurally-correct MJML on the server; the nesting
 * rules between them are enforced at compile time by zibri-tsx.
 */
export { Mjml,
    MjHead,
    MjBody,
    MjSection,
    MjColumn,
    MjGroup,
    MjWrapper,
    MjText,
    MjButton,
    MjImage,
    MjDivider,
    MjSpacer,
    MjRaw,
    MjTitle,
    MjPreview,
    MjStyle,
    MjAttributes,
    EmailLayoutContext,
    $raw,
    createContext } from 'zibri-tsx';

// eslint-disable-next-line jsdoc-js/require-jsdoc
export type { MjmlProps,
    MjBodyProps,
    MjSectionProps,
    MjColumnProps,
    MjGroupProps,
    MjWrapperProps,
    MjTextProps,
    MjButtonProps,
    MjImageProps,
    MjDividerProps,
    MjSpacerProps,
    MjAttributesProps,
    EmailLayout,
    RenderContext } from 'zibri-tsx';