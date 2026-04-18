import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';

// Exported as `proxy` per Next.js v16 convention (middleware.ts is deprecated)
export const proxy = createMiddleware(routing);

export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)',
  ],
};
