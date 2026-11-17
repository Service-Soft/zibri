import { MdxLinkProps, TsxComponent } from 'zibri';

// a link inside the text of an email, styled where an email client reads it
export const InlineEmailLink: TsxComponent<MdxLinkProps> = ({ href, children }) => {
    return <a href={href} style={{ color: '#0e456f' }}>{children}</a>;
};