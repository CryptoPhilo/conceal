'use client';

import { useEffect } from 'react';
import { useParams } from 'next/navigation';

export default function LocaleSync() {
  const params = useParams();
  const locale = params?.locale as string | undefined;

  useEffect(() => {
    if (locale) {
      localStorage.setItem('NEXT_LOCALE', locale);
    }
  }, [locale]);

  return null;
}
