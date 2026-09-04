import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const isDev = process.env.NODE_ENV !== 'production';
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || '';
  const isPlaceholder = !apiUrl || apiUrl.includes('hosturl') || apiUrl.includes('<') || apiUrl.includes('websiteip') || apiUrl.includes('placeholder');

  let backendOrigin = '';
  if (!isPlaceholder) {
    backendOrigin = apiUrl;
  } else {
    const hostHeader = request.headers.get('host') || request.nextUrl.host || '';
    const hostname = hostHeader.split(':')[0];
    const protocol = request.headers.get('x-forwarded-proto') || request.nextUrl.protocol.replace(':', '') || 'http';
    backendOrigin = hostname ? `${protocol}://${hostname}:8000` : '';
  }

  // M-08: Generate per-request cryptographic nonce for CSP
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);

  // M-08: Strict CSP without unsafe-inline in production
  const scriptSrc = isDev
    ? "script-src 'self' 'unsafe-eval' 'unsafe-inline'"
    : `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`;
  const styleSrc = isDev
    ? "style-src 'self' 'unsafe-inline'"
    : `style-src 'self' 'nonce-${nonce}'`;

  const connectSrc = `connect-src 'self' ${backendOrigin}`.trim();

  // M-07: Add frame-ancestors 'none', object-src 'none', base-uri 'self'
  const cspHeader = [
    "default-src 'self'",
    scriptSrc,
    styleSrc,
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    connectSrc,
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
  ].join('; ');

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
  response.headers.set('Content-Security-Policy', cspHeader);
  response.headers.set('x-nonce', nonce);

  // M-23: Standard security headers
  response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('X-Frame-Options', 'DENY');

  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
