from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import pandas as pd
import statsmodels.formula.api as smf

ROOT = Path(__file__).resolve().parents[1]
ART = ROOT / "artifacts"
SALES = ART / "sh_xtd_daily_sales_2025-08_2026-07.csv"
CALENDAR = ART / "china_calendar_shanghai_2025-08_2026-07.csv"
WEATHER = ART / "shanghai_weather_2025-08_2026-07.json"
OUT_CSV = ART / "sh_xtd_discount_free_baseline_predictions_2026-06_2026-07.csv"
OUT_JSON = ART / "sh_xtd_discount_free_baseline_summary_2026-06_2026-07.json"
OUT_REPORT = ART / "discount_free_baseline_report_2026-06_2026-07.txt"

sales = pd.read_csv(SALES, parse_dates=["date"])
calendar = pd.read_csv(CALENDAR, parse_dates=["date"])
weather_raw = json.loads(WEATHER.read_text())
weather = pd.DataFrame(weather_raw["daily"]).rename(
    columns={
        "temperature_2m_mean": "temp_mean_c",
        "precipitation_sum": "precipitation_mm",
        "rain_sum": "rain_mm",
    }
)
weather["date"] = pd.to_datetime(weather.pop("time"))

start = sales["date"].min()
end = sales["date"].max()
dates = pd.DataFrame({"date": pd.date_range(start, end, freq="D")})
df = dates.merge(calendar, on="date", how="left").merge(weather, on="date", how="left").merge(sales, on="date", how="left")
for col in ["order_count", "gross_amount", "discount_amount", "net_amount", "revenue_amount"]:
    df[col] = df[col].fillna(0)
for col in ["is_weekend", "is_holiday", "is_adjusted_workday"]:
    df[col] = df[col].fillna(0).astype(int)
df["rain_flag"] = (df["rain_mm"].fillna(0) > 0).astype(int)
df["month"] = df["date"].dt.strftime("%Y-%m")
df["dow"] = df["date"].dt.dayofweek.astype(str)
df["month_num"] = df["date"].dt.month
df["month_sin"] = np.sin(2 * np.pi * df["month_num"] / 12)
df["month_cos"] = np.cos(2 * np.pi * df["month_num"] / 12)

train_end = pd.Timestamp("2026-05-31")
test_start = pd.Timestamp("2026-06-01")
train = df[df["date"] <= train_end].copy()
test = df[(df["date"] >= test_start) & (df["date"] <= df["date"].max())].copy()
formula = "order_count ~ C(dow) + is_holiday + is_adjusted_workday + temp_mean_c + rain_flag + month_sin + month_cos"
model = smf.negativebinomial(formula, data=train).fit(disp=False, maxiter=300)
test["predicted_orders"] = model.predict(test)
test["residual_orders"] = test["order_count"] - test["predicted_orders"]
test["month_label"] = test["date"].dt.strftime("%Y-%m")

def metrics(frame: pd.DataFrame) -> dict[str, float]:
    err = frame["order_count"] - frame["predicted_orders"]
    denom = max(float(frame["order_count"].sum()), 1.0)
    return {
        "days": int(len(frame)),
        "actual_orders": float(frame["order_count"].sum()),
        "predicted_orders": float(frame["predicted_orders"].sum()),
        "incremental_orders_vs_baseline": float(err.sum()),
        "incremental_rate_vs_baseline": float(err.sum() / max(frame["predicted_orders"].sum(), 1.0)),
        "mae_orders_per_day": float(err.abs().mean()),
        "rmse_orders_per_day": float(math.sqrt((err ** 2).mean())),
        "wape": float(err.abs().sum() / denom),
        "bias_orders_per_day": float(err.mean()),
    }

monthly = {month: metrics(group) for month, group in test.groupby("month_label", sort=True)}
overall = metrics(test)
coef = float(model.params["is_holiday"]) if "is_holiday" in model.params else None
summary = {
    "train_start": str(train["date"].min().date()),
    "train_end": str(train_end.date()),
    "test_start": str(test_start.date()),
    "test_end": str(test["date"].max().date()),
    "model": "NegativeBinomial",
    "formula": formula,
    "discount_included": False,
    "weather_mode": "actual observed weather used for ex-post evaluation",
    "model_converged": bool(getattr(model, "mle_retvals", {}).get("converged", True)),
    "alpha": float(model.params.get("alpha", np.nan)),
    "overall": overall,
    "monthly": monthly,
}
test[["date", "month_label", "order_count", "predicted_orders", "residual_orders", "avg_discount_rate_pct", "is_weekend", "is_holiday", "is_adjusted_workday", "temp_mean_c", "rain_flag"]].to_csv(OUT_CSV, index=False, encoding="utf-8-sig")
OUT_JSON.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")

lines = [
    "上海 sh_xtd：不含折扣变量的订单基线预测",
    "=" * 60,
    f"训练区间：{summary['train_start']} 至 {summary['train_end']}",
    f"评估区间：{summary['test_start']} 至 {summary['test_end']}（当前订单数据实际到 2026-07-16）",
    "模型：负二项回归；未加入任何折扣字段；加入星期、季节周期、节假日、调休、平均气温和是否降雨。",
    "天气口径：使用实际观测天气，适合事后评估；如果用于真正预测，应替换为当时可获得的天气预报。",
    "",
    f"总体实际订单：{overall['actual_orders']:.0f}",
    f"总体基线预测：{overall['predicted_orders']:.1f}",
    f"实际 - 基线：{overall['incremental_orders_vs_baseline']:.1f} 单",
    f"相对基线增量率：{overall['incremental_rate_vs_baseline']:.2%}",
    f"MAE：{overall['mae_orders_per_day']:.2f} 单/日；RMSE：{overall['rmse_orders_per_day']:.2f} 单/日；WAPE：{overall['wape']:.2%}",
    "",
]
for month, item in monthly.items():
    lines.append(f"{month}：实际 {item['actual_orders']:.0f} 单；基线 {item['predicted_orders']:.1f} 单；增量 {item['incremental_orders_vs_baseline']:.1f} 单；WAPE {item['wape']:.2%}")
lines += [
    "",
    "解释：实际订单高于不含折扣基线的部分是‘超额订单’，但不能全部归因于折扣，还可能来自活动、流量、新品、库存等未纳入变量。",
    "下一步：将每日残差与平均折扣率做散点/分箱分析，并结合折扣成本估算增量净收益。",
]
OUT_REPORT.write_text("\n".join(lines), encoding="utf-8")
print(f"predictions={OUT_CSV}")
print(f"summary={OUT_JSON}")
print(f"report={OUT_REPORT}")
print(json.dumps({"overall": overall, "monthly": monthly, "alpha": summary["alpha"]}, ensure_ascii=False))
