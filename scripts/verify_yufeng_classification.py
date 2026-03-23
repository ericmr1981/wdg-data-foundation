#!/usr/bin/env python3
"""
Yufeng 分类验证脚本
用途：验证 T2.2/T2.3 规则落库 + 分类结果的正确性

检查点：
1. bank_rule_map 条数 > 0
2. classified 行数 = bank_txn 行数
3. lvl1 非空
4. classified_source 分布
5. 覆盖率统计

运行方式：
    python verify_yufeng_classification.py
    # 或指定数据库连接：
    DATABASE_URL=postgresql://user:pass@host:5432/dbname python verify_yufeng_classification.py
"""

import os
import sys
from dataclasses import dataclass
from typing import Optional

try:
    import psycopg2
except ImportError:
    print("ERROR: psycopg2 未安装，请运行: pip install psycopg2-binary")
    sys.exit(1)


@dataclass
class VerificationResult:
    """验证结果"""
    check_name: str
    passed: bool
    message: str
    details: Optional[dict] = None


def get_db_connection():
    """获取数据库连接"""
    # 优先使用环境变量 DATABASE_URL
    database_url = os.environ.get("DATABASE_URL")

    if database_url:
        # 解析 DATABASE_URL (postgresql://user:pass@host:5432/dbname)
        # 简单解析，不依赖 urllib
        import re
        match = re.match(
            r"postgresql://(?P<user>[^:]+):(?P<password>[^@]+)@(?P<host>[^:]+):(?P<port>\d+)/(?P<dbname>.+)",
            database_url
        )
        if match:
            return psycopg2.connect(
                host=match.group("host"),
                port=match.group("port"),
                dbname=match.group("dbname"),
                user=match.group("user"),
                password=match.group("password")
            )

    # 默认连接本地 docker PostgreSQL
    return psycopg2.connect(
        host="localhost",
        port="5432",
        dbname="yufeng",
        user="postgres",
        password="postgres"
    )


def check_rule_map_exists(conn) -> VerificationResult:
    """检查1: bank_rule_map 表存在且有条目"""
    cur = conn.cursor()

    # 检查表是否存在
    cur.execute("""
        SELECT EXISTS (
            SELECT FROM information_schema.tables
            WHERE table_schema = 'yufeng_cfg'
            AND table_name = 'bank_rule_map'
        )
    """)
    table_exists = cur.fetchone()[0]

    if not table_exists:
        return VerificationResult(
            check_name="bank_rule_map 存在性",
            passed=False,
            message="表 yufeng_cfg.bank_rule_map 不存在"
        )

    # 检查规则条数
    cur.execute("SELECT count(*) FROM yufeng_cfg.bank_rule_map")
    rule_count = cur.fetchone()[0]

    cur.close()

    if rule_count > 0:
        return VerificationResult(
            check_name="bank_rule_map 条数",
            passed=True,
            message=f"bank_rule_map 包含 {rule_count} 条规则",
            details={"rule_count": rule_count}
        )
    else:
        return VerificationResult(
            check_name="bank_rule_map 条数",
            passed=False,
            message="bank_rule_map 表为空，无规则"
        )


def check_classified_row_count(conn) -> VerificationResult:
    """检查2: classified 行数 = bank_txn 行数"""
    cur = conn.cursor()

    # 检查 bank_txn 表是否存在
    cur.execute("""
        SELECT EXISTS (
            SELECT FROM information_schema.tables
            WHERE table_schema = 'yufeng_ods'
            AND table_name = 'bank_txn'
        )
    """)
    table_exists = cur.fetchone()[0]

    if not table_exists:
        return VerificationResult(
            check_name="bank_txn 存在性",
            passed=False,
            message="表 yufeng_ods.bank_txn 不存在"
        )

    # 获取 bank_txn 行数
    cur.execute("SELECT count(*) FROM yufeng_ods.bank_txn")
    txn_count = cur.fetchone()[0]

    # 获取 classified 行数
    cur.execute("SELECT count(*) FROM yufeng_dm.v_bank_txn_classified")
    classified_count = cur.fetchone()[0]

    cur.close()

    if txn_count == classified_count:
        return VerificationResult(
            check_name="classified 行数 = bank_txn 行数",
            passed=True,
            message=f"行数一致: bank_txn={txn_count}, classified={classified_count}",
            details={"txn_count": txn_count, "classified_count": classified_count}
        )
    else:
        return VerificationResult(
            check_name="classified 行数 = bank_txn 行数",
            passed=False,
            message=f"行数不一致: bank_txn={txn_count}, classified={classified_count}",
            details={"txn_count": txn_count, "classified_count": classified_count}
        )


def check_lvl1_not_null(conn) -> VerificationResult:
    """检查3: lvl1 非空"""
    cur = conn.cursor()

    # 检查是否有 lvl1 为空或 NULL 的记录
    cur.execute("""
        SELECT count(*)
        FROM yufeng_dm.v_bank_txn_classified
        WHERE lvl1 IS NULL OR lvl1 = ''
    """)
    null_lvl1_count = cur.fetchone()[0]

    cur.close()

    if null_lvl1_count == 0:
        return VerificationResult(
            check_name="lvl1 非空",
            passed=True,
            message="所有记录 lvl1 均不为空"
        )
    else:
        return VerificationResult(
            check_name="lvl1 非空",
            passed=False,
            message=f"存在 {null_lvl1_count} 条 lvl1 为空的记录"
        )


