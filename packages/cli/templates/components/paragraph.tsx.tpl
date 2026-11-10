import { MdxContentProps, TsxComponent } from 'zibri';

export const Paragraph: TsxComponent<MdxContentProps> = ({ children }) => {
    return <p className="my-4 text-white leading-relaxed">{children}</p>;
};