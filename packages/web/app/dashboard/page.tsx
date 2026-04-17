'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

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
  const [digest, setDigest] = useState<DigestItem[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [masks, setMasks] = useState<MaskAddr[]>([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);

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

  return (
    <main className="min-h-screen bg-gray-950 text-white">
      {/* Header */}
      <header className="border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <h1 className="text-xl font-bold">Conceal</h1>
        <Link href="/onboarding/step1" className="text-sm text-indigo-400 hover:text-indigo-300">
          + 계정 추가
        </Link>
      </header>

      <div className="max-w-2xl mx-auto px-4 py-8 space-y-8">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full" />
          </div>
        ) : (
          <>
            {/* Stats row */}
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-gray-900 rounded-xl p-4 text-center">
                <div className="text-2xl font-bold text-indigo-400">{accounts.length}</div>
                <div className="text-xs text-gray-400 mt-1">연결된 계정</div>
              </div>
              <div className="bg-gray-900 rounded-xl p-4 text-center">
                <div className="text-2xl font-bold text-green-400">{masks.length}</div>
                <div className="text-xs text-gray-400 mt-1">마스킹 주소</div>
              </div>
              <div className="bg-gray-900 rounded-xl p-4 text-center">
                <div className="text-2xl font-bold text-yellow-400">{digest.length}</div>
                <div className="text-xs text-gray-400 mt-1">오늘 요약</div>
              </div>
            </div>

            {/* Accounts */}
            {accounts.length > 0 && (
              <section className="space-y-3">
                <h2 className="font-semibold text-gray-300">연결된 계정</h2>
                {accounts.map(acc => (
                  <div key={acc.id} className="flex items-center gap-3 bg-gray-900 rounded-xl p-4">
                    <div className="w-9 h-9 rounded-full bg-indigo-900 flex items-center justify-center text-sm font-bold uppercase">
                      {acc.email[0]}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate">{acc.email}</div>
                      <div className="text-xs text-gray-500 capitalize">{acc.provider}</div>
                    </div>
                    <span className="text-green-400 text-xs">활성</span>
                  </div>
                ))}
              </section>
            )}

            {/* Masking addresses */}
            {masks.length > 0 && (
              <section className="space-y-3">
                <h2 className="font-semibold text-gray-300">마스킹 주소</h2>
                {masks.map(m => (
                  <button
                    key={m.id}
                    onClick={() => copy(m.address)}
                    className="w-full flex items-center justify-between bg-gray-900 hover:bg-gray-800 rounded-xl px-4 py-3 text-left transition-colors"
                  >
                    <span className="font-mono text-sm text-indigo-300 truncate">{m.address}</span>
                    <span className="text-xs text-gray-500 ml-2 flex-shrink-0">
                      {copied === m.address ? '✓ 복사됨' : '복사'}
                    </span>
                  </button>
                ))}
              </section>
            )}

            {/* Today's digest */}
            <section className="space-y-3">
              <h2 className="font-semibold text-gray-300">오늘 다이제스트</h2>
              {digest.length === 0 ? (
                <div className="bg-gray-900 rounded-xl p-6 text-center text-gray-500 text-sm">
                  오늘 처리된 이메일이 없습니다
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

            {/* Empty state prompt */}
            {accounts.length === 0 && (
              <div className="text-center space-y-4 py-8">
                <p className="text-gray-400">아직 연결된 계정이 없습니다</p>
                <Link
                  href="/onboarding/step1"
                  className="inline-block py-3 px-6 bg-indigo-600 hover:bg-indigo-500 rounded-xl font-semibold transition-colors"
                >
                  이메일 연결하기
                </Link>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
