'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'https://conceal-omega.vercel.app';

export default function Home() {
  const t = useTranslations('home');
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleOAuth(provider: 'gmail' | 'outlook') {
    setLoading(provider);
    setError(null);
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('conceal_token') : null;
      const res = await fetch(`${API_BASE}/v1/oauth/${provider}/authorize`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error((await res.json()).error ?? res.statusText);
      const { url } = await res.json();
      window.location.href = url;
    } catch {
      setError('연결 실패. 잠시 후 다시 시도해 주세요.');
      setLoading(null);
    }
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-gray-950 text-white px-6 py-12">
      {/* 3-col on desktop; CTA first, descriptions below on mobile */}
      <div className="w-full max-w-5xl grid grid-cols-1 md:grid-cols-3 gap-10 md:gap-12 items-center">

        {/* Left — value proposition (below CTA on mobile) */}
        <aside className="order-2 md:order-1 space-y-5">
          <h1 className="text-xl font-bold leading-snug whitespace-pre-line text-white">
            {t('headline')}
          </h1>
          <p className="text-gray-400 text-sm font-medium">{t('intro')}</p>
          <ul className="space-y-2.5">
            {(['benefit_1', 'benefit_2', 'benefit_3'] as const).map(key => (
              <li key={key} className="flex items-start gap-2 text-sm text-gray-300">
                <span className="text-indigo-400 mt-0.5 flex-shrink-0">✦</span>
                {t(key)}
              </li>
            ))}
          </ul>
        </aside>

        {/* Center — CTA (always first on mobile) */}
        <div className="order-1 md:order-2 space-y-4">
          {error && (
            <div className="bg-red-900/50 border border-red-700 rounded-lg p-3 text-red-300 text-sm text-center">{error}</div>
          )}

          {/* Primary CTA */}
          <button
            onClick={() => handleOAuth('gmail')}
            disabled={!!loading}
            className="w-full flex items-center justify-center gap-3 py-4 px-6 bg-white hover:bg-gray-100 text-gray-900 rounded-xl font-bold text-base transition-colors disabled:opacity-50 shadow-lg"
          >
            <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            {loading === 'gmail' ? '연결 중...' : t('cta_start')}
          </button>

          <button
            onClick={() => handleOAuth('outlook')}
            disabled={!!loading}
            className="w-full flex items-center justify-center gap-3 py-3 px-6 bg-blue-700 hover:bg-blue-600 rounded-xl font-semibold transition-colors disabled:opacity-50"
          >
            <svg className="w-5 h-5 flex-shrink-0" fill="white" viewBox="0 0 24 24"><path d="M7.88 12.04q0 .45-.11.87-.1.41-.33.74-.22.33-.58.52-.37.2-.87.2t-.85-.2q-.35-.21-.57-.55-.22-.33-.33-.75-.1-.42-.1-.86t.1-.87q.1-.43.34-.76.22-.34.59-.54.36-.2.87-.2t.86.2q.35.21.57.55.22.34.31.77.1.43.1.88zM24 12v9.38q0 .46-.33.8-.33.32-.8.32H7.13q-.46 0-.8-.33-.32-.33-.32-.8V18H1q-.41 0-.7-.3-.3-.29-.3-.7V7q0-.41.3-.7Q.58 6 1 6h6.5V2.55q0-.44.3-.75.3-.3.75-.3h12.9q.44 0 .75.3.3.3.3.75V10.85l1.24.72h.01q.07.04.11.08ZM4.13 10.05q-.35.28-.53.7-.16.4-.16.88 0 .49.17.9.17.4.52.67.36.26.86.26.44 0 .76-.15.32-.15.53-.43.21-.28.32-.64.1-.37.1-.79 0-.45-.1-.84-.1-.38-.3-.67-.21-.29-.54-.45-.32-.17-.74-.17-.49 0-.89.27zm8.31 4.62q0-.55-.14-1.03-.13-.49-.42-.85-.27-.37-.69-.58-.41-.22-.96-.22-.47 0-.86.17-.39.17-.68.47-.29.31-.44.73-.16.43-.16.97 0 .55.15 1.01.14.46.43.83.28.37.7.58.42.22.97.22.49 0 .88-.18.4-.19.67-.5.28-.3.43-.73.15-.43.15-.9zM8.49 7v3.26l-2.89 1.67q-.07.04-.11.04H8.49V7zm9.87 4.61v-.44l-4.87-2.74H12v.02l-3.51 1.99v.44l1.59.92v3.87h1.11v-3.87h1.64v3.87h1.11v-4.44l2.53 1.46h.01q.07.04.11.04l1.77-1.12zm0 5.29h-1.87v-1.34h1.87v1.34zm4.49 0h-1.87v-1.34h1.87v1.34z"/></svg>
            {loading === 'outlook' ? '연결 중...' : 'Microsoft (Outlook)'}
          </button>

          <div className="flex items-center justify-between pt-1">
            <Link
              href="/onboarding/step1"
              className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
            >
              다른 이메일 (IMAP) →
            </Link>
            <Link
              href="/dashboard"
              className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
            >
              {t('cta_dashboard')}
            </Link>
          </div>

          <p className="text-center text-xs text-gray-600">{t('privacy_note')}</p>
        </div>

        {/* Right — privacy assurance (below left on mobile) */}
        <aside className="order-3 space-y-4">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">{t('privacy_title')}</h2>
          <p className="text-gray-400 text-sm whitespace-pre-line leading-relaxed">
            {t('privacy_body')}
          </p>
          <ul className="space-y-2.5">
            {(['privacy_check_1', 'privacy_check_2', 'privacy_check_3'] as const).map(key => (
              <li key={key} className="flex items-start gap-2 text-sm text-gray-300">
                <span className="text-green-400 mt-0.5 flex-shrink-0">✓</span>
                {t(key)}
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </main>
  );
}
