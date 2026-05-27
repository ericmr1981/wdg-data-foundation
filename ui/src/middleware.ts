import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const COOKIE_NAME = 'wdg_session';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // public routes — login page, auth API, MCP server, and data APIs
  // (MCP tools call these internally without auth cookies)
  if (
    pathname.startsWith('/login') ||
    pathname.startsWith('/api/auth') ||
    pathname.startsWith('/api/mcp') ||
    pathname.startsWith('/api/rules') ||
    pathname.startsWith('/api/match') ||
    pathname.startsWith('/api/match/candidates') ||
    pathname.startsWith('/api/categories') ||
    pathname.startsWith('/api/coverage') ||
    pathname.startsWith('/api/approval') ||
    pathname.startsWith('/api/upload') ||
    pathname.startsWith('/api/pipeline') ||
    pathname.startsWith('/api/brands') ||
    pathname.startsWith('/api/stores') ||
    pathname.startsWith('/api/gelatomiiix/income/qimai-detail') ||
    pathname.startsWith('/api/gelatomiiix/income/upload-qimai') ||
    pathname.startsWith('/api/gelatomiiix/income/bank-entry-stats') ||
    pathname.startsWith('/api/bonjur/sales/qimai-pos') ||
    pathname.startsWith('/api/bonjur/sales/upload-self-service')
  ) {
    return NextResponse.next();
  }

  // allow next.js internals
  if (pathname.startsWith('/_next') || pathname.startsWith('/favicon')) {
    return NextResponse.next();
  }

  // if no session cookie at all, redirect to login
  if (!request.cookies.get(COOKIE_NAME)?.value) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image).*)'],
};
