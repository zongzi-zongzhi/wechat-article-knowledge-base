import { type CookieEntity } from '~/server/utils/CookieStore';

export type CookieKVKey = string;

export interface CookieKVValue {
  token: string;
  cookies: CookieEntity[];
  saved_at?: string;
}

export const MP_COOKIE_TTL_DAYS = 30;

export async function setMpCookie(key: CookieKVKey, data: CookieKVValue): Promise<boolean> {
  const kv = useStorage('kv');
  try {
    await kv.set<CookieKVValue>(`cookie:${key}`, { ...data, saved_at: new Date().toISOString() }, {
      // https://developers.cloudflare.com/kv/api/write-key-value-pairs/#expiring-keys
      expirationTtl: 60 * 60 * 24 * MP_COOKIE_TTL_DAYS,
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

  if (!keys.length) {
    return null;
  }

  let latest: { key: CookieKVKey; value: CookieKVValue; savedAt: number } | null = null;

  for (const key of keys) {
    const normalizedKey = key.startsWith('cookie:') ? key.slice('cookie:'.length) : key;
    const value = await getMpCookie(normalizedKey);
    if (!value) {
      continue;
    }

    const savedAt = value.saved_at ? Date.parse(value.saved_at) : 0;
    if (!latest || savedAt >= latest.savedAt) {
      latest = {
        key: normalizedKey,
        value,
        savedAt,
      };
    }
  }

  return latest ? { key: latest.key, value: latest.value } : null;
}
