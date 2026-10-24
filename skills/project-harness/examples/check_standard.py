"""모델 표준 점검 (docs/STANDARD.md). 사용법: python tools/check_standard.py [모델 ...] [--changed]
  모델을 적지 않으면 모든 모델. --changed 는 운영 트리에 아직 반영하지 않은 변경이 있는 모델만
  (공통함수 common/ 이 바뀌었으면 모든 모델과 공통함수 단위 시험).
  고칠 것이 있으면 종료 코드 1 과 목록. 사용자에게 알릴 것(관리 테이블 등록 등)은 '알림' 으로 적고 통과.
점검: 폴더와 config 필수 항목, 5단계가 공통함수만 쓰는지, 이 트리의 시험 기록
  (고친 뒤 5단계를 끝까지 마친 실행, 끝나지 않은 실행, 지우지 않은 raw, 학습한 모델)
"""
import argparse
import ast
import datetime as dt
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import yaml  # noqa: E402
from sqlalchemy import text  # noqa: E402

from common import db, settings, storage  # noqa: E402

STEPS = ["check_model", "train_model", "load_data", "model_infer", "remove_data"]
FILES = ["__init__.py", "config.yaml", "steps.py", "pipeline.py"]
REQUIRED = ["model_id", "title", "owner", "market", "source_table", "universe", "min_rows", "data_lag_days",
            "train_cycle_months", "train_rule", "train_days", "infer_days", "raw_format"]
# 공통함수를 쓰지 않고 직접 하는 것 (표준 3장)
DIRECT = [
    (re.compile(r"\bimport\s+boto3|\bboto3\."), "S3 를 boto3 로 직접 씀 → storage.* 로"),
    (re.compile(r"(insert\s+into|update|delete\s+from)\s+model_(run|registry)\b", re.I), "관리 테이블을 직접 고침 → registry.* 로"),
    (re.compile(r"\brelativedelta\b|\.month\s*[-+%]|train_cycle_months[\"']?\]?\s*[-+%*/]"), "학습일을 직접 계산하는 것 같음 → dates.is_train_day 로"),
]
SLACK = dt.timedelta(minutes=2)  # 파일 시각과 DB 시각의 차이


def git(*args):
    r = subprocess.run(["git", "-C", str(ROOT), *args], capture_output=True, text=True)
    return r.stdout if r.returncode == 0 else ""


