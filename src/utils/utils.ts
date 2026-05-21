import * as bcrypt from 'bcrypt';

const saltBcypt = 10;

export const hashPassword = async (password: string): Promise<string> => {
    return await bcrypt.hash(password, saltBcypt);
};
