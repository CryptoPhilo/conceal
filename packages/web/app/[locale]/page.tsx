import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';

export default async function Home({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('home');

  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-gray-950 text-white px-4 py-12">
      <div className="max-w-md w-full space-y-10">
        {/* Value proposition section */}
        <div className="space-y-6">
          <h1 className="text-3xl font-bold tracking-tight leading-snug whitespace-pre-line">
            {t('headline')}
          </h1>
          <div className="space-y-2">
            <p className="text-gray-400 text-sm font-medium">{t('intro')}</p>
            <ul className="space-y-2">
              {(['benefit_1', 'benefit_2', 'benefit_3'] as const).map((key) => (
                <li key={key} className="flex items-start gap-2 text-gray-300">
                  <span className="mt-1 text-indigo-400 shrink-0">✓</span>
                  <span>{t(key)}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Privacy Assurance section */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 space-y-4">
          <h2 className="text-lg font-semibold">{t('privacy_title')}</h2>
          <p className="text-gray-400 text-sm whitespace-pre-line leading-relaxed">
            {t('privacy_body')}
          </p>
          <ul className="space-y-2">
            {(['privacy_check_1', 'privacy_check_2', 'privacy_check_3'] as const).map((key) => (
              <li key={key} className="flex items-start gap-2 text-gray-300 text-sm">
                <span className="mt-0.5 text-green-400 shrink-0">✔</span>
                <span>{t(key)}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* CTA */}
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
      </div>
    </main>
  );
}
