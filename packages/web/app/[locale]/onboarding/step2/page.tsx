'use client';

import { useEffect, useState } from 'react';
import { useRouter } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'https://conceal-omega.vercel.app';

interface FilterRule {
  id: string;
  name: string;
  action: string;
}

export default function Step2() {
  const router = useRouter();
  const t = useTranslations('onboarding.step2');
  const tDash = useTranslations('dashboard');
  const [rules, setRules] = useState<FilterRule[]>([]);
  const [accounts, setAccounts] = useState<{ id: string; email: string; provider: string }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('conceal_token');
    const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};

    Promise.all([
      fetch(`${API_BASE}/v1/filter-rules`, { headers }).then(r => r.json()),
      fetch(`${API_BASE}/v1/connected-accounts`, { headers }).then(r => r.json()),
    ]).then(([rulesData, accountsData]) => {
      setRules(rulesData.rules ?? []);
      setAccounts(accountsData.accounts ?? []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const subscriptionCount = rules.filter(r => r.action === 'unsubscribe' || r.action === 'archive').length;

  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-gray-950 text-white px-4 py-12">
      <div className="max-w-md w-full space-y-8">
        <div className="flex items-center gap-2">
          <span className="w-8 h-8 rounded-full bg-indigo-600/40 flex items-center justify-center text-sm text-indigo-400">✓</span>
          <div className="h-1 flex-1 bg-indigo-600 rounded" />
          <span className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center text-sm font-bold">2</span>
          <div className="h-1 flex-1 bg-gray-800 rounded" />
          <span className="w-8 h-8 rounded-full bg-gray-800 flex items-center justify-center text-sm text-gray-500">3</span>
        </div>

        <div className="space-y-2">
          <h1 className="text-2xl font-bold">{t('title')}</h1>
          <p className="text-gray-400 text-sm">{t('subtitle')}</p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full" />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="bg-indigo-900/30 border border-indigo-700/50 rounded-xl p-5 space-y-4">
              <h2 className="font-semibold text-indigo-300">{t('analysis_title')}</h2>
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-gray-900/50 rounded-lg p-3 text-center">
                  <div className="text-3xl font-bold text-indigo-400">{accounts.length}</div>
                  <div className="text-xs text-gray-400 mt-1">{tDash('stats.accounts')}</div>
                </div>
                <div className="bg-gray-900/50 rounded-lg p-3 text-center">
                  <div className="text-3xl font-bold text-green-400">{rules.length}</div>
                  <div className="text-xs text-gray-400 mt-1">{t('active_filters')}</div>
                </div>
              </div>
              {subscriptionCount > 0 && (
                <p className="text-sm text-gray-300">
                  🎉 <span className="text-white font-semibold">{t('subscription_auto', { count: subscriptionCount })}</span>
                </p>
              )}
            </div>

            {accounts.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-medium text-gray-400">{tDash('accounts_section')}</h3>
                {accounts.map(acc => (
                  <div key={acc.id} className="flex items-center gap-3 bg-gray-900 rounded-lg p-3">
                    <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center text-xs font-bold uppercase">
                      {acc.email[0]}
                    </div>
                    <div>
                      <div className="text-sm font-medium">{acc.email}</div>
                      <div className="text-xs text-gray-500 capitalize">{acc.provider}</div>
                    </div>
                    <span className="ml-auto text-green-400 text-xs">{t('account_connected')}</span>
                  </div>
                ))}
              </div>
            )}

            {rules.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-medium text-gray-400">{t('filter_rules', { count: rules.length })}</h3>
                <div className="space-y-1 max-h-36 overflow-y-auto">
                  {rules.map(rule => (
                    <div key={rule.id} className="flex items-center justify-between bg-gray-900 rounded-lg px-3 py-2">
                      <span className="text-sm">{rule.name}</span>
                      <span className="text-xs text-gray-500 bg-gray-800 px-2 py-0.5 rounded">{rule.action}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="flex gap-3">
          <button
            onClick={() => router.push('/onboarding/step1')}
            className="flex-1 py-3 px-4 border border-gray-700 hover:border-gray-500 rounded-xl text-sm text-gray-400 transition-colors"
          >
            {t('prev')}
          </button>
          <button
            onClick={() => router.push('/dashboard')}
            className="flex-[2] py-3 px-6 bg-indigo-600 hover:bg-indigo-500 rounded-xl font-semibold transition-colors"
          >
            {t('next')}
          </button>
        </div>

        <button
          onClick={() => router.push('/dashboard')}
          className="w-full py-2 text-gray-500 hover:text-gray-300 text-sm text-center transition-colors"
        >
          {t('skip_later')}
        </button>
      </div>
    </main>
  );
}
