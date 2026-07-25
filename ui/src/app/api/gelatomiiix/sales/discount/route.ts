// Gelatomiiix | 蜜可诗 折扣率分析 API
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getErrorMessage } from '@/lib/query-types';

const ODS = 'gelatomiiix_ods';

export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const storeCode = searchParams.get('store') ?? null;
    const excludeGifts = searchParams.get('exclude_gifts') === 'true';
    const monthRaw = searchParams.get('month') ?? null;
    const month = monthRaw && monthRaw.length === 7 ? monthRaw + '-01' : monthRaw;

    try {
        const conds: string[] = ['NOT i.is_refund', 'i.gross_amt > 0', 'i.payment_methods IS NOT NULL'];
        const p: unknown[] = [];

        if (storeCode) {
            p.push(storeCode);
            conds.push(`i.store_code = $${p.length}`);
        }
        if (excludeGifts) {
            conds.push('i.revenue_amt > i.discount_amt');
        }
        // month filter ONLY for summary/channels/bands — NOT for trend
        // trend query uses `where` (below); summary/channels/bands use `whereMonth`

        const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

        // Monthly filter for summary/channels/bands (not trend)
        const monthConds = [...conds];
        if (month) {
            monthConds.push(`date_trunc('month', i.biz_date)::date = $${p.length + 1}::date`);
        }
        const whereMonth = monthConds.length ? `WHERE ${monthConds.join(' AND ')}` : '';

        // 1. Monthly trend — last 12 months, not affected by month filter
        const trendQuery = `
            WITH monthly AS (
                SELECT
                    date_trunc('month', i.biz_date)::date AS month,
                    COUNT(*) AS order_cnt,
                    ROUND(SUM(i.gross_amt)::numeric, 0) AS total_gross,
                    ROUND(SUM(i.discount_amt)::numeric, 0) AS total_disc,
                    ROUND(SUM(i.coupon_fee)::numeric, 0) AS total_coupon,
                    ROUND(SUM(i.revenue_amt)::numeric, 0) AS total_revenue,
                    ROUND(SUM(i.net_amt)::numeric, 0) AS total_net,
                    ROUND(100.0 * SUM(i.discount_amt) / NULLIF(SUM(i.gross_amt), 0), 2) AS disc_rate_pct,
                    ROUND(100.0 * SUM(i.coupon_fee) / NULLIF(SUM(i.revenue_amt), 0), 2) AS coupon_rate_pct,
                    ROUND(100.0 * SUM(i.net_amt) / NULLIF(SUM(i.gross_amt), 0), 2) AS net_rate_pct
                FROM ${ODS}.income_detail i
                ${where}
                GROUP BY month ORDER BY month DESC LIMIT 12
            )
            SELECT * FROM monthly ORDER BY month`;

        // 2. Channel breakdown — respects month filter
        const channelQuery = `
            SELECT
                COALESCE(i.payment_methods[1], '未知') AS channel,
                COUNT(*) AS order_cnt,
                ROUND(SUM(i.gross_amt)::numeric, 0) AS total_gross,
                ROUND(SUM(i.discount_amt)::numeric, 0) AS total_disc,
                ROUND(SUM(i.net_amt)::numeric, 0) AS total_net,
                ROUND(100.0 * SUM(i.discount_amt) / NULLIF(SUM(i.gross_amt), 0), 2) AS disc_rate_pct,
                ROUND(100.0 * SUM(i.net_amt) / NULLIF(SUM(i.gross_amt), 0), 2) AS net_rate_pct,
                ROUND(AVG(i.gross_amt)::numeric, 0) AS avg_order_value
            FROM ${ODS}.income_detail i
            ${whereMonth}
            GROUP BY channel ORDER BY total_gross DESC`;

        // 3. Discount band distribution — respects month filter
        // 5% bucket aggregation; rate = 100 * discount_amt / gross_amt, clamped to [0, 100].
        const bandQuery = `
            WITH bands AS (
                SELECT
                    date_trunc('month', i.biz_date)::date AS month,
                    LEAST(
                        100.0,
                        GREATEST(0.0, 100.0 * i.discount_amt / NULLIF(i.gross_amt, 0))
                    ) AS rate_pct,
                    COUNT(*) AS order_cnt,
                    ROUND(SUM(i.gross_amt)::numeric, 0) AS total_gross
                FROM ${ODS}.income_detail i
                ${whereMonth}
                GROUP BY month, rate_pct
            )
            SELECT
                month,
                CASE
                    WHEN rate_pct = 0 THEN '0%'
                    WHEN rate_pct >= 100 THEN '100%+'::text
                    ELSE (FLOOR(rate_pct / 5) * 5)::int::text || '%'
                END AS disc_band,
                SUM(order_cnt)::bigint AS order_cnt,
                SUM(total_gross)::numeric AS total_gross
            FROM bands
            GROUP BY month, disc_band
            ORDER BY month, disc_band`;

        // 4. Summary — respects month filter
        const summaryQuery = `
            SELECT
                COUNT(*) AS total_orders,
                ROUND(SUM(i.gross_amt)::numeric, 0) AS total_gross,
                ROUND(SUM(i.discount_amt)::numeric, 0) AS total_disc,
                ROUND(SUM(i.coupon_fee)::numeric, 0) AS total_coupon,
                ROUND(SUM(i.net_amt)::numeric, 0) AS total_net,
                ROUND(100.0 * SUM(i.discount_amt) / NULLIF(SUM(i.gross_amt), 0), 2) AS avg_disc_rate,
                ROUND(100.0 * SUM(i.coupon_fee) / NULLIF(SUM(i.revenue_amt), 0), 2) AS avg_coupon_rate,
                ROUND(100.0 * SUM(i.net_amt) / NULLIF(SUM(i.gross_amt), 0), 2) AS avg_net_rate,
                COUNT(*) FILTER (WHERE i.discount_amt = 0) AS zero_disc_orders,
                COUNT(*) FILTER (WHERE i.revenue_amt <= i.discount_amt) AS gift_orders
            FROM ${ODS}.income_detail i
            ${whereMonth}`;

        const [trendR, channelR, bandR, summaryR] = await Promise.all([
            pool.query(trendQuery, p),
            pool.query(channelQuery, month ? [...p, month] : p),
            pool.query(bandQuery, month ? [...p, month] : p),
            pool.query(summaryQuery, month ? [...p, month] : p),
        ]);

        return NextResponse.json({
            success: true,
            data: {
                trend: trendR.rows,
                channels: channelR.rows,
                bands: bandR.rows,
                summary: summaryR.rows[0] ?? null,
            },
        });
    } catch (error) {
        return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
    }
}
