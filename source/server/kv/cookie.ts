import { type CookieEntity } from '~/server/utils/CookieStore';

export type CookieKVKey = string;

export interface CookieKVValue {
  token: string;
  cookies: CookieEntity[];
}

export async function setMpCookie(key: CookieKVKey, data: CookieKVValue): Promise<boolean> {
  const kv = useStorage('kv');
  try {
    await kv.set<CookieKVValue>(`cookie:${key}`, data, {
      // https://developers.cloudflare.com/kv/api/write-key-value-pairs/#expiring-keys
      expirationTtl: 60 * 60 * 24 * 4, // 4 days
    });
    return true;
  } catch (err) {
    console.error('kv.set call failed:', err);
    return false;
  }
}

export async function getMpCookie(key: CookieKVKey): Promise<CookieKVValue | null> {
  const kv = useStorage('kv');
  return await kv.get<CookieKVValue>(`cookie:${key}`);
}

export async function getLatestMpCookie(): Promise<{ key: CookieKVKey; value: CookieKVValue } | null> {
  const kv = useStorage('kv');
  const keys = await kv.getKeys('cookie:');
  const latestKey = keys.at(-1);

  if (!latestKey) {
    return null;
  }

  const normalizedKey = latestKey.startsWith('cookie:') ? latestKey.slice('cookie:'.length) : latestKey;
  const value = await getMpCookie(normalizedKey);

  if (!value) {
    return null;
  }

  return {
    key: normalizedKey,
    value,
  };
}
