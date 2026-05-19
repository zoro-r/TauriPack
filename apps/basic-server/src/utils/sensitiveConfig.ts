import crypto from 'crypto';

const ENCRYPT_KEY = process.env.ENCRYPT_KEY || 'tennis-wechat-config-secret!';
const ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 16;
const encoder = new TextEncoder();

const getEncryptKey = () => {
  const key = ENCRYPT_KEY;
  if (key.length < 32) {
    return encoder.encode(`${key}${'0'.repeat(32 - key.length)}`);
  }
  if (key.length > 32) {
    return encoder.encode(key.slice(0, 32));
  }
  return encoder.encode(key);
};

const isEncryptedFormat = (value: string) => {
  const parts = String(value || '').split(':');
  if (parts.length < 2) {
    return false;
  }
  const iv = parts[0];
  const content = parts.slice(1).join(':');
  return (
    iv.length === IV_LENGTH * 2 &&
    /^[0-9a-fA-F]+$/.test(iv) &&
    /^[0-9a-fA-F]+$/.test(content)
  );
};

export const decryptSensitiveData = (text: string) => {
  const parts = text.split(':');
  const iv = Uint8Array.from(Buffer.from(parts.shift() || '', 'hex'));
  const encryptedText = Uint8Array.from(Buffer.from(parts.join(':'), 'hex'));
  const decipher = crypto.createDecipheriv(ALGORITHM, getEncryptKey(), iv);
  return `${decipher.update(encryptedText, undefined, 'utf8')}${decipher.final('utf8')}`;
};

export const resolveSensitiveValue = (value?: string) => {
  const raw = String(value || '').trim();
  if (!raw) {
    return raw;
  }
  if (!isEncryptedFormat(raw)) {
    return raw;
  }
  return decryptSensitiveData(raw);
};
