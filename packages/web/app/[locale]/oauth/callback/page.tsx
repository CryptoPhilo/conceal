'use client';

import { useEffect } from 'react';
import { useRouter } from '@/i18n/navigation';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

function OAuthCallbackInner() {
  const router = useRouter();
  const params = useSearchParams();

  useEffect(() => {
    const token = params.get('token');
    const error = params.get('error');
    if (token) {
      localStorage.setItem('conceal_token', token);
      router.replace('/onboarding/step2');
    } else if (error) {
      router.replace('/onboarding/step1');
    } else {
      router.replace('/onboarding/step2');
    }
  }, [params, router]);

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-950 text-white">
      <div className="text-center space-y-4">
        <div className="animate-spin w-10 h-10 border-2 border-indigo-500 border-t-transparent rounded-full mx-auto" />
        <p className="text-gray-400">계정 연결 중...</p>
      </div>
    </main>
  );
}

export default function OAuthCallback() {
  return (
    <Suspense fallback={
      <main className="min-h-screen flex items-center justify-center bg-gray-950 text-white">
        <div className="animate-spin w-10 h-10 border-2 border-indigo-500 border-t-transparent rounded-full" />
      </main>
    }>
      <OAuthCallbackInner />
    </Suspense>
  );
}
