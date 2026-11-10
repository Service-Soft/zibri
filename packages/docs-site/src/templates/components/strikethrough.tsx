import { MdxContentProps, TsxComponent } from 'zibri';

export const Strikethrough: TsxComponent<MdxContentProps> = ({ children }) => {
    return <del className="line-through text-disabled-dark">{children}</del>;
};