import { MdxContentProps, TsxComponent } from 'zibri';

export const InlineCode: TsxComponent<MdxContentProps> = ({ children }) => {
    return <code className="px-1 rounded-sm bg-primary/50 text-sm">{children}</code>;
};