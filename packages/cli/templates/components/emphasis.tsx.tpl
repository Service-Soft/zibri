import { MdxContentProps, TsxComponent } from 'zibri';

export const Emphasis: TsxComponent<MdxContentProps> = ({ children }) => {
    return <em className="italic">{children}</em>;
};