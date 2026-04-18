'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

const IOS_STEPS_KO = [
  '아이폰 설정 앱을 엽니다',
  '아래로 스크롤하여 "Mail" 탭합니다',
  '"계정" → "계정 추가"를 탭합니다',
  '"기타" → "Mail 계정 추가"를 선택합니다',
  '마스킹 주소와 앱 비밀번호를 입력합니다',
];

const ANDROID_STEPS_KO = [
  'Gmail 앱 또는 설정 앱을 엽니다',
  '"계정 관리" → "계정 추가"를 탭합니다',
  '"이메일" → "기타"를 선택합니다',
  '마스킹 주소와 앱 비밀번호를 입력합니다',
  'IMAP 서버: imap.conceal.app, 포트: 993을 입력합니다',
];

export default function Step3() {
  const router = useRouter();
  const t = useTranslations('onboarding.step3');
  const tDash = useTranslations('dashboard');
  const [platform, setPlatform] = useState<'ios' | 'android'>('ios');
  const [copied, setCopied] = useState(false);

  const maskAddr = 'mask-' + Math.random().toString(36).slice(2, 8) + '@conceal.app';

  function copyAddress() {
    navigator.clipboard.writeText(maskAddr);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const iosSteps = tDash.raw('ios_steps') as string[] ?? IOS_STEPS_KO;
  const androidSteps = tDash.raw('android_steps') as string[] ?? ANDROID_STEPS_KO;
  const steps = platform === 'ios' ? iosSteps : androidSteps;

  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-gray-950 text-white px-4 py-12">
      <div className="max-w-md w-full space-y-8">
        {/* Progress */}
        <div className="flex items-center gap-2">
          <span className="w-8 h-8 rounded-full bg-indigo-600/40 flex items-center justify-center text-sm text-indigo-400">✓</span>
          <div className="h-1 flex-1 bg-indigo-600 rounded" />
          <span className="w-8 h-8 rounded-full bg-indigo-600/40 flex items-center justify-center text-sm text-indigo-400">✓</span>
          <div className="h-1 flex-1 bg-indigo-600 rounded" />
          <span className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center text-sm font-bold">3</span>
        </div>

        <div className="space-y-2">
          <h1 className="text-2xl font-bold">{t('title')}</h1>
          <p className="text-gray-400 text-sm">{t('subtitle')}</p>
        </div>

        {/* Platform selector */}
        <div className="flex gap-2 bg-gray-900 p-1 rounded-xl">
          {(['ios', 'android'] as const).map(p => (
            <button
              key={p}
              onClick={() => setPlatform(p)}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${platform === p ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-gray-200'}`}
            >
              {p === 'ios' ? tDash('ios_label') : tDash('android_label')}
            </button>
          ))}
        </div>

        {/* Masking address */}
        <div className="bg-gray-900 rounded-xl p-4 space-y-2">
          <p className="text-sm text-gray-400">{t('mask_hint')}</p>
          <button
            onClick={copyAddress}
            className="w-full text-left font-mono text-indigo-300 bg-gray-800 rounded-lg px-3 py-2 text-sm hover:bg-gray-700 transition-colors flex items-center justify-between"
          >
            <span>{maskAddr}</span>
            <span className="text-xs text-gray-500">{copied ? tDash('copied') : tDash('copy')}</span>
          </button>
        </div>

        {/* Steps */}
        <ol className="space-y-3">
          {steps.map((step, i) => (
            <li key={i} className="flex items-start gap-3">
              <span className="w-6 h-6 rounded-full bg-gray-800 flex-shrink-0 flex items-center justify-center text-xs font-bold text-indigo-400">
                {i + 1}
              </span>
              <span className="text-sm text-gray-300 pt-0.5">{step}</span>
            </li>
          ))}
        </ol>

        <div className="flex gap-3">
          <button
            onClick={() => router.push('/onboarding/step2')}
            className="flex-1 py-3 px-4 border border-gray-700 hover:border-gray-500 rounded-xl text-sm text-gray-400 transition-colors"
          >
            {t('prev')}
          </button>
          <button
            onClick={() => router.push('/onboarding/complete')}
            className="flex-[2] py-3 px-6 bg-indigo-600 hover:bg-indigo-500 rounded-xl font-semibold transition-colors"
          >
            {t('finish')}
          </button>
        </div>

        <button
          onClick={() => router.push('/onboarding/complete')}
          className="w-full py-2 text-gray-500 hover:text-gray-300 text-sm text-center transition-colors"
        >
          {t('skip')}
        </button>
      </div>
    </main>
  );
}