def changed_paths():
    """운영 트리에 아직 반영하지 않은 변경 (운영 트리의 커밋과 비교, 새 파일 포함)"""
    prod = ROOT.parent / (ROOT.name + "-prod")
    base = subprocess.run(["git", "-C", str(prod), "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip() or "HEAD"
    paths = set(git("diff", "--name-only", base).split()) | set(git("ls-files", "--others", "--exclude-standard").split())
    return sorted(p for p in paths if (ROOT / p).exists())


def mtime(paths):
    ts = [(ROOT / p).stat().st_mtime for p in paths if (ROOT / p).is_file()]
    return dt.datetime.fromtimestamp(max(ts), dt.timezone.utc) if ts else None


def check_static(m):
    fails = []
    d = ROOT / "models" / m
    missing = [f for f in FILES if not (d / f).exists()]
    if missing:
        fails.append(f"파일이 없음: {', '.join(missing)} (표준 1장)")
    cfg = {}
    if (d / "config.yaml").exists():
        try:
            cfg = yaml.safe_load((d / "config.yaml").read_text(encoding="utf-8")) or {}
        except Exception as e:
            fails.append(f"config.yaml 을 읽지 못함: {e}")
        lack = [k for k in REQUIRED if k not in cfg]
        if lack:
            fails.append(f"config 필수 항목이 없음: {', '.join(lack)} (표준 2장)")
        if cfg.get("model_id") not in (None, m):
            fails.append(f"config 의 model_id({cfg.get('model_id')}) 가 폴더 이름과 다름")
        if "market" in cfg and cfg["market"] not in ("kr", "us"):
            fails.append(f"market 은 kr·us: {cfg['market']}")
        if "data_lag_days" in cfg and cfg.get("market") in ("kr", "us") and cfg["data_lag_days"] != (1 if cfg["market"] == "us" else 0):
            fails.append(f"data_lag_days 는 미국 1, 한국 0: {cfg['data_lag_days']}")
        if "train_cycle_months" in cfg and cfg["train_cycle_months"] not in (1, 2, 3):
            fails.append(f"train_cycle_months 는 1~3: {cfg['train_cycle_months']}")
        if "train_rule" in cfg and not re.fullmatch(r"first_business_day|day:\d{1,2}", str(cfg["train_rule"])):
            fails.append(f"train_rule 은 first_business_day 또는 day:N: {cfg['train_rule']}")
        if "raw_format" in cfg and cfg["raw_format"] not in ("parquet", "pickle"):
            fails.append(f"raw_format 은 parquet·pickle: {cfg['raw_format']}")
    if (d / "steps.py").exists():
        src = (d / "steps.py").read_text(encoding="utf-8")
        try:
            tree = ast.parse(src)
            defs = {n.name: n for n in tree.body if isinstance(n, ast.FunctionDef)}
            lack = [s for s in STEPS if s not in defs]
            if lack:
                fails.append(f"5단계 함수가 없음: {', '.join(lack)} (표준 3장)")
            if "main(globals())" not in src.replace(" ", ""):
                fails.append("steps.py 끝에 main(globals()) 가 없음")
            if "train_model" in defs and "is_train_day" not in ast.get_source_segment(src, defs["train_model"]):
                fails.append("train_model 이 dates.is_train_day 로 학습일을 정하지 않음 (표준 3장)")
        except SyntaxError as e:
            fails.append(f"steps.py 구문 오류: {e}")
        for re_, why in DIRECT:
            if re_.search(src):
                fails.append(f"steps.py: {why}")
    if (d / "pipeline.py").exists() and "common import pipeline" not in (d / "pipeline.py").read_text(encoding="utf-8"):
        fails.append("pipeline.py 가 common.pipeline 으로 만들지 않음")
    return fails, cfg


def check_runs(m, since, need_ok, need_trained=False):
    """이 트리(env)의 시험 기록. since: 마지막으로 고친 시각 (모르면 None). need_ok: 끝까지 마친 시험 실행이 있어야 하는지,
    need_trained: 학습일 시험(학습까지 하고 끝까지 마친 실행)도 있어야 하는지 (학습일 공통함수를 바꾼 때)"""
    fails, notes = [], []
    with db.lab().connect() as c:
        runs = c.execute(text("select run_id, base_date, status, trained, started_at from model_run where model_id = :m and env = :e order by run_id"),
                         dict(m=m, e=settings.ENV)).fetchall()
        registered = c.execute(text("select 1 from model_registry where model_id = :m"), dict(m=m)).first() is not None
    open_dates = set()
    for r in runs:
        if r.status == "RUNNING":
            open_dates.add(str(r.base_date))
            fails.append(f"끝나지 않은 시험 실행 run {r.run_id} ({r.base_date}): 같은 날짜로 남은 단계를 이어서 돌려 remove_data 까지 끝내거나, "
                         f"버릴 실행이면 python -c \"from common import registry; registry.register_end({r.run_id}, 'FAILED', message='시험 중단')\" 로 끝낸다")
    ok = [r for r in runs if r.status == "SUCCEEDED" and (since is None or r.started_at >= since - SLACK)]
    s3 = storage.client()
    has_model = bool(s3.list_objects_v2(Bucket=settings.S3_BUCKET, Prefix=storage.model_key(m)).get("Contents"))
    when = f"마지막으로 고친 뒤({since.astimezone().strftime('%m-%d %H:%M')}) " if since else ""
    if need_ok and need_trained and not any(r.trained for r in ok):
        # 학습일 판별 공통함수를 바꾸면 학습일이 아닌 날의 시험만으로는 학습이 되는지 모름
        fails.append(f"{when}학습일 시험(학습까지 하고 5단계를 끝까지 마친 실행)이 없음 (학습일 공통함수 common/dates.py 를 바꿈): "
                     f"이 모델의 가장 최근 학습일(dates.is_train_day 로 찾음)로 python -m models.{m}.steps all --base-date <학습일>")
    elif need_ok and not ok:
        hint = "" if has_model else (" (학습한 모델이 아직 없으면 model_infer 가 실패하므로, 먼저 가장 최근 학습일로 5단계 전체"
                                  f"(python -m models.{m}.steps all --base-date <학습일>)를 돌려 모델을 만든다. 단계를 따로 돌리면 실행 기록이 RUNNING 으로 남는다)")
        fails.append(f"{when}5단계를 끝까지 마친(SUCCEEDED) 시험 실행이 없음: python -m models.{m}.steps all --base-date <영업일>{hint}")
    elif ok and not has_model:
        fails.append(f"학습한 모델이 S3 에 없음: {storage.model_key(m)}")
    raw = [o["Key"] for o in s3.list_objects_v2(Bucket=settings.S3_BUCKET, Prefix=f"{settings.S3_ROOT}/raw/{m}/").get("Contents", [])]
    for day in sorted({k.split("/raw/", 1)[1].split("/")[1] for k in raw}):
        if day not in open_dates:
            fails.append(f"지우지 않은 raw ({day}): remove_data 가 지워야 함. 남은 것만 지우려면 "
                         f"python -c \"from common import storage; storage.delete_prefix(storage.raw_prefix('{m}', '{day}'))\"")
    if not registered:
        notes.append("관리 테이블(model_registry)에 아직 없음: 등록할 값(model_id, title, market, train_cycle_months, train_rule, owner)을 "
                     "사용자에게 알리고 승인 뒤 등록 (표준 6장)")
    return fails, notes


STATUS_RE = re.compile(r"\b(SUCCEEDED|FAILED|RUNNING|SKIPPED)\b")


def check_tool_run(t, src):
    """새·바뀐 도구를 사용자가 쓸 그대로(인자 없이) 한 번 실행해 본다 (2026-10-24 비교 시험: '운영 상태' 도구가 인자 없이는
    개발 기록만 보여 줬는데, 모델은 실행해서 빈 결과를 보고도 '정상' 이라 함).
    이 저장소의 tools/ 는 읽기만 하는 관리 도구라 인자 없이 돌려도 된다. 쓰거나 지우는 도구가 있는 저장소라면 이름으로 거르거나 이 점검을 뺀다.
    출력 점검은 개발 기록이 비어 있을 때만 확실하다 (개발 기록이 있으면 개발을 기본으로 보는 도구도 통과): 그래서 '운영을 보는 곳이 없음' 도 함께 본다"""
    why = []
    reads_runs = "model_run" in src
    if reads_runs and "prod" not in src:
        why.append("관리 테이블 실행 기록(model_run)을 읽지만 운영(env='prod')을 보는 곳이 없음: 운영 상태를 보는 도구는 개발 트리에서 돌려도 "
                   "기본으로 env='prod' 를 본다 (settings.ENV 는 이 트리의 env). 개발 기록은 --env dev 같은 인자로")
    try:
        r = subprocess.run([sys.executable, str(ROOT / t)], capture_output=True, text=True, cwd=ROOT, timeout=60)
    except subprocess.TimeoutExpired:
        return why + [f"인자 없이 실행하면 60초 안에 끝나지 않음: python {t}"]
    if r.returncode != 0:
        last = ((r.stderr or r.stdout).strip().splitlines() or [""])[-1][:200]
        return why + [f"인자 없이 실행하면 실패 (종료 코드 {r.returncode}): python {t} → {last}"]
    if reads_runs and not STATUS_RE.search(r.stdout):
        with db.lab().connect() as c:
            n = c.execute(text("select count(*) from model_run where env = 'prod'")).scalar()
        if n:
            why.append(f"운영 기록(env='prod')이 {n}건 있는데 인자 없이 실행한 출력에 실행 결과(SUCCEEDED·FAILED 등)가 하나도 없음: "
                       f"운영 상태 도구는 기본으로 env='prod' 를 보게 고치고 python {t} 로 다시 확인")
    return why


def main():
    p = argparse.ArgumentParser(description="모델 표준 점검")
    p.add_argument("models", nargs="*")
    p.add_argument("--changed", action="store_true", help="운영 트리에 아직 반영하지 않은 변경이 있는 모델만")
    a = p.parse_args()
    all_models = sorted(d.name for d in (ROOT / "models").iterdir() if d.is_dir() and not d.name.startswith(("_", ".")))
    since = {}
    common_changed = []
    tool_files = []
    if a.changed:
        paths = changed_paths()
        common_changed = [x for x in paths if x.startswith("common/") and x.endswith(".py")]
        tool_files = [x for x in paths if x.startswith("tools/") and x.endswith(".py") and x != "tools/check_standard.py"]
        by_model = {}
        for x in paths:
            if x.startswith("models/") and x.count("/") >= 2:
                by_model.setdefault(x.split("/")[1], []).append(x)
        models = all_models if common_changed else sorted(m for m in by_model if m in all_models)
        t_common = mtime(common_changed)
        for m in models:
            ts = [t for t in (mtime(by_model.get(m, [])), t_common) if t]
            since[m] = max(ts) if ts else None
    else:
        models = a.models or all_models
        unknown = [m for m in models if m not in all_models]
        if unknown:
            sys.exit(f"없는 모델: {', '.join(unknown)}")
    print(f"모델 표준 점검 ({settings.ENV} 트리" + (", 운영에 아직 반영하지 않은 변경" if a.changed else "") + f"): {', '.join(models) or '없음'}")
    with db.lab().connect() as c:
        registered = {r[0] for r in c.execute(text("select model_id from model_registry"))}
    n_fail = 0
    for m in models:
        fails, cfg = check_static(m)
        # 끝까지 마친 시험 실행: 바뀐 모델(--changed)과 아직 등록하지 않은 새 모델에만 요구 (등록된 모델 전체 점검은 남은 것만 봄)
        f2, notes = check_runs(m, since.get(m), a.changed or m not in registered, "common/dates.py" in common_changed)
        fails += f2
        if fails:
            n_fail += 1
            print(f"FAIL {m}")
            for f in fails:
                print(f"  - {f}")
        else:
            print(f"OK   {m}")
        for n in notes:
            print(f"  알림: {n}")
    for t in tool_files:
        src = (ROOT / t).read_text(encoding="utf-8")
        why = [w for re_, w in DIRECT[1:] if re_.search(src)]
        if "train_cycle_months" in src and "is_train_day" not in src:
            why.append("학습 주기를 읽지만 dates.is_train_day 를 쓰지 않음 → 학습일·다음 학습일은 dates.is_train_day 로")
        why += check_tool_run(t, src)
        if why:
            n_fail += 1
            print(f"FAIL {t}")
            for w in dict.fromkeys(why):
                print(f"  - {w}")
    if common_changed:
        r = subprocess.run([sys.executable, str(ROOT / "tests" / "test_dates.py")], capture_output=True, text=True, cwd=ROOT)
        if r.returncode != 0:
            n_fail += 1
            print("FAIL 공통함수 단위 시험 (python tests/test_dates.py)")
            print("  " + (r.stderr or r.stdout).strip().splitlines()[-1][:300])
        else:
            print("OK   공통함수 단위 시험")
    if "common/dates.py" in common_changed:
        # 표준 5장 '되도록 예전 호출도 동작하게': 예전 꼴로 한 번 불러 본다 (지침에만 적으면 모델이 지나침. 2026-10-24 비교 시험: pi 2번 모두 없앰).
        #  '되도록' 이라 실패가 아니라 알림 (일부러 막았으면 이유를 답에 적게)
        r = subprocess.run([sys.executable, "-c", "from common import dates; dates.is_train_day('2026-10-01', 1)"], capture_output=True, text=True, cwd=ROOT)
        if r.returncode != 0:
            print("  알림: 예전 호출 dates.is_train_day(base_date, cycle_months, ...) 이 더는 되지 않음 (표준 5장 '되도록 예전 호출도 동작하게'). "
                  "일부러 막았다면 이유를 사용자에게 알린다: " + (r.stderr or r.stdout).strip().splitlines()[-1][:200])
    print(f"결과: {'고칠 것이 있음 (' + str(n_fail) + '개)' if n_fail else '통과'}")
    sys.exit(1 if n_fail else 0)


if __name__ == "__main__":
    main()
