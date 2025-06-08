import { hash, compare, genSalt } from 'bcryptjs';

export abstract class HashUtilities {
    static async hash(value: string): Promise<string> {
        return await hash(value, await genSalt());
    }
    static async equal(value: string, hash: string): Promise<boolean> {
        return await compare(value, hash);
    }
}