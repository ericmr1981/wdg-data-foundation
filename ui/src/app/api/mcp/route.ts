import { NextRequest, NextResponse } from 'next/server';
import { handleJsonRpcRequest } from '@/mcp/server';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const cookieHeader = request.headers.get('cookie');
    const result = await handleJsonRpcRequest(
      body,
      new URL(request.url).origin,
      cookieHeader,
    );
    return NextResponse.json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { jsonrpc: '2.0', id: null, error: { code: -32603, message: `Internal error: ${msg}` } },
      { status: 500 },
    );
  }
}

export async function GET() {
  return NextResponse.json({
    jsonrpc: '2.0',
    result: {
      name:        'wdg-bank-agent',
      version:    '1.1.0',
      description: 'MCP server for WDG data platform - 7 modules: bank-classification, store-report, financial-statements, income/sales (gelatomiiix/bonjur), pipeline, tamkoko inventory, admin metadata. v1.1 adds cross-brand reconciliation tools (get_unmatched_orders, get_settlement_cycle_recon, etc.) for per-channel Qimai-to-bank matching.',
      methods: [
        'initialize',
        'ping',
        'tools/list',
        'tools/call',
      ],
    },
  });
}