def check_classified_source_distribution(conn) -> VerificationResult:
    """检查4: classified_source 分布"""
    cur = conn.cursor()

    cur.execute("""
        SELECT classified_source, count(*) as cnt
        FROM yufeng_dm.v_bank_txn_classified
        GROUP BY classified_source
        ORDER BY cnt DESC
    """)
    distribution = cur.fetchall()

    cur.close()

    total = sum(row[1] for row in distribution)
    result = {
        "total": total,
        "breakdown": {row[0]: row[1] for row in distribution}
    }

    # 检查是否有 override, rule, unclassified 三种来源
    sources = set(row[0] for row in distribution)
    expected_sources = {"override", "rule", "unclassified"}

    if sources.issubset(expected_sources):
        return VerificationResult(
            check_name="classified_source 分布",
            passed=True,
            message=f"分布正常: {result['breakdown']}",
            details=result
        )
    else:
        return VerificationResult(
            check_name="classified_source 分布",
            passed=False,
            message=f"分布异常: {result['breakdown']}",
            details=result
        )


def check_coverage_statistics(conn) -> VerificationResult:
    """检查5: 覆盖率统计"""
    cur = conn.cursor()

    # 检查视图是否存在
    cur.execute("""
        SELECT EXISTS (
            SELECT FROM information_schema.views
            WHERE table_schema = 'yufeng_dm'
            AND table_name = 'v_coverage_monthly'
        )
    """)
    view_exists = cur.fetchone()[0]

    if not view_exists:
        return VerificationResult(
            check_name="覆盖率统计视图",
            passed=False,
            message="视图 yufeng_dm.v_coverage_monthly 不存在"
        )

    # 获取整体覆盖率
    cur.execute("""
        SELECT
            count(*) as total_rows,
            sum(case when lvl1 != '未分类' then 1 else 0 end) as covered_rows,
            round(
                sum(case when lvl1 != '未分类' then 1 else 0 end) * 100.0 / count(*),
                2
            ) as coverage_pct
        FROM yufeng_dm.v_bank_txn_classified
    """)
    row = cur.fetchone()

    cur.close()

    total_rows = row[0] or 0
    covered_rows = row[1] or 0
    coverage_pct = row[2] or 0.0

    result = {
        "total_rows": total_rows,
        "covered_rows": covered_rows,
        "coverage_pct": coverage_pct
    }

    if total_rows == 0:
        return VerificationResult(
            check_name="覆盖率统计",
            passed=True,
            message="无流水数据（bank_txn 为空），跳过覆盖率检查",
            details=result
        )

    if coverage_pct > 0:
        return VerificationResult(
            check_name="覆盖率统计",
            passed=True,
            message=f"覆盖率: {coverage_pct}% ({covered_rows}/{total_rows})",
            details=result
        )
    else:
        return VerificationResult(
            check_name="覆盖率统计",
            passed=False,
            message=f"覆盖率过低: {coverage_pct}%",
            details=result
        )


def main():
    """主函数"""
    print("=" * 60)
    print("Yufeng 分类验证脚本")
    print("=" * 60)

    # 获取数据库连接
    try:
        conn = get_db_connection()
        print(f"✓ 数据库连接成功")
    except Exception as e:
        print(f"✗ 数据库连接失败: {e}")
        print("\n提示: 请设置 DATABASE_URL 环境变量")
        print("示例: DATABASE_URL=postgresql://user:pass@localhost:5432/yufeng python verify_yufeng_classification.py")
        sys.exit(1)

    # 执行所有检查
    checks = [
        check_rule_map_exists,
        check_classified_row_count,
        check_lvl1_not_null,
        check_classified_source_distribution,
        check_coverage_statistics,
    ]

    results = []
    for check in checks:
        try:
            result = check(conn)
            results.append(result)
        except Exception as e:
            results.append(VerificationResult(
                check_name=check.__name__,
                passed=False,
                message=f"执行失败: {e}"
            ))

    # 关闭连接
    conn.close()

    # 输出结果
    print("\n" + "-" * 60)
    print("验证结果:")
    print("-" * 60)

    passed = 0
    failed = 0

    for result in results:
        status = "✓ PASS" if result.passed else "✗ FAIL"
        print(f"\n{status} | {result.check_name}")
        print(f"     {result.message}")
        if result.details:
            for k, v in result.details.items():
                print(f"       - {k}: {v}")

        if result.passed:
            passed += 1
        else:
            failed += 1

    # 总结
    print("\n" + "=" * 60)
    print(f"总计: {passed} passed, {failed} failed")
    print("=" * 60)

    if failed > 0:
        print("\n❌ 验证失败，请检查上述错误")
        sys.exit(1)
    else:
        print("\n✅ 验证通过")
        sys.exit(0)


if __name__ == "__main__":
    main()
