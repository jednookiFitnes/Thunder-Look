let cachedApiToken: string | null = null;

export function getApiToken(): string {
  if (cachedApiToken !== null) return cachedApiToken;
  if (typeof document !== 'undefined') {
    const meta = document.querySelector('meta[name="tl-api-token"]');
    const content = meta?.getAttribute('content')?.trim() || '';
    if (content) {
      cachedApiToken = content;
      return cachedApiToken;
    }
  }
  return '';
}

export async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const token = getApiToken();
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  return fetch(input, {
    ...init,
    headers,
  });
}
