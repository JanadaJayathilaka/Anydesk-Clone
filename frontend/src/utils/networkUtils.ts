export const DEFAULT_SERVER_URL = 'http://18.188.166.170:5082';

export function isLocalOrPrivateIp(url: string | null | undefined): boolean {
  if (!url) return true;
  if (url.includes('localhost') || url.includes('127.0.0.1')) return true;
  // Match 192.168.x.x, 10.x.x.x, 172.16-31.x.x
  if (/https?:\/\/(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)/.test(url)) return true;
  return false;
}
