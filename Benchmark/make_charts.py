"""Render published_results.json into PNG charts in charts/ (matplotlib).

Usage: make_charts.py [--live]   --live reads results/results.json from a fresh measure.py run instead.
"""
import json, os, sys
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.ticker import FuncFormatter

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "charts")
BASE, GRAPH, BAD, INK, MUTED = "#9a9fa8", "#0f9d6e", "#d1495b", "#1f2430", "#6b7280"
FMT = FuncFormatter(lambda v, _: f"{int(v):,}")
plt.rcParams.update({"font.family": "DejaVu Sans", "axes.edgecolor": "#cbd0d8", "axes.spines.top": False,
                     "axes.spines.right": False, "text.color": INK, "axes.labelcolor": INK,
                     "xtick.color": MUTED, "ytick.color": MUTED, "figure.dpi": 100})


def load():
    if "--live" in sys.argv:
        raw = json.load(open(os.path.join(HERE, "results", "results.json"), encoding="utf-8"))
        return [dict(id=int(r["id"][1:]), task=r["name"], baseline=r["baseline"]["o200k_base"],
                     graph=r["graph"]["o200k_base"]) for r in raw]
    return json.load(open(os.path.join(HERE, "published_results.json"), encoding="utf-8"))["tasks"]


def pct(r):
    return 100 * (r["baseline"] - r["graph"]) / r["baseline"] if r["baseline"] else None


def title(fig, head, sub):
    fig.text(0.02, 0.965, head, fontsize=17, fontweight="bold", va="top")
    fig.text(0.02, 0.925, sub, fontsize=10, color=MUTED, va="top")


def save(fig, name):
    fig.savefig(os.path.join(OUT, name), dpi=170, facecolor="white")
    plt.close(fig)
    print("wrote charts/" + name)


def total(rows):
    b, g = sum(r["baseline"] for r in rows), sum(r["graph"] for r in rows)
    fig, ax = plt.subplots(figsize=(9, 3.6))
    fig.subplots_adjust(top=0.68, bottom=0.14, left=0.2, right=0.95)
    ax.barh(["synaptree", "git grep + reads"], [g, b], color=[GRAPH, BASE], height=0.55)
    for y, v in enumerate([g, b]):
        ax.text(v + b * 0.01, y, f"{v:,}", va="center", fontweight="bold")
    ax.xaxis.set_major_formatter(FMT); ax.set_xlim(0, b * 1.12)
    ax.set_xlabel("tokens to retrieve code (16 tasks)")
    title(fig, f"{int(100*(b-g)/b)}% fewer tokens to retrieve code",
          f"{b/g:.1f}x less context. Linear scale, tiktoken o200k_base, lower is better. Indexing cost excluded.")
    save(fig, "total.png")


def per_task(rows):
    rows = sorted(rows, key=lambda r: r["baseline"])
    fig, ax = plt.subplots(figsize=(11, 8))
    fig.subplots_adjust(top=0.9, bottom=0.07, left=0.31, right=0.95)
    h = 0.38
    ys = range(len(rows))
    ax.barh([y + h / 2 for y in ys], [r["baseline"] for r in rows], h, color=BASE, label="git grep + reads")
    ax.barh([y - h / 2 for y in ys], [r["graph"] for r in rows], h, color=GRAPH, label="synaptree")
    for y, r in zip(ys, rows):
        ax.text(r["baseline"] + 120, y + h / 2, f'{r["baseline"]:,}', va="center", fontsize=8, color=MUTED)
        p = pct(r)
        tag = f'{r["graph"]:,}' + (("  (+%d tokens)" % (r["graph"] - r["baseline"]) if p < 0 else f'  ({p:.0f}%)') if p is not None else "")
        ax.text(r["graph"] + 120, y - h / 2, tag, va="center", fontsize=8, fontweight="bold")
    ax.set_yticks(list(ys)); ax.set_yticklabels([f'{r["id"]}. {r["task"]}' for r in rows], fontsize=9)
    ax.xaxis.set_major_formatter(FMT); ax.set_xlim(0, 16500); ax.set_xlabel("tokens")
    ax.legend(loc="lower right", frameon=False)
    title(fig, "Tokens per task, linear scale", "Sorted by baseline cost. Bold = synaptree tokens (percent saved).")
    save(fig, "per-task.png")


def savings(rows):
    rows = sorted([r for r in rows if r["baseline"] > 0], key=pct)
    fig, ax = plt.subplots(figsize=(10, 7))
    fig.subplots_adjust(top=0.88, bottom=0.08, left=0.31, right=0.93)
    for y, r in enumerate(rows):
        p = pct(r); c = GRAPH if p >= 0 else BAD
        ax.hlines(y, 0, p, color=c, lw=2.5); ax.plot(p, y, "o", color=c, ms=8)
        lab = f"{p:.0f}%" if p >= 0 else f"+{r['graph']-r['baseline']} tokens"
        ax.text(p + (3 if p >= 0 else -3), y, lab, va="center", ha="left" if p >= 0 else "right",
                fontsize=9, fontweight="bold")
    ax.axvline(0, color=MUTED, lw=1)
    ax.set_yticks(range(len(rows))); ax.set_yticklabels([f'{r["id"]}. {r["task"]}' for r in rows], fontsize=9)
    ax.set_xlim(-130, 115); ax.set_xlabel("% of baseline tokens saved")
    title(fig, "Savings per task", "Red = synaptree costs more (tiny outputs). Task 14 (no hits, baseline 0) omitted.")
    save(fig, "savings.png")


