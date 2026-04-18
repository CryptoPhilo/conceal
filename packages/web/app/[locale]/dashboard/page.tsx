'use client';

import { useEffect, useState } from 'react';
import { Link, useRouter } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'https://conceal-omega.vercel.app';

interface DigestItem {
  subject: string;
  from: string;
  summary: string;
}

interface Account {
  id: string;
  email: string;
  provider: string;
}

interface MaskAddr {
  id: string;
  address: string;
}

export default function Dashboard() {
  const t = useTranslations('dashboard');
  const [digest, setDigest] = useState<DigestItem[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [masks, setMasks] = useState<MaskAddr[]>([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);
  const [platform, setPlatform] = useState<'ios' | 'android'>('ios');
  const [setupOpen, setSetupOpen] = useState(false);
  const [selectedMask, setSelectedMask] = useState<string | null>(null);
  const [creatingMask, setCreatingMask] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('conceal_token');
    const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};

    Promise.all([
      fetch(`${API_BASE}/v1/digest/today`, { headers }).then(r => r.json()).catch(() => ({ items: [] })),
      fetch(`${API_BASE}/v1/connected-accounts`, { headers }).then(r => r.json()).catch(() => ({ accounts: [] })),
      fetch(`${API_BASE}/v1/masking-addresses`, { headers }).then(r => r.json()).catch(() => ({ addresses: [] })),
    ]).then(([d, a, m]) => {
      setDigest(d.items ?? []);
      setAccounts(a.accounts ?? []);
      setMasks(m.addresses ?? []);
      setLoading(false);
    });
  }, []);

  function copy(text: string) {
    navigator.clipboard.writeText(text);
    setCopied(text);
    setTimeout(() => setCopied(null), 2000);
  }

  async function createMask() {
    const token = localStorage.getItem('conceal_token');
    if (!token) return;
    setCreatingMask(true);
    try {
      const res = await fetch(`${API_BASE}/v1/masking-addresses`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (res.ok) {
        const newMask = await res.json() as MaskAddr;
        setMasks(prev => [newMask, ...prev]);
        setSelectedMask(newMask.address);
      }
    } finally {
      setCreatingMask(false);
    }
  }

  const maskAddr = selectedMask ?? masks[0]?.address ?? null;
  const iosSteps = t.raw('ios_steps') as string[];
  const androidSteps = t.raw('android_steps') as string[];
  const steps = platform === 'ios' ? iosSteps : androidSteps;

  return (
    <main className="min-h-screen bg-gray-950 text-white">
      <header className="border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <h1 className="text-xl font-bold">{t('title')}</h1>
        <Link href="/onboarding/step1" className="text-sm text-indigo-400 hover:text-indigo-300">
          {t('add_account')}
        </Link>
      </header>

      <div className="max-w-2xl mx-auto px-4 py-8 space-y-8">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full" />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-gray-900 rounded-xl p-4 text-center">
                <div className="text-2xl font-bold text-indigo-400">{accounts.length}</div>
                <div className="text-xs text-gray-400 mt-1">{t('stats.accounts')}</div>
              </div>
              <div className="bg-gray-900 rounded-xl p-4 text-center">
                <div className="text-2xl font-bold text-green-400">{masks.length}</div>
                <div className="text-xs text-gray-400 mt-1">{t('stats.masks')}</div>
              </div>
              <div className="bg-gray-900 rounded-xl p-4 text-center">
                <div className="text-2xl font-bold text-yellow-400">{digest.length}</div>
                <div className="text-xs text-gray-400 mt-1">{t('stats.digest')}</div>
              </div>
            </div>

            {accounts.length > 0 && (
              <section className="space-y-3">
                <h2 className="font-semibold text-gray-300">{t('accounts_section')}</h2>
                {accounts.map(acc => (
                  <div key={acc.id} className="flex items-center gap-3 bg-gray-900 rounded-xl p-4">
                    <div className="w-9 h-9 rounded-full bg-indigo-900 flex items-center justify-center text-sm font-bold uppercase">
                      {acc.email[0]}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate">{acc.email}</div>
                      <div className="text-xs text-gray-500 capitalize">{acc.provider}</div>
                    </div>
                    <span className="text-green-400 text-xs">{t('account_active')}</span>
                  </div>
                ))}
              </section>
            )}

            {(masks.length > 0 || accounts.length > 0) && (
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="font-semibold text-gray-300">{t('masks_section')}</h2>
                  <button
                    onClick={createMask}
                    disabled={creatingMask}
                    className="text-xs text-indigo-400 hover:text-indigo-300 disabled:opacity-50 transition-colors"
                  >
                    {creatingMask ? t('creating_mask') : t('new_mask')}
                  </button>
                </div>
                {masks.length === 0 && (
                  <div className="bg-gray-900 rounded-xl px-4 py-3 text-sm text-gray-500">
                    {t('no_masks')}
                  </div>
                )}
                {masks.map(m => (
                  <button
                    key={m.id}
                    onClick={() => copy(m.address)}
                    className="w-full flex items-center justify-between bg-gray-900 hover:bg-gray-800 rounded-xl px-4 py-3 text-left transition-colors"
                  >
                    <span className="font-mono text-sm text-indigo-300 truncate">{m.address}</span>
                    <span className="text-xs text-gray-500 ml-2 flex-shrink-0">
                      {copied === m.address ? t('copied') : t('copy')}
                    </span>
                  </button>
                ))}
              </section>
            )}

            {accounts.length > 0 && (
              <section className="space-y-3">
                <button
                  onClick={() => setSetupOpen(o => !o)}
                  className="w-full flex items-center justify-between bg-gray-900 hover:bg-gray-800 rounded-xl px-4 py-4 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-lg">📱</span>
                    <div className="text-left">
                      <div className="font-medium text-sm">{t('smartphone_setup')}</div>
                      <div className="text-xs text-gray-500 mt-0.5">{t('smartphone_subtitle')}</div>
                    </div>
                  </div>
                  <span className="text-gray-500 text-sm">{setupOpen ? '▲' : '▼'}</span>
                </button>

                {setupOpen && (
                  <div className="bg-gray-900 rounded-xl p-4 space-y-4">
                    <div className="flex gap-2 bg-gray-800 p-1 rounded-lg">
                      {(['ios', 'android'] as const).map(p => (
                        <button
                          key={p}
                          onClick={() => setPlatform(p)}
                          className={`flex-1 py-1.5 rounded-md text-sm font-medium transition-colors ${platform === p ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-gray-200'}`}
                        >
                          {p === 'ios' ? t('ios_label') : t('android_label')}
                        </button>
                      ))}
                    </div>

                    {masks.length > 0 && (
                      <div className="space-y-1.5">
                        <p className="text-xs text-gray-400">
                          {t('masking_address')}{masks.length > 1 ? t('mask_copy_hint_multi') : t('mask_copy_hint_single')}
                        </p>
                        {masks.length > 1 && (
                          <div className="space-y-1">
                            {masks.map(m => (
                              <button
                                key={m.id}
                                onClick={() => setSelectedMask(m.address)}
                                className={`w-full text-left font-mono text-sm rounded-lg px-3 py-2 transition-colors flex items-center justify-between ${maskAddr === m.address ? 'bg-indigo-900/60 border border-indigo-600 text-indigo-200' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}
                              >
                                <span className="truncate">{m.address}</span>
                                {maskAddr === m.address && <span className="text-xs text-indigo-400 ml-2 flex-shrink-0">{t('selected')}</span>}
                              </button>
                            ))}
                          </div>
                        )}
                        {maskAddr && (
                          <button
                            onClick={() => copy(maskAddr)}
                            className="w-full text-left font-mono text-indigo-300 bg-gray-800 rounded-lg px-3 py-2 text-sm hover:bg-gray-700 transition-colors flex items-center justify-between"
                          >
                            <span className="truncate">{maskAddr}</span>
                            <span className="text-xs text-gray-500 ml-2 flex-shrink-0">
                              {copied === maskAddr ? t('copied') : t('copy')}
                            </span>
                          </button>
                        )}
                      </div>
                    )}

                    <ol className="space-y-2.5">
                      {steps.map((step, i) => (
                        <li key={i} className="flex items-start gap-3">
                          <span className="w-5 h-5 rounded-full bg-gray-800 border border-gray-700 flex-shrink-0 flex items-center justify-center text-xs font-bold text-indigo-400">
                            {i + 1}
                          </span>
                          <span className="text-sm text-gray-300 pt-0.5">{step}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
              </section>
            )}

            <section className="space-y-3">
              <h2 className="font-semibold text-gray-300">{t('digest_section')}</h2>
              {digest.length === 0 ? (
                <div className="bg-gray-900 rounded-xl p-6 text-center text-gray-500 text-sm">
                  {t('digest_empty')}
                </div>
              ) : (
                <div className="space-y-2">
                  {digest.map((item, i) => (
                    <div key={i} className="bg-gray-900 rounded-xl p-4 space-y-1">
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-medium text-sm">{item.subject}</span>
                      </div>
                      <div className="text-xs text-gray-500">{item.from}</div>
                      {item.summary && (
                        <div className="text-sm text-gray-300 mt-2">{item.summary}</div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>

            {accounts.length === 0 && (
              <div className="text-center space-y-4 py-8">
                <p className="text-gray-400">{t('no_accounts')}</p>
                <Link
                  href="/onboarding/step1"
                  className="inline-block py-3 px-6 bg-indigo-600 hover:bg-indigo-500 rounded-xl font-semibold transition-colors"
                >
                  {t('connect_email')}
                </Link>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
