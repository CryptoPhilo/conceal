const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'https://conceal-omega.vercel.app';

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('conceal_token');
}

export function setToken(token: string) {
  localStorage.setItem('conceal_token', token);
}

export function clearToken() {
  localStorage.removeItem('conceal_token');
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {}),
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? res.statusText);
  }
  return res.json();
}

export const api = {
  getOAuthUrl: (provider: 'gmail' | 'outlook' | 'yahoo') =>
    request<{ url: string }>(`/v1/oauth/${provider}/authorize`),

  getConnectedAccounts: () =>
    request<{ accounts: { id: string; email: string; provider: string }[] }>('/v1/connected-accounts'),

  connectImap: (data: { email: string; password: string; host?: string; port?: number }) =>
    request('/v1/connected-accounts/imap', { method: 'POST', body: JSON.stringify(data) }),

  getMaskingAddresses: () =>
    request<{ addresses: { id: string; address: string; accountId: string }[] }>('/v1/masking-addresses'),

  getFilterRules: () =>
    request<{ rules: { id: string; name: string; action: string }[] }>('/v1/filter-rules'),

  getDeliveryDestinations: () =>
    request<{ destinations: { id: string; type: string; target: string }[] }>('/v1/delivery-destinations'),

  getDigestToday: () =>
    request<{ items: { subject: string; from: string; summary: string }[] }>('/v1/digest/today'),

  getOnboardingStep1: () =>
    request<{ completed: boolean; connectedAccounts: number }>('/v1/onboarding/step1'),
};
