import { getTranslations } from 'next-intl/server';
import Link from 'next/link';

export default async function Complete() {
  const t = await getTranslations('onboarding.complete');
  const tHome = await getTranslations('home');
  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-gray-950 text-white px-4">
      <div className="max-w-md w-full text-center space-y-8">
        <div className="space-y-4">
          <div className="text-6xl">🎉</div>
          <h1 className="text-3xl font-bold">{t('title')}</h1>
          <p className="text-gray-400 whitespace-pre-line">
            {t('subtitle')}
          </p>
        </div>

        <div className="bg-gray-900 rounded-xl p-5 space-y-3 text-left">
          <h2 className="font-semibold text-sm text-gray-400">{t('whats_next')}</h2>
          <ul className="space-y-2 text-sm text-gray-300">
            <li className="flex items-start gap-2">
              <span className="text-green-400 mt-0.5">✓</span>
              {t('feature_1')}
            </li>
            <li className="flex items-start gap-2">
              <span className="text-green-400 mt-0.5">✓</span>
              {t('feature_2')}
            </li>
            <li className="flex items-start gap-2">
              <span className="text-green-400 mt-0.5">✓</span>
              {t('feature_3')}
            </li>
          </ul>
        </div>

        <Link
          href="/dashboard"
          className="block w-full py-3 px-6 bg-indigo-600 hover:bg-indigo-500 rounded-xl font-semibold text-center transition-colors"
        >
          {tHome('cta_dashboard')}
        </Link>
      </div>
    </main>
  );
}
