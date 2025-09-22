const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

export const generateTemporaryPassword = (length = 12) => {
  let pwd = '';
  const chars = ALPHABET.length;
  for (let i = 0; i < length; i += 1) {
    const idx = Math.floor(Math.random() * chars);
    pwd += ALPHABET[idx];
  }
  return pwd;
};
