'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'https://conceal-omega.vercel.app';

const IOS_STEPS = [
  '아이폰 설정 앱을 엽니다',
  '아래로 스크롤하여 "Mail" 탭합니다',
  '"계정" → "계정 추가"를 탭합니다',
  '"기타" → "Mail 계정 추가"를 선택합니다',
  '마스킹 주소와 앱 비밀번호를 입력합니다',
];

const ANDROID_STEPS = [
  'Gmail 앱 또는 설정 앱을 엽니다',
  '"계정 관리" → "계정 추가"를 탭합니다',
  '"이메일" → "기타"를 선택합니다',
  '마스킹 주소와 앱 비밀번호를 입력합니다',
  'IMAP 서버: imap.conceal.app, 포트: 993을 입력합니다',
];

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
  const [platform, setPlatform] = useState<'ios' | 'android'>('ios');
  const [setupOpen, setSetupOpen] = useState(false);

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

  const maskAddr = masks[0]?.address;
  const steps = platform === 'ios' ? IOS_STEPS : ANDROID_STEPS;

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

            {/* Smartphone setup guide */}
            {accounts.length > 0 && (
              <section className="space-y-3">
                <button
                  onClick={() => setSetupOpen(o => !o)}
                  className="w-full flex items-center justify-between bg-gray-900 hover:bg-gray-800 rounded-xl px-4 py-4 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-lg">📱</span>
                    <div className="text-left">
                      <div className="font-medium text-sm">스마트폰 이메일 설정</div>
                      <div className="text-xs text-gray-500 mt-0.5">iOS / Android 기기에서 Conceal 사용하기</div>
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
                          {p === 'ios' ? '📱 iOS' : '🤖 Android'}
                        </button>
                      ))}
                    </div>

                    {maskAddr && (
                      <div className="space-y-1.5">
                        <p className="text-xs text-gray-400">마스킹 주소 (탭하여 복사)</p>
                        <button
                          onClick={() => copy(maskAddr)}
                          className="w-full text-left font-mono text-indigo-300 bg-gray-800 rounded-lg px-3 py-2 text-sm hover:bg-gray-700 transition-colors flex items-center justify-between"
                        >
                          <span className="truncate">{maskAddr}</span>
                          <span className="text-xs text-gray-500 ml-2 flex-shrink-0">
                            {copied === maskAddr ? '✓ 복사됨' : '복사'}
                          </span>
                        </button>
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
