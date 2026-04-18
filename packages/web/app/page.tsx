import { getTranslations } from 'next-intl/server';
import Link from 'next/link';

export default async function Home() {
  const t = await getTranslations('home');
  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-gray-950 text-white px-4">
      <div className="max-w-md w-full text-center space-y-8">
        <div className="space-y-3">
          <h1 className="text-4xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-gray-400 text-lg whitespace-pre-line">
            {t('tagline')}
          </p>
        </div>

        <div className="space-y-3">
          <Link
            href="/onboarding/step1"
            className="block w-full py-3 px-6 bg-indigo-600 hover:bg-indigo-500 rounded-xl font-semibold text-center transition-colors"
          >
            {t('cta_start')}
          </Link>
          <Link
            href="/dashboard"
            className="block w-full py-3 px-6 border border-gray-700 hover:border-gray-500 rounded-xl font-semibold text-center transition-colors text-gray-300"
          >
            {t('cta_dashboard')}
          </Link>
        </div>

        <p className="text-gray-600 text-sm">
          {t('privacy_note')}
        </p>
      </div>
    </main>
  );
}
