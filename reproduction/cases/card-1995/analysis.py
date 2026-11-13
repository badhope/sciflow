"""Card (1995) 教育回报率复现（轻量经济学案例）。

数据来自 wooldridge 包内置 `card` 数据集，无需外部下载。
- naive：只回归 lwage ~ educ，遗漏经验/地区/种族控制，系数会低于论文。
- controlled：加入 exper/expersq/black/smsa/south，并用 nearc4 作为 educ 的工具变量。

输出 JSON：ols_educ / ols_se / iv_educ / iv_se / nobs / spec。
"""
import argparse
import json
import os
import warnings

import statsmodels.api as sm
import statsmodels.formula.api as smf
import wooldridge as w
from statsmodels.sandbox.regression.gmm import IV2SLS

warnings.filterwarnings("ignore")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--spec", choices=["naive", "controlled"], required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    cols = ["lwage", "educ", "exper", "expersq", "black", "smsa", "south", "nearc4"]
    df = w.data("card").dropna(subset=cols)

    if args.spec == "naive":
        ols = smf.ols("lwage ~ educ", data=df).fit(cov_type="HC1")
        result = {
            "spec": "naive",
            "formula": "lwage ~ educ",
            "ols_educ": float(ols.params["educ"]),
            "ols_se": float(ols.bse["educ"]),
            "nobs": int(ols.nobs),
        }
    else:
        formula = "lwage ~ educ + exper + expersq + black + smsa + south"
        ols = smf.ols(formula, data=df).fit(cov_type="HC1")
        exog = sm.add_constant(df[["educ", "exper", "expersq", "black", "smsa", "south"]])
        inst = sm.add_constant(df[["nearc4", "exper", "expersq", "black", "smsa", "south"]])
        iv = IV2SLS(df["lwage"], exog, inst).fit()
        result = {
            "spec": "controlled",
            "formula": formula,
            "instrument": "nearc4",
            "ols_educ": float(ols.params["educ"]),
            "ols_se": float(ols.bse["educ"]),
            "iv_educ": float(iv.params["educ"]),
            "iv_se": float(iv.bse["educ"]),
            "nobs": int(ols.nobs),
        }

    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    print(f"RESULT_JSON:{os.path.abspath(args.out)}")


if __name__ == "__main__":
    main()
