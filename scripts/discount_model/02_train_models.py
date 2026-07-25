#!/usr/bin/env python3
"""
02_train_models.py — 训练三个折扣率模型 + 无折扣基线
  - OLS, Poisson, NegativeBinomial（拟合现有 fit_discount_order_regression 逻辑）
  - 无折扣基线（拟合现有 fit_discount_free_baseline 逻辑）
  - 写 coefficients + baseline + dataset_meta（覆盖）snapshots
  - 不切换 is_active（由 03_publish_results.py 切换）
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import date
from pathlib import Path

import _common as cm
from _common import step_context, artifact_path, CancelToken, format_error


SCRIPTS_DIR = Path(__file__).resolve().parent.parent


def _load_dataset(start: date, end: date, store_code: str):
    import pandas as pd
    p = artifact_path(f"{store_code}_daily_regression_dataset_{start.isoformat()}_{end.isoformat()}.csv")
    return pd.read_csv(p, parse_dates=["date"]), p


def fit_discount_models(run_id: str, start: date, end: date, store_code: str) -> dict:
    """拟合 OLS / Poisson / 负二项，结果写入 coefficients snapshot。"""
    import pandas as pd
    import statsmodels.api as sm
    import statsmodels.formula.api as smf
    import math

    df, p = _load_dataset(start, end, store_code)
    token = CancelToken(run_id)

    formula = ("order_count ~ avg_discount_rate_pct + is_weekend + is_holiday + "
               "is_adjusted_workday + temp_mean_c + rain_flag + C(month)")

    # OLS
    if token.check(): raise RuntimeError("cancel_requested")
    ols = smf.ols(formula, data=df).fit(cov_type="HC3")
    # Poisson
    if token.check(): raise RuntimeError("cancel_requested")
    poisson = smf.glm(formula, data=df, family=sm.families.Poisson()).fit(cov_type="HC3")
    # NegativeBinomial
    if token.check(): raise RuntimeError("cancel_requested")
    nb = smf.negativebinomial(formula, data=df).fit(disp=False, maxiter=200)

    # 相关矩阵（简单相关）
    corr = df[["order_count", "avg_discount_rate_pct", "is_weekend",
               "is_holiday", "temp_mean_c", "rain_flag"]].corr(numeric_only=True)

    def coef_row(model, name):
        b = model.params["avg_discount_rate_pct"]
        return {
            "model": name,
            "coef_avg_discount_rate_pct": float(b),
            "exp_coef": float(math.exp(b)),
            "std_err": float(model.bse.get("avg_discount_rate_pct", float("nan"))),
            "p_value": float(model.pvalues.get("avg_discount_rate_pct", float("nan"))),
        }

    ols_row = coef_row(ols, "OLS")
    poi_row = coef_row(poisson, "Poisson")
    nb_row = coef_row(nb, "NegativeBinomial")

    # 过度离散
    pearson_disp = float(poisson.pearson_chi2 / poisson.df_resid) if poisson.df_resid else None

    payload = {
        "n_obs": int(df.shape[0]),
        "n_orders": int(df["order_count"].sum()) if "order_count" in df.columns else 0,
        "data_range": {
            "start": df["date"].min().date().isoformat(),
            "end": df["date"].max().date().isoformat(),
        },
        "simple_correlation": {
            "avg_discount_rate_pct_vs_order_count": float(
                corr.loc["order_count", "avg_discount_rate_pct"]
            ),
        },
        "ols_r_squared": float(ols.rsquared),
        "poisson_pearson_dispersion": pearson_disp,
        "negative_binomial_alpha": float(nb.params.get("alpha", float("nan"))),
        "models": [ols_row, poi_row, nb_row],
        "formula": formula,
        "caveats": [
            "统计关联，不等于因果；可能存在反向因果：订单低迷时商家提高折扣",
            "Poisson 过度离散明显，正式推断建议改用负二项或按日期聚类稳健标准误",
            "本结果为单店（sh_xtd）截面，长季节变化尚需更多年份数据",
        ],
    }
    return payload


def fit_baseline(run_id: str, train_start: date, train_end: date,
                 eval_start: date, eval_end: date, store_code: str) -> dict:
    """无折扣基线：训练 + 评估期预测 + 残差。"""
    import pandas as pd
    import statsmodels.formula.api as smf
    import math

    df, _ = _load_dataset(date.fromisoformat("2025-08-01"),
                          date.fromisoformat("2026-07-31"), store_code)
    token = CancelToken(run_id)

    if token.check(): raise RuntimeError("cancel_requested")
    df["month"] = df["date"].dt.strftime("%Y-%m")
    df["dow"] = df["date"].dt.dayofweek.astype(str)

    train = df[(df["date"] >= pd.Timestamp(train_start)) &
               (df["date"] <= pd.Timestamp(train_end))].copy()
    eval_df = df[(df["date"] >= pd.Timestamp(eval_start)) &
                 (df["date"] <= pd.Timestamp(eval_end))].copy()

    formula = ("order_count ~ C(dow) + is_holiday + "
               "is_adjusted_workday + temp_mean_c + rain_flag")
    if token.check(): raise RuntimeError("cancel_requested")
    model = smf.negativebinomial(formula, data=train).fit(disp=False, maxiter=200)
    if token.check(): raise RuntimeError("cancel_requested")

    pred = model.predict(eval_df)
    eval_df = eval_df.assign(predicted_orders=pred.values)
    eval_df["residual_orders"] = eval_df["order_count"] - eval_df["predicted_orders"]
    eval_df["date"] = eval_df["date"].dt.strftime("%Y-%m-%d")

    daily = eval_df[["date", "order_count", "predicted_orders",
                     "residual_orders", "avg_discount_rate_pct"]].to_dict("records")

    total_actual = float(eval_df["order_count"].sum())
    total_pred = float(eval_df["predicted_orders"].sum())
    mae = float((eval_df["residual_orders"].abs()).mean())
    rmse = float(((eval_df["residual_orders"]) ** 2).mean() ** 0.5)
    bias = float((eval_df["predicted_orders"] - eval_df["order_count"]).mean())
    wape = (eval_df["residual_orders"].abs().sum() / eval_df["order_count"].sum()
            if eval_df["order_count"].sum() else None)

    payload = {
        "train_range": {"start": train_start.isoformat(),
                        "end": train_end.isoformat()},
        "eval_range": {"start": eval_start.isoformat(),
                       "end": eval_end.isoformat()},
        "store_code": store_code,
        "alpha": float(model.params.get("alpha", float("nan"))),
        "n_train": int(len(train)),
        "n_eval": int(len(eval_df)),
        "metrics": {
            "actual_orders": total_actual,
            "predicted_orders": total_pred,
            "residual_orders": total_actual - total_pred,
            "lift_vs_baseline_pct": (
                (total_actual - total_pred) / total_pred * 100.0
                if total_pred else None
            ),
            "MAE": mae,
            "RMSE": rmse,
            "Bias": bias,
            "WAPE": float(wape) if wape is not None else None,
        },
        "daily": daily,
        "formula": formula,
        "caveats": [
            "天气使用事后实际观测，仅适合事后评估；真正预测请改用当时天气预报",
            "评估期短（46 天），单门店 sh_xtd，不能直接归因于折扣",
            "WAPE 较大说明模型系统性低估，需补充活动/平台流量等变量",
        ],
    }
    return payload


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument("--start", default="2025-08-01")
    parser.add_argument("--end", default="2026-07-31")
    parser.add_argument("--train-end", default="2026-05-31")
    parser.add_argument("--store-code", default="sh_xtd")
    args = parser.parse_args()

    start = date.fromisoformat(args.start)
    end = date.fromisoformat(args.end)
    train_end = date.fromisoformat(args.train_end)
    eval_start = train_end + __import__("datetime").timedelta(days=1)
    eval_end = end

    cm.create_pipeline_run(
        run_id=args.run_id, version=args.version, pipeline="train",
        store_code=args.store_code,
        data_range_start=args.start, data_range_end=args.end,
    )

    with step_context(args.run_id, "fit_discount_models", 1,
                      detail={"formula": "OLS/Poisson/NegativeBinomial",
                              "data_range": [args.start, args.end]}) as r:
        coef_payload = fit_discount_models(args.run_id, start, end, args.store_code)
        r["rows_out"] = 3
        r["detail"] = {"n_obs": coef_payload["n_obs"]}

    with step_context(args.run_id, "write_coefficients_snapshot", 2) as r:
        cm.upsert_snapshot(
            version=args.version, kind="coefficients",
            store_code=args.store_code,
            payload=coef_payload, run_id=args.run_id,
        )
        r["detail"] = {"version": args.version, "kind": "coefficients"}

    # 2) 拟合无折扣基线
    with step_context(args.run_id, "fit_baseline", 3,
                      detail={"train_end": args.train_end,
                              "eval_range": [eval_start.isoformat(), eval_end.isoformat()]}) as r:
        baseline_payload = fit_baseline(
            args.run_id, start, train_end, eval_start, eval_end, args.store_code,
        )
        r["rows_out"] = baseline_payload["n_eval"]

    with step_context(args.run_id, "write_baseline_snapshot", 4) as r:
        cm.upsert_snapshot(
            version=args.version, kind="baseline",
            store_code=args.store_code,
            payload=baseline_payload, run_id=args.run_id,
        )
        r["detail"] = {"version": args.version, "kind": "baseline",
                       "n_eval": baseline_payload["n_eval"]}

    cm.finish_pipeline_run(args.run_id, status="success",
                          warnings=["train 阶段不切换 is_active，需 publish 完成"])
    print(f"[train] run {args.run_id} version {args.version} success")


if __name__ == "__main__":
    main()