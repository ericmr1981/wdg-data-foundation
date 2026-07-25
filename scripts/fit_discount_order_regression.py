from __future__ import annotations

import json
from pathlib import Path

import pandas as pd
import statsmodels.api as sm
import statsmodels.formula.api as smf

ROOT = Path(__file__).resolve().parents[1]
ART = ROOT / "artifacts"
SALES = ART / "sh_xtd_daily_sales_2025-08_2026-07.csv"
CALENDAR = ART / "china_calendar_shanghai_2025-08_2026-07.csv"
WEATHER = ART / "shanghai_weather_2025-08_2026-07.json"
OUT_DATA = ART / "sh_xtd_daily_regression_dataset_2025-08_2026-07.csv"
OUT_REPORT = ART / "discount_order_regression_report_2025-08_2026-07.txt"

sales = pd.read_csv(SALES, parse_dates=["date"])
calendar = pd.read_csv(CALENDAR, parse_dates=["date"])
weather_json = json.loads(WEATHER.read_text())
weather = pd.DataFrame(weather_json["daily"])
weather = weather.rename(
    columns={
        "temperature_2m_mean": "temp_mean_c",
        "temperature_2m_max": "temp_max_c",
        "temperature_2m_min": "temp_min_c",
        "precipitation_sum": "precipitation_mm",
        "rain_sum": "rain_mm",
        "weather_code": "weather_code",
    }
)
weather["date"] = pd.to_datetime(weather["time"])
weather = weather.drop(columns=["time"])

# Use the date span actually covered by the order table; missing dates inside it are zero-order days.
start = sales["date"].min()
end = sales["date"].max()
dates = pd.DataFrame({"date": pd.date_range(start, end, freq="D")})
df = dates.merge(calendar, on="date", how="left").merge(weather, on="date", how="left").merge(sales, on="date", how="left")
for col in ["order_count", "gross_amount", "discount_amount", "net_amount", "revenue_amount"]:
    df[col] = df[col].fillna(0)
for col in ["avg_discount_rate_pct", "net_rate_pct"]:
    df[col] = df[col].fillna(0)
for col in ["is_weekend", "is_holiday", "is_adjusted_workday"]:
    df[col] = df[col].fillna(0).astype(int)
df["rain_flag"] = (df["rain_mm"].fillna(0) > 0).astype(int)
df["month"] = df["date"].dt.strftime("%Y-%m")
df["dow"] = df["date"].dt.dayofweek.astype(str)
df["log_order_count"] = __import__("numpy").log1p(df["order_count"])
df.to_csv(OUT_DATA, index=False, encoding="utf-8-sig")

formula = "log_order_count ~ avg_discount_rate_pct + is_weekend + is_holiday + is_adjusted_workday + temp_mean_c + rain_flag + C(month)"
ols = smf.ols(formula, data=df).fit(cov_type="HC3")
poisson = smf.glm(
    "order_count ~ avg_discount_rate_pct + is_weekend + is_holiday + is_adjusted_workday + temp_mean_c + rain_flag + C(month)",
    data=df,
    family=sm.families.Poisson(),
).fit(cov_type="HC3")
negative_binomial = smf.negativebinomial(
    "order_count ~ avg_discount_rate_pct + is_weekend + is_holiday + is_adjusted_workday + temp_mean_c + rain_flag + C(month)",
    data=df,
).fit(disp=False, maxiter=200)

corr = df[["order_count", "avg_discount_rate_pct", "is_weekend", "is_holiday", "temp_mean_c", "rain_flag"]].corr(numeric_only=True)
coef = ols.params.get("avg_discount_rate_pct", float("nan"))
pcoef = poisson.params.get("avg_discount_rate_pct", float("nan"))
nbcoef = negative_binomial.params.get("avg_discount_rate_pct", float("nan"))
nbalpha = negative_binomial.params.get("alpha", float("nan"))