def cumulative(rows):
    rows = sorted(rows, key=lambda r: r["id"])
    xs = [0] + [r["id"] for r in rows]
    cb, cg, sb, sg = [0], [0], 0, 0
    for r in rows:
        sb += r["baseline"]; sg += r["graph"]; cb.append(sb); cg.append(sg)
    fig, ax = plt.subplots(figsize=(10, 5.2))
    fig.subplots_adjust(top=0.85, bottom=0.11, left=0.1, right=0.95)
    ax.step(xs, cb, where="post", color=BASE, lw=2.5, label="git grep + reads")
    ax.step(xs, cg, where="post", color=GRAPH, lw=2.5, label="synaptree")
    ax.fill_between(xs, cg, cb, step="post", color=GRAPH, alpha=0.08)
    ax.annotate(f"{cb[-1]:,}", (16, cb[-1]), xytext=(-6, 8), textcoords="offset points", ha="right", color=MUTED, fontweight="bold")
    ax.annotate(f"{cg[-1]:,}", (16, cg[-1]), xytext=(-6, 8), textcoords="offset points", ha="right", color=GRAPH, fontweight="bold")
    ax.yaxis.set_major_formatter(FMT); ax.set_xticks(range(0, 17, 2)); ax.set_xlim(0, 16)
    ax.set_xlabel("tasks completed (in benchmark order)"); ax.set_ylabel("cumulative tokens")
    ax.legend(loc="upper left", frameon=False)
    title(fig, "Cumulative context cost over a 16-task session", "The gap is the context an agent keeps for reasoning instead of raw code.")
    save(fig, "cumulative.png")


def scatter(rows):
    pts = [r for r in rows if r["baseline"] > 0]
    fig, ax = plt.subplots(figsize=(8, 7))
    fig.subplots_adjust(top=0.88, bottom=0.1, left=0.12, right=0.95)
    lo, hi = 1, 30000
    ax.fill_between([lo, hi], [lo, hi], [hi, hi], color=BAD, alpha=0.05)
    for k, ls in ((1, "-"), (10, "--"), (100, ":")):
        ax.plot([lo, hi], [lo / k, hi / k], ls, color=MUTED, lw=1)
        ax.text(hi / 1.15, hi / k / 1.15 / (1.4 if k > 1 else 1), "break-even" if k == 1 else f"{k}x less",
                color=MUTED, fontsize=9, ha="right", rotation=34)
    for r in pts:
        c = GRAPH if r["graph"] < r["baseline"] else BAD
        ax.scatter(r["baseline"], r["graph"], s=70, color=c, zorder=3, edgecolor="white")
        ax.annotate(str(r["id"]), (r["baseline"], r["graph"]), xytext=(6, 4), textcoords="offset points", fontsize=8)
    ax.set_xscale("log"); ax.set_yscale("log"); ax.set_xlim(lo, hi); ax.set_ylim(1, hi)
    ax.xaxis.set_major_formatter(FMT); ax.yaxis.set_major_formatter(FMT)
    ax.set_xlabel("baseline tokens (git grep + reads)"); ax.set_ylabel("synaptree tokens")
    title(fig, "Every task vs the break-even line", "Log-log. Below the diagonal = synaptree cheaper. Numbers are task ids.")
    save(fig, "scatter.png")


def hero(rows):
    b, g = sum(r["baseline"] for r in rows), sum(r["graph"] for r in rows)
    wins = sum(r["graph"] < r["baseline"] for r in rows)
    bg, fg, acc = "#0d1117", "#e6edf3", "#3fe0a5"
    fig = plt.figure(figsize=(12, 5), facecolor=bg)
    fig.text(0.05, 0.86, "synaptree", fontsize=15, color=acc, fontweight="bold", va="top")
    fig.text(0.05, 0.78, f"{int(100*(b-g)/b)}% fewer tokens", fontsize=40, color=fg, fontweight="bold", va="top")
    fig.text(0.05, 0.60, "to find and read code, compared with git grep + line-window reads", fontsize=13, color="#8b949e", va="top")
    for i, (num, lab) in enumerate([(f"{b/g:.1f}x", "less context"), (f"{wins}/16", "tasks cheaper"), ("99%", "best case (callers)")]):
        x = 0.05 + i * 0.2
        fig.text(x, 0.48, num, fontsize=26, color=acc, fontweight="bold", va="top")
        fig.text(x, 0.40, lab, fontsize=11, color="#8b949e", va="top")
    ax = fig.add_axes([0.05, 0.08, 0.9, 0.24], facecolor=bg)
    ax.barh([1, 0], [b, g], color=["#4b5563", acc], height=0.62)
    ax.text(b - b * 0.01, 1, f"git grep + reads   {b:,}", ha="right", va="center", color=fg, fontsize=12, fontweight="bold")
    ax.text(g + b * 0.012, 0, f"synaptree   {g:,}", ha="left", va="center", color=acc, fontsize=12, fontweight="bold")
    ax.set_xlim(0, b); ax.axis("off")
    fig.text(0.95, 0.03, "16 real tasks on this repo, tiktoken o200k_base, linear scale", fontsize=8, color="#6e7681", ha="right")
    fig.savefig(os.path.join(OUT, "hero.png"), dpi=170, facecolor=bg); plt.close(fig); print("wrote charts/hero.png")


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    data = load()
    for fn in (hero, total, per_task, savings, cumulative, scatter):
        fn(data)
