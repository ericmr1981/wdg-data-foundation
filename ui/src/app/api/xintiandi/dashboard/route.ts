import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSessionUser } from '@/lib/auth-server';

// GET /api/xintiandi/dashboard - 获取看板数据
export async function GET(request: Request) {
  const user = await getSessionUser();
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type') || 'overview'; // overview | trend | items | stats

    let query = '';
    let params: any[] = [];

    switch (type) {
      case 'overview':
        query = `
          SELECT 
            year_month AS "月份",
            store_name AS "门店",
            total_order_qty AS "订货数量",
            total_audit_qty AS "审核数量",
            total_ship_qty AS "发货数量",
            total_deliver_qty AS "送达数量",
            total_order_amt AS "订货金额",
            delivery_count AS "配送单数"
          FROM xintiandi.monthly_summary
          ORDER BY year_month DESC, store_name
          LIMIT 24
        `;
        break;

      case 'trend':
        query = `
          SELECT 
            year_month AS "月份",
            SUM(total_order_qty) AS "订货数量",
            SUM(total_deliver_qty) AS "送达数量",
            SUM(total_order_amt) AS "订货金额"
          FROM xintiandi.monthly_summary
          GROUP BY year_month
          ORDER BY year_month
        `;
        break;

      case 'items':
        query = `
          SELECT 
            item_category AS "品项分类",
            SUM(order_qty) AS "订货数量",
            SUM(deliver_qty) AS "送达数量",
            SUM(order_amt) AS "订货金额"
          FROM xintiandi.delivery_detail
          WHERE created_time >= CURRENT_DATE - INTERVAL '12 months'
          GROUP BY item_category
          ORDER BY SUM(order_amt) DESC
          LIMIT 50
        `;
        break;

      case 'stats':
        query = `
          SELECT 
            TO_CHAR(created_time, 'YYYY-MM') AS "月份",
            COUNT(DISTINCT delivery_no) AS "配送单数",
            COUNT(DISTINCT item_code) AS "品项数",
            ROUND(
              AVG(CASE WHEN order_qty > 0 THEN deliver_qty::numeric / order_qty * 100 ELSE 0 END),
              2
            ) AS "送达率%"
          FROM xintiandi.delivery_detail
          WHERE created_time IS NOT NULL
          GROUP BY TO_CHAR(created_time, 'YYYY-MM')
          ORDER BY "月份" DESC
        `;
        break;

      default:
        return NextResponse.json({ success: false, error: 'Invalid type' }, { status: 400 });
    }

    const result = await pool.query(query, params);
    return NextResponse.json({ success: true, data: result.rows });

  } catch (error: any) {
    console.error('Error fetching xintiandi dashboard:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