lines = []
lines.append("上海 sh_xtd：订单数量与折扣关系（日级回归分析）")
lines.append("=" * 60)
lines.append(f"数据区间：{start.date()} 至 {end.date()}（订单表实际覆盖区间；用户目标区间为 2025-08 至 2026-07）")
lines.append(f"样本量：{len(df)} 个日历日；订单总数：{df['order_count'].sum():,.0f}")
lines.append("订单口径：NOT is_refund、gross_amt > 0、payment_methods 非空、revenue_amt > discount_amt、store_code = sh_xtd")
lines.append("节假日来源：中国政府网 2025/2026 国务院办公厅节假日安排通知；天气来源：Open-Meteo Archive API（上海 31.2304, 121.4737）")
lines.append("来源链接：2025 https://www.gov.cn/zhengce/content/202411/content_6986382.htm；2026 https://www.gov.cn/gongbao/2025/issue_12406/202511/content_7048922.html；天气 API https://archive-api.open-meteo.com/")
lines.append("")
lines.append("模型：OLS（因变量 log(1 + 日订单数)，HC3 稳健标准误）")
lines.append("解释变量：平均折扣率、周末、法定节假日、调休工作日、平均气温、是否降雨、月份固定效应")
lines.append("")
lines.append(ols.summary().as_text())
lines.append("")
lines.append("模型：Poisson GLM（因变量日订单数，HC3 稳健标准误）")
lines.append(poisson.summary().as_text())
lines.append("")
lines.append("模型：负二项回归（MLE，计数型订单模型）")
lines.append(negative_binomial.summary().as_text())
lines.append("")
lines.append("关键结论（仅表示控制变量后的统计关联，不等同于因果）：")
lines.append(f"- OLS 中平均折扣率系数：{coef:.6f}；折扣率每增加 1 个百分点，log(1+订单数) 的估计变化约为 {coef:.4%}。")
lines.append(f"- Poisson 中平均折扣率系数：{pcoef:.6f}；对应订单期望的乘数约为 exp(coef)={__import__('math').exp(pcoef):.4f}。")
lines.append(f"- 负二项回归中平均折扣率系数：{nbcoef:.6f}；exp(coef)={__import__('math').exp(nbcoef):.4f}，alpha={nbalpha:.4f}。")
lines.append(f"- 折扣率与订单数的简单相关系数：{corr.loc['order_count', 'avg_discount_rate_pct']:.4f}（未控制季节、天气和日历因素）。")
lines.append(f"- Poisson 过度离散检查：Pearson chi-square / residual df = {poisson.pearson_chi2 / poisson.df_resid:.2f}；因此同时提供负二项回归结果，负二项 alpha={nbalpha:.4f}。")
lines.append("")
lines.append("重要限制：")
lines.append("- 订单数据从 2025-08-17 开始，且目前到 2026-07-16；2026-07-17 至 2026-07-31 尚无订单/天气实测数据，不能当作已观测样本。")
lines.append("- 当前只有一个门店，无法加入门店固定效应，也不能识别门店间差异。")
lines.append("- Poisson 过度离散明显；本报告已补充负二项回归，但负二项结果默认使用 MLE 非稳健协方差，正式推断仍可进一步采用按日期聚类稳健标准误。")
lines.append("- 折扣可能因订单低迷而被提高，存在反向因果；本模型只能说明控制后的关联，不能证明折扣造成了订单增长。")
lines.append("- 如要做因果结论，下一步应使用门店/日期层面的 A/B 折扣试验或差分中的差分。")
OUT_REPORT.write_text("\n".join(lines), encoding="utf-8")
print(f"dataset={OUT_DATA}")
print(f"report={OUT_REPORT}")
print(f"rows={len(df)} ols_discount_coef={coef:.6f} poisson_discount_coef={pcoef:.6f} corr={corr.loc['order_count', 'avg_discount_rate_pct']:.4f}")
