/**
 * Python 찾기와 실행 (kit.ts 의 docs_lookup 과 hooks.ts 의 문법 확인이 함께 씀).
 * 이 폴더(lib)에는 index.ts 가 없으므로 pi 가 확장으로 불러오지 않는다.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

export type Proc = { code: number | null; out: string };
/** 명령 실행: 표준 출력만 모은다 (불러오는 패키지의 경고 등 표준 오류는 버림). ms 가 지나면 멈춤 */
export function runProc(cmd: string, args: string[], ms: number): Promise<Proc> {
	return new Promise((ok) => {
		let out = "";
		let done = false;
		const env = { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONWARNINGS: "ignore", PYTHONDONTWRITEBYTECODE: "1", TF_CPP_MIN_LOG_LEVEL: "3" };
		let ch: ReturnType<typeof spawn>;
		try {
			ch = spawn(cmd, args, { windowsHide: true, env });
		} catch (e) {
			return ok({ code: null, out: `(실행하지 못함: ${(e as Error).message})` });
		}
		const finish = (code: number | null, extra = "") => {
			if (done) return;
			done = true;
			ok({ code, out: out + extra });
		};
		const t = setTimeout(() => {
			ch.kill();
			finish(null, "\n(시간 초과로 멈춤)");
		}, ms);
		ch.stdout?.on("data", (d) => (out += d));
		ch.stderr?.on("data", () => {});
		ch.on("error", (e) => {
			clearTimeout(t);
			finish(null, `\n(실행하지 못함: ${e.message})`);
		});
		ch.on("close", (code) => {
			clearTimeout(t);
			finish(code);
		});
	});
}

/** 이 컴퓨터의 Python 후보 (차례대로): 작업 폴더의 가상 환경, 켜 둔 가상 환경·conda, pi 가 찾은 Python, PATH */
export function pythonCandidates(cwd: string, env = process.env, win = process.platform === "win32"): string[][] {
	const inEnv = win ? ["Scripts/python.exe", "python.exe"] : ["bin/python3", "bin/python"];
	const c: string[][] = [];
	for (const d of [".venv", "venv"]) for (const v of inEnv) c.push([join(cwd, d, v)]);
	for (const e of [env.VIRTUAL_ENV, env.CONDA_PREFIX]) if (e) for (const v of inEnv) c.push([join(e, v)]);
	if (env.PI_PYTHON_EXE) c.push([env.PI_PYTHON_EXE]);
	c.push(["python3"], ["python"]);
	if (win) c.push(["py", "-3"]);
	return c;
}
const pyCache = new Map<string, string[] | null>();
/** 작업 폴더에서 돌아가는 첫 Python (폴더마다 한 번 찾아 기억). 없으면 null */
export async function localPython(cwd: string): Promise<string[] | null> {
	if (pyCache.has(cwd)) return pyCache.get(cwd) ?? null;
	let found: string[] | null = null;
	for (const c of pythonCandidates(cwd)) {
		if (/[\\/]/.test(c[0]) && !existsSync(c[0])) continue;
		const r = await runProc(c[0], [...c.slice(1), "-c", "import sys; print(sys.executable)"], 15000);
		if (r.code === 0 && r.out.trim()) {
			found = c;
			break;
		}
	}
	pyCache.set(cwd, found);
	return found;
}

/** 노트북에서 돌아가는 Python 을 찾아 PY 에 (작업 폴더의 가상 환경, conda, pi 가 찾은 Python, python3, python 차례. 없으면 빈 값) */
export const NB_FIND_PY = [
	'PY=""',
	'for c in "$PWD/.venv/bin/python" "$PWD/venv/bin/python" "${CONDA_PREFIX:+$CONDA_PREFIX/bin/python}" "${PI_PYTHON_EXE:-}" python3 python; do',
	"  [ -n \"$c\" ] && \"$c\" -c 'import sys' >/dev/null 2>&1 && PY=\"$c\" && break",
	"done",
].join("\n");
