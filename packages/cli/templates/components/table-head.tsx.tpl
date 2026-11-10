import { MdxContentProps, TsxComponent } from 'zibri';

// gone on a narrow screen, where every cell shows the title of its column
export const TableHead: TsxComponent<MdxContentProps> = ({ children }) => {
    return <thead className="bg-primary max-sm:hidden">{children}</thead>;
};