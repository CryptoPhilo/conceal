'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useLocale } from 'next-intl';
import { useRouter, usePathname } from '@/i18n/navigation';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'https://conceal-omega.vercel.app';

const LOCALES = ['ko', 'en'] as const;
type SupportedLocale = (typeof LOCALES)[number];

const LOCALE_META: Record<SupportedLocale, { abbr: string; label: string }> = {
  ko: { abbr: 'KO', label: '한국어' },
  en: { abbr: 'EN', label: 'English' },
};

export default function LanguageSwitcher() {
  const locale = useLocale() as SupportedLocale;
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [visible, setVisible] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const closeDropdown = useCallback(() => {
    setVisible(false);
    setTimeout(() => setOpen(false), 80);
  }, []);

  const openDropdown = useCallback(() => {
    setOpen(true);
    requestAnimationFrame(() => setVisible(true));
  }, []);

  useEffect(() => {
    if (!open) return;
    function handleOutsideClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        closeDropdown();
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') closeDropdown();
    }
    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, closeDropdown]);

  async function switchLocale(next: SupportedLocale) {
    if (next === locale) {
      closeDropdown();
      return;
    }
    localStorage.setItem('NEXT_LOCALE', next);
    const token = localStorage.getItem('conceal_token');
    if (token) {
      fetch(`${API_BASE}/api/users/me`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ preferred_language: next }),
      }).catch(() => {});
    }
    closeDropdown();
    router.replace(pathname, { locale: next });
  }

  const current = LOCALE_META[locale] ?? { abbr: locale.toUpperCase(), label: locale };

  return (
    <>
      {/* Desktop dropdown (≥768px) */}
      <div ref={dropdownRef} className="relative hidden md:block">
        <button
          type="button"
          onClick={() => (open ? closeDropdown() : openDropdown())}
          aria-expanded={open}
          aria-haspopup="listbox"
          className="flex items-center gap-1.5 h-8 px-3 text-[13px] font-medium text-gray-300 hover:text-white rounded-md hover:bg-gray-800 transition-colors cursor-pointer select-none"
        >
          <span aria-hidden="true">🌐</span>
          <span>{current.abbr}</span>
          <span aria-hidden="true" className="text-[10px] leading-none">▾</span>
        </button>

        {open && (
          <div
            role="listbox"
            aria-label="Language"
            className="absolute right-0 top-full mt-1 z-50 min-w-[140px] overflow-hidden rounded-lg border border-gray-700 bg-gray-900 shadow-lg"
            style={{
              opacity: visible ? 1 : 0,
              transform: visible ? 'translateY(0)' : 'translateY(-4px)',
              transition: visible
                ? 'opacity 120ms ease, transform 120ms ease'
                : 'opacity 80ms ease, transform 80ms ease',
            }}
          >
            {LOCALES.map((l) => (
              <button
                key={l}
                type="button"
                role="option"
                aria-selected={l === locale}
                onClick={() => switchLocale(l)}
                className={`flex w-full items-center justify-between px-4 py-2.5 text-[13px] transition-colors hover:bg-gray-800 ${
                  l === locale ? 'text-white' : 'text-gray-400'
                }`}
              >
                <span>{LOCALE_META[l].label}</span>
                {l === locale && (
                  <span className="text-indigo-400" aria-hidden="true">✓</span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Mobile tab toggle (≤767px) */}
      <div
        className="flex md:hidden items-center text-[13px] font-medium"
        role="group"
        aria-label="Language"
      >
        {LOCALES.map((l, i) => (
          <button
            key={l}
            type="button"
            aria-pressed={l === locale}
            onClick={() => switchLocale(l)}
            className={`h-7 px-2.5 border border-gray-700 transition-colors ${
              i === 0 ? 'rounded-l-md border-r-0' : 'rounded-r-md'
            } ${
              l === locale
                ? 'bg-indigo-600 text-white border-indigo-500'
                : 'bg-gray-900 text-gray-400 hover:text-white hover:bg-gray-800'
            }`}
          >
            {LOCALE_META[l].abbr}
          </button>
        ))}
      </div>
    </>
  );
}
