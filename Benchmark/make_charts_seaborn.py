"""Seaborn variants of the main charts, written to charts/seaborn/ for comparison with the matplotlib set."""
import json, os
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import pandas as pd
import seaborn as sns

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "charts", "seaborn")
os.makedirs(OUT, exist_ok=True)
rows = json.load(open(os.path.join(HERE, "published_results.json"), encoding="utf-8"))["tasks"]
sns.set_theme(style="whitegrid", context="notebook", palette=["#9a9fa8", "#0f9d6e"])

df = pd.DataFrame(rows)
df["label"] = df["id"].astype(str) + ". " + df["task"]
df["saved"] = (df.baseline - df.graph) / df.baseline.where(df.baseline > 0) * 100

# per-task: long-form grouped bars
order = df.sort_values("baseline", ascending=False).label
long = df.melt(id_vars="label", value_vars=["baseline", "graph"], var_name="method", value_name="tokens")
long["method"] = long.method.map({"baseline": "git grep + reads", "graph": "synaptree"})
fig, ax = plt.subplots(figsize=(11, 8))
sns.barplot(data=long, y="label", x="tokens", hue="method", order=order, ax=ax)
for c in ax.containers:
    ax.bar_label(c, fmt="{:,.0f}", padding=3, fontsize=8)
ax.set(xlabel="tokens", ylabel="", xlim=(0, 16800), title="Tokens per task, linear scale")
ax.legend(title="", loc="lower right")
sns.despine()
fig.tight_layout(); fig.savefig(os.path.join(OUT, "per-task.png"), dpi=150); plt.close(fig)

# savings
d = df.dropna(subset=["saved"]).sort_values("saved")
fig, ax = plt.subplots(figsize=(10, 7))
sns.barplot(data=d, y="label", x="saved", hue="label", legend=False,
            palette=["#d1495b" if v < 0 else "#0f9d6e" for v in d.saved], ax=ax)
for c in ax.containers:
    ax.bar_label(c, fmt="%.0f%%", padding=3, fontsize=9)
ax.set(xlabel="% of baseline tokens saved", ylabel="", xlim=(-115, 115), title="Savings per task")
sns.despine()
fig.tight_layout(); fig.savefig(os.path.join(OUT, "savings.png"), dpi=150); plt.close(fig)

# total
tot = pd.DataFrame({"method": ["git grep + reads", "synaptree"], "tokens": [df.baseline.sum(), df.graph.sum()]})
fig, ax = plt.subplots(figsize=(9, 3.6))
sns.barplot(data=tot, y="method", x="tokens", hue="method", legend=False, ax=ax)
ax.bar_label(ax.containers[0], fmt="{:,.0f}", padding=4, fontweight="bold")
ax.bar_label(ax.containers[1], fmt="{:,.0f}", padding=4, fontweight="bold")
ax.set(xlabel="tokens (16 tasks)", ylabel="", xlim=(0, 60000), title="90% fewer tokens to retrieve code")
sns.despine()
fig.tight_layout(); fig.savefig(os.path.join(OUT, "total.png"), dpi=150); plt.close(fig)
print("ok")
