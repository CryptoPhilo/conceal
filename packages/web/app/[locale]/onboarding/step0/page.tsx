'use client';

import { useState, useEffect } from 'react';
import { useRouter } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'https://conceal-omega.vercel.app';

export default function Step0() {
  const router = useRouter();
  const t = useTranslations('onboarding.step0');
  const [authEmail, setAuthEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState<'accept' | 'skip' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = localStorage.getItem('conceal_token');
    if (!token) {
      router.replace('/onboarding/step1');
      return;
    }
    const email = localStorage.getItem('conceal_auth_email');
    setAuthEmail(email);
  }, [router]);

  async function handleAccept() {
    setLoading('accept');
    setError(null);
    try {
      const token = localStorage.getItem('conceal_token');
      const res = await fetch(`${API_BASE}/v1/onboarding/step0/accept`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? res.statusText);
      }
      router.push('/onboarding/step2');
    } catch (e) {
      setError(e instanceof Error ? e.message : t('error_default'));
      setLoading(null);
    }
  }

  async function handleSkip() {
    setLoading('skip');
    setError(null);
    try {
      const token = localStorage.getItem('conceal_token');
      const res = await fetch(`${API_BASE}/v1/onboarding/step0/skip`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? res.statusText);
      }
      router.push('/onboarding/step1');
    } catch (e) {
      setError(e instanceof Error ? e.message : t('error_default'));
      setLoading(null);
    }
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-gray-950 text-white px-4">
      <div className="max-w-md w-full space-y-8">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-bold">{t('title')}</h1>
          <p className="text-gray-400">{t('subtitle')}</p>
        </div>

        {authEmail && (
          <div className="bg-gray-900 border border-gray-700 rounded-xl px-6 py-4 text-center">
            <p className="text-indigo-300 font-semibold text-lg break-all">{authEmail}</p>
          </div>
        )}

        {error && (
          <div className="bg-red-900/50 border border-red-700 rounded-lg p-3 text-red-300 text-sm">
            {error}
          </div>
        )}

        <div className="space-y-3">
          <button
            onClick={handleAccept}
            disabled={!!loading}
            className="w-full flex items-center justify-center gap-2 py-3 px-6 bg-indigo-600 hover:bg-indigo-500 rounded-xl font-semibold transition-colors disabled:opacity-50"
          >
            {loading === 'accept' ? (
              <span className="animate-spin w-5 h-5 border-2 border-white border-t-transparent rounded-full inline-block" />
            ) : null}
            {t('accept')}
          </button>

          <button
            onClick={handleSkip}
            disabled={!!loading}
            className="w-full flex items-center justify-center gap-2 py-3 px-6 border border-gray-700 hover:border-gray-500 rounded-xl font-semibold text-gray-300 transition-colors disabled:opacity-50"
          >
            {loading === 'skip' ? (
              <span className="animate-spin w-5 h-5 border-2 border-gray-400 border-t-transparent rounded-full inline-block" />
            ) : null}
            {t('skip')}
          </button>
        </div>
      </div>
    </main>
  );
}
