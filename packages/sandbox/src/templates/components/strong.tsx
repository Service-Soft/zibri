import { MdxContentProps, TsxComponent } from 'zibri';

export const Strong: TsxComponent<MdxContentProps> = ({ children }) => {
    return <strong className="font-semibold">{children}</strong>;
};