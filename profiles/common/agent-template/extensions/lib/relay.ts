/**
 * 확장끼리 함께 쓰는 도우미 (undo.ts, memory.ts, modes.ts, files.ts, kit.ts, wiki.ts): 지금 작업 폴더, 파일 읽기·쓰기·지우기,
 * 요청 앞에 알림을 붙일 때 사용자가 친 그대로를 남기기 (transformInput, rawInput).
 * jupyter 모드(PC 의 pi 가 명령·파일 작업을 노트북에서)면 중계 서버를 거쳐 노트북 파일을 다룬다.
 * 지금 작업 폴더는 jupyter.ts 가 globalThis.__piWorkDir 로 알려 준다 (없으면 pi 를 시작한 폴더).
 * 이 폴더(lib)에는 index.ts 가 없으므로 pi 가 확장으로 불러오지 않는다.
 */

import { spawn } from "node:child_process";
import { promises as fsp, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, posix, resolve } from "node:path";
import { cleanPath, isPcAbsolute, windowsDrivePath } from "./paths.ts";

export const SERVER = (process.env.PI_COPILOT_URL || "http://127.0.0.1:8765").replace(/\/+$/, "");
export const SESSION: string = ((globalThis as any).__piSession ||=
	process.env.PI_COPILOT_SESSION || `${process.pid}-${Math.random().toString(36).slice(2, 8)}`);

export class RelayError extends Error {
	code?: string;
}

export async function call(path: string, body?: unknown): Promise<any> {
	let res: Response;
	try {
		res = await fetch(SERVER + path, {
			method: body === undefined ? "GET" : "POST",
			headers: { "Content-Type": "application/json", "X-Pi-Session": SESSION },
			body: body === undefined ? undefined : JSON.stringify(body),
		});
	} catch (e) {
		throw new RelayError(`PC 의 중계 서버(${SERVER})에 연결할 수 없습니다 (${(e as Error).message})`);
	}
	let data: any = {};
	try {
		data = await res.json();
	} catch {}
	if (!res.ok || data.ok === false) {
		const err = new RelayError(data.error || `중계 서버 오류 (HTTP ${res.status})`);
		if (data.code) err.code = data.code;
		throw err;
	}
	return data;
}

export type RelayOps = {
	readTarget?: typeof readTarget;
	readHead?: typeof readHead;
	writeTarget?: typeof writeTarget;
	removeTarget?: typeof removeTarget;
	runHere?: typeof runHere;
	nbRun?: typeof nbRun;
};
const relayMock = (): RelayOps | undefined => (globalThis as any).__piRelayMock;
/** 시험용: 원격 파일·명령 함수(readTarget, writeTarget, runHere 등)를 가짜 함수로 바꿈 (인자 없이 부르면 원래대로) */
export function setRelayMock(mock?: RelayOps | null) {
	(globalThis as any).__piRelayMock = mock || undefined;
}

/** 노트북에서 명령 실행 (끝날 때까지) */
export async function nbRun(command: string, cwd: string): Promise<{ code: number | null; out: string }> {
	if (relayMock()?.nbRun) return relayMock()!.nbRun!(command, cwd);
	const { id } = await call("/jupyter/exec", { cwd, command, timeout: 600 });
	const chunks: Buffer[] = [];
	let offset = 0;
	while (true) {
		const st = await call(`/jupyter/exec/${id}?offset=${offset}&wait=2`);
		if (st.data) {
			const b = Buffer.from(st.data, "base64");
			chunks.push(b);
			offset += b.length;
		}
		if (st.done || st.aborted || st.timedOut) return { code: st.done ? st.exitCode : null, out: Buffer.concat(chunks).toString("utf8") };
	}
}

export const shq = (s: string) => "'" + s.replace(/'/g, "'\\''") + "'";
export type WorkDir = { remote: boolean; cwd: string; home?: string };
export const workDir = (): WorkDir => (globalThis as any).__piWorkDir || { remote: false, cwd: process.cwd() };
/** 노트북에서 Python 부르기 (셸 명령의 앞부분, 뒤에 -c '<코드>' 와 인자를 붙임): python3 가 없으면 python, 둘 다 없으면 까닭을 알리고 127 */
export const NB_PY = `{ p="$(command -v python3 || command -v python)"; [ -n "$p" ] || { echo "노트북에서 python3 를 찾지 못했습니다" >&2; exit 127; }; } && "$p"`;
/** 노트북에 내용을 먼저 올려 둘 임시 파일 (명령 인자 길이 한도를 피함: Linux 는 인자 하나에 128KB, Windows 는 명령 줄 32K 자). 쓰는 명령이 끝에 지움 */
export const nbUpload = (wd: WorkDir = workDir()) =>
	`${wd.remote ? wd.home || "/home/jovyan" : homedir().split("\\").join("/")}/.pi/agent/.pi-upload-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`;
/** 같은 PVC를 쓰는 노트북 실행인지. 브리지는 remote, API 키트는 실행기가 PI_API_KIT=1 로 밝힌다. */
/** 노트북(Kubeflow) 안에서 도는 pi 인지: API 키트 실행기(bin/pi)의 PI_API_KIT=1, 없으면 Kubeflow 가 노트북 파드에 넣는 NB_PREFIX.
 *  (업데이트 전에 켠 pi 가 /new·/reload 로 새 확장만 불러왔거나, 다른 실행기로 켰을 때도 노트북으로 알아보게. PC 에는 NB_PREFIX 가 없음) */
export const onNotebook = () => process.env.PI_API_KIT === "1" || !!process.env.NB_PREFIX;
export const notebookMode = (wd: WorkDir = workDir()) => !!wd.remote || onNotebook();
export const notebookHome = (wd: WorkDir = workDir()) => wd.remote ? wd.home || "/home/jovyan" : homedir().split("\\").join("/");

/** 브리지(Copilot 중계 서버)를 쓰는지: models.json 에 127.0.0.1:8765 주소가 있는지 */
export const isBridge = (agentD?: string) => {
	const dir = agentD || process.env.PI_CODING_AGENT_DIR || resolve(homedir(), ".pi", "agent");
	try {
		return readFileSync(resolve(dir, "models.json"), "utf8").includes("127.0.0.1:8765");
	} catch {
		return false;
	}
};

/** 작은 모델 방어(model_profile: small) 켜기 여부:
 *  내 설정 "model_profile" 이 "small" 이면 켬, "default"·"off" 면 끔,
 *  없으면 API 키트(onNotebook())이고 브리지가 아닐 때(!isBridge()) 켬.
 *  원래 키트 PC 설치와 Copilot 중계 서버에서는 늘 꺼짐. */
export function smallModel(cfg?: any): boolean {
	let conf = cfg;
	if (conf === undefined) {
		const cfgPath = process.env.PI_COPILOT_USER_CONFIG || resolve(process.env.PI_CODING_AGENT_DIR || resolve(homedir(), ".pi", "agent"), "bridge.json");
		try {
			conf = JSON.parse(readFileSync(cfgPath, "utf8"));
		} catch {
			conf = {};
		}
	}
	const profile = conf?.model_profile;
	if (profile === "small") return true;
	if (profile === "default" || profile === "off") return false;
	return onNotebook() && !isBridge();
}
/** pi 설정 안에서도 두 키트가 함께 써야 하는 파일. 일반 target()은 jupyter의 설정 경로를 PC로 보내므로 이 용도에는 이 함수를 쓴다. */
export function notebookTarget(path: string, wd: WorkDir = workDir()): Target {
	const home = notebookHome(wd);
	const abs = path === "~" || path.startsWith("~/") ? home + path.slice(1) : posix.resolve(home, path);
	return { abs, remote: !!wd.remote };
}

/** pi 의 bash 도구와 같은 셸 (Windows 에서 cmd·PowerShell 로 pi.cmd 를 켜면 PATH 의 bash 가 WSL 의 것일 수 있어 pi 가 고른 것으로) */
export async function piShell(): Promise<{ shell: string; args: string[]; stdin: boolean }> {
	try {
		const m: any = await import("@earendil-works/pi-coding-agent");
		const c = typeof m.getShellConfig === "function" ? m.getShellConfig() : null;
		if (c?.shell) return { shell: c.shell, args: Array.isArray(c.args) ? c.args : ["-c"], stdin: c.commandTransport === "stdin" };
	} catch {}
	return { shell: "bash", args: ["-c"], stdin: false };
}
/** 지금 실행 위치(jupyter 모드면 노트북, 아니면 PC 의 작업 폴더)에서 셸 명령. 표준 출력과 오류를 합쳐 돌려줌, ms 가 지나면 멈춤 (code null) */
export async function runHere(command: string, wd: WorkDir = workDir(), ms = 60000): Promise<{ code: number | null; out: string }> {
	if (relayMock()?.runHere) return relayMock()!.runHere!(command, wd, ms);
	const sec = Math.max(1, Math.ceil(ms / 1000));
	if (wd.remote) return nbRun(`timeout ${sec} bash -c ${shq(command)} 2>&1`, wd.cwd || wd.home || "/");
	const sh = await piShell();
	return new Promise((ok) => {
		let out = "";
		let done = false;
		let ch: ReturnType<typeof spawn>;
		const finish = (code: number | null, extra = "") => {
			if (done) return;
			done = true;
			clearTimeout(timer);
			ok({ code, out: out + extra });
		};
		const timer = setTimeout(() => {
			// Windows 에서 kill 은 bash 만 끝내고 그 아래 프로그램은 남으므로 프로세스 나무째
			if (process.platform === "win32" && ch?.pid) {
				try {
					spawn("taskkill", ["/pid", String(ch.pid), "/T", "/F"], { windowsHide: true });
				} catch {}
			} else ch?.kill();
			finish(null, `\n(${sec}초가 지나 멈춤)`);
		}, ms);
		try {
			ch = spawn(sh.shell, sh.stdin ? sh.args : [...sh.args, command], { cwd: wd.cwd, windowsHide: true, env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
			if (sh.stdin) ch.stdin?.end(command);
		} catch (e) {
			return finish(null, `(실행하지 못함: ${(e as Error).message})`);
		}
		ch.stdout?.on("data", (d) => (out += d));
		ch.stderr?.on("data", (d) => (out += d));
		ch.on("error", (e) => finish(null, `\n(실행하지 못함: ${e.message})`));
		ch.on("close", (code) => finish(code));
	});
}
export type Target = { abs: string; remote: boolean };
const slash = (p: string) => p.split("\\").join("/");
const AGENT_DIR = process.env.PI_CODING_AGENT_DIR || `${homedir()}/.pi/agent`;

/** 도구가 받은 경로 -> 실제 위치 (PC 또는 노트북). 상대 경로는 지금 작업 폴더 기준.
 *  pi 의 도구와 같게 정리한다 (lib/paths.ts: 맨 앞 @, /c/... 등). jupyter 모드라도 C:/... 나 //서버/... 는 PC 파일 */
export function target(path: string, wd: WorkDir = workDir()): Target {
	let s = slash(cleanPath(path).trim());
	if (wd.remote && !isPcAbsolute(s)) {
		const home = wd.home || "/home/jovyan";
		if (s === "~" || s.startsWith("~/")) s = home + s.slice(1);
		const abs = posix.resolve(wd.cwd, s);
		// 노트북 형식으로 쓴 pi 설정 폴더(~/.pi/agent/...)는 PC 의 것 (jupyter.ts 도 쓰기를 PC 로 보냄)
		const ra = `${home}/.pi/agent`;
		if (abs === ra || abs.startsWith(ra + "/")) return { abs: slash(AGENT_DIR) + abs.slice(ra.length), remote: false };
		return { abs, remote: true };
	}
	s = windowsDrivePath(s);
	if (s === "~" || s.startsWith("~/")) s = slash(homedir()) + s.slice(1);
	return { abs: slash(resolve(wd.remote ? homedir() : wd.cwd, s)), remote: false };
}

/** 파일 내용 (없으면 null) */
export async function readTarget(t: Target): Promise<Buffer | null> {
	if (relayMock()?.readTarget) return relayMock()!.readTarget!(t);
	if (t.remote) {
		try {
			return Buffer.from((await call("/jupyter/fs", { op: "read", path: t.abs })).data || "", "base64");
		} catch (e) {
			if ((e as RelayError).code === "ENOENT") return null;
			throw e;
		}
	}
	try {
		return await fsp.readFile(t.abs);
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw e;
	}
}

/** 파일 앞부분(최대 n 바이트)과 전체 크기. 없거나 폴더면 null (큰 파일을 통째로 읽지 않으려고) */
export async function readHead(t: Target, n: number): Promise<{ data: Buffer; size: number } | null> {
	if (relayMock()?.readHead) return relayMock()!.readHead!(t, n);
	if (t.remote) {
		let st: any;
		try {
			st = await call("/jupyter/fs", { op: "stat", path: t.abs });
		} catch (e) {
			if ((e as RelayError).code === "ENOENT") return null;
			throw e;
		}
		if (st.kind === "directory") return null;
		// 노트북 홈 밖·숨김 경로는 크기를 알려 주지 않음 -> 노트북에서 직접 확인 (모르는 채로 통째로 읽으면 큰 파일에서 멈춤)
		let size = typeof st.size === "number" ? st.size : Number.NaN;
		if (!Number.isFinite(size)) {
			const r = await nbRun(`stat -c %s -- ${shq(t.abs)}`, workDir().home || "/");
			size = r.code === 0 ? Number.parseInt(r.out.trim(), 10) : Number.NaN;
			if (!Number.isFinite(size)) return null;
		}
		if (size > 256 * 1024) {
			// 큰 파일은 앞부분만: 나눠 받기(노트북 홈 안, 숨김이 아닌 경로), 안 되면 노트북에서 head 로
			try {
				const r = await call("/jupyter/fs", { op: "read_range", path: t.abs, start: 0, end: n - 1 });
				return { data: Buffer.from(r.data || "", "base64"), size: Number(r.total) || size };
			} catch {
				const r = await nbRun(`head -c ${Math.floor(n)} -- ${shq(t.abs)} | base64 -w0`, workDir().home || "/");
				if (r.code !== 0) return null;
				return { data: Buffer.from(r.out.trim(), "base64"), size };
			}
		}
		const all = await readTarget(t);
		return all && { data: all.subarray(0, n), size: all.length };
	}
	let fh: Awaited<ReturnType<typeof fsp.open>> | undefined;
	try {
		const st = await fsp.stat(t.abs);
		if (!st.isFile()) return null;
		fh = await fsp.open(t.abs, "r");
		const buf = Buffer.alloc(Math.min(n, st.size));
		const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
		return { data: buf.subarray(0, bytesRead), size: st.size };
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw e;
	} finally {
		await fh?.close();
	}
}

export async function writeTarget(t: Target, data: Buffer): Promise<void> {
	if (relayMock()?.writeTarget) return relayMock()!.writeTarget!(t, data);
	if (t.remote) return void (await call("/jupyter/fs", { op: "write", path: t.abs, data: data.toString("base64") }));
	await fsp.mkdir(dirname(t.abs), { recursive: true });
	await fsp.writeFile(t.abs, data);
}

export async function removeTarget(t: Target): Promise<void> {
	if (relayMock()?.removeTarget) return relayMock()!.removeTarget!(t);
	if (t.remote) {
		const r = await nbRun(`rm -f -- ${shq(t.abs)}`, workDir().home || "/");
		if (r.code !== 0) throw new Error(`노트북에서 지우지 못했습니다: ${r.out.slice(-200)}`);
		return;
	}
	await fsp.rm(t.abs, { force: true });
}

/** 보여 줄 경로: 작업 폴더 안이면 상대 경로, 사용자 폴더 아래면 ~ */
export function shown(t: Target, wd: WorkDir = workDir()): string {
	const cwd = slash(wd.cwd).replace(/\/+$/, "");
	if (t.abs.toLowerCase().startsWith(cwd.toLowerCase() + "/")) return t.abs.slice(cwd.length + 1);
	if (!t.remote) {
		const h = slash(homedir());
		if (t.abs.toLowerCase().startsWith(h.toLowerCase() + "/")) return "~" + t.abs.slice(h.length);
	}
	return (t.remote ? "노트북 " : "") + t.abs;
}

// ── 글 파일 읽기 (위키 원본·페이지, 문서 폴더) ──────────────────────
/** 글 파일의 인코딩: UTF-8 (앞의 BOM 은 뺌), BOM 이 있는 UTF-16, 그 밖은 한국어 Windows 의 ANSI(CP949).
 *  메모장·엑셀이 ANSI·유니코드로 저장한 원본도 한글이 깨지지 않게. UTF-8 에 잘못된 바이트가 조금 섞인 것은 UTF-8 로 봄 */
export type TextEnc = "utf8" | "utf16le" | "utf16be" | "cp949" | "unknown";
export const ENC_LABEL: Record<TextEnc, string> = {
	utf8: "UTF-8",
	utf16le: "UTF-16",
	utf16be: "UTF-16",
	cp949: "CP949(ANSI)",
	unknown: "인코딩 모름: 한글이 깨졌을 수 있으니 UTF-8 로 저장해 다시 넣으세요",
};
const UTF8_STRICT = new TextDecoder("utf-8", { fatal: true });
const BAD = String.fromCharCode(0xfffd); // 바꿀 수 없는 바이트 자리에 들어가는 글자
export function decodeText(buf: Buffer): { text: string; enc: TextEnc } {
	if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return { text: buf.subarray(3).toString("utf8"), enc: "utf8" };
	if (buf[0] === 0xff && buf[1] === 0xfe) return { text: buf.subarray(2).toString("utf16le"), enc: "utf16le" };
	if (buf[0] === 0xfe && buf[1] === 0xff) {
		const b = Buffer.from(buf.subarray(2, buf.length - (buf.length % 2)));
		return { text: b.swap16().toString("utf16le"), enc: "utf16be" };
	}
	const loose = buf.toString("utf8");
	if (!loose.includes(BAD)) return { text: loose, enc: "utf8" };
	try {
		return { text: UTF8_STRICT.decode(buf), enc: "utf8" }; // U+FFFD 가 글에 원래 있는 것
	} catch {}
	const bad = loose.split(BAD).length - 1;
	const wide = (loose.match(/[^\x00-\x7F]/g) || []).length;
	if (bad * 10 < wide) return { text: loose, enc: "utf8" };
	try {
		return { text: new TextDecoder("euc-kr").decode(buf), enc: "cp949" }; // WHATWG 의 euc-kr 은 CP949 (Node 의 ICU 가 있어야 함)
	} catch {
		return { text: loose, enc: "unknown" };
	}
}
export const readText = (p: string) => decodeText(readFileSync(p)).text;

// ── 입력 고치기와 사용자가 친 그대로 ──────────────────────────────
// 여러 확장이 요청 앞에 알림을 붙인다 (input 이벤트의 transform: /remember·/kit env·/undo 알림, 계획 모드, @파일 내용).
// pi 는 확장을 폴더에서 읽은 차례로 부르고 그 차례는 정해져 있지 않아, 나중에 불리는 확장은 고친 글을 받는다.
// 고친 글 -> 사용자가 친 글을 남겨 두어 rawInput 으로 되찾는다 (/wiki save 의 질문, 작업 기록)
const RAW: Map<string, string> = ((globalThis as any).__piRawInput ||= new Map());

/** input 이벤트에서 돌려줄 transform. 고친 글이 사용자가 친 어떤 글에서 왔는지 남긴다 */
export function transformInput(from: string, to: string) {
	RAW.set(to, rawInput(from));
	while (RAW.size > 8) RAW.delete(RAW.keys().next().value as string);
	return { action: "transform" as const, text: to };
}

/** input 이벤트의 글 -> 사용자가 친 그대로 (다른 확장이 고치지 않았으면 그 글) */
export const rawInput = (text: string): string => RAW.get(text) ?? text;

// 확장이 사용자를 대신해 보내는 요청 (/plan <요청>, 계획대로 진행, /wiki ask, /handoff): 작업 기록(memory.ts)이 사용자의 요청으로 남기게 표시.
// 표시하지 않은 확장의 요청(폴더째 반영, /watch 의 로그 등)은 기록하지 않는다
const ASKS: Map<string, string> = ((globalThis as any).__piUserAsks ||= new Map());

/** 보낼 글을 사용자의 요청으로 표시하고 그 글을 그대로 돌려준다. label: 기록에 남길 글 (없으면 보낸 글) */
export function userAsk(text: string, label = text): string {
	ASKS.set(text, label);
	while (ASKS.size > 8) ASKS.delete(ASKS.keys().next().value as string);
	return text;
}

/** input 이벤트의 글이 확장이 대신 보낸 사용자의 요청이면 기록에 남길 글 */
export const userAskOf = (text: string): string | undefined => ASKS.get(rawInput(text));

/** 요청이 끝난 뒤(agent_settled) 여는 키트의 고르기·확인 창을 하나씩 (2026-11-05). pi 화면은 창을 하나만 보여 주고,
 *  두 번째 창이 앞 창을 덮으면 앞 창은 답을 받지 못한다 (완료 점검 동의와 기억 제안이 같은 때에 뜰 수 있음) */
export function oneDialog<T>(fn: () => Promise<T>): Promise<T> {
	const g = globalThis as any;
	const run: Promise<T> = (g.__piDialog || Promise.resolve()).then(fn, fn);
	g.__piDialog = run.catch(() => {});
	return run;
}

// ── 개인정보·비밀로 보이는 글 (위키의 작업 방식, 작업 기록) ──────────────
// 중계 서버(relay.py)의 감추기와 같은 꼴: 이메일, 전화번호, 카드번호, 계좌번호 모양 번호
// (숫자 묶음을 - _ 로 이은 것이나 이어 쓴 숫자로 합쳐 10~14자리. 너무 길면 끝의 _ 묶음을 떼어 봄), [이메일N]·[번호N]
const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const PHONE_RE = /(?<!\d)0\d{1,2}[- .]?\d{3,4}[- .]?\d{4}(?!\d)/g;
const CARD_RE = /(?<![\d.])(?:\d{4}[- ]){3}\d{1,7}(?![\d.])|(?<![\d.])\d{15,19}(?![\d.])/g;
const TOKEN_RE = /\[(?:이메일|번호)\d+\]/g;
const SECRET_RE = /(?:password|passwd|비밀번호|암호|토큰|token|secret|api[_ -]?key)\s*[:=]/i;
const NB = "(?<![0-9A-Za-z.])(?<![0-9A-Fa-f]-)";
const NA = "(?![0-9A-Za-z-]|\\.\\d)";
const NUMBER_RE = new RegExp(`${NB}(?:\\d{2,8}[-_]){1,3}\\d{2,8}${NA}|${NB}\\d{10,14}${NA}`, "g");
const digitCount = (s: string) => (s.match(/\d/g) || []).length;
/** 계좌번호 모양인 부분: 10~14자리 (넘으면 끝의 _ 묶음을 떼어 봄) */
function accountPart(m: string): string | null {
	let s = m;
	while (digitCount(s) > 14 && s.includes("_")) s = s.slice(0, s.lastIndexOf("_"));
	const n = digitCount(s);
	return n >= 10 && n <= 14 ? s : null;
}
const has = (re: RegExp, s: string) => {
	re.lastIndex = 0;
	return re.test(s);
};

/** 이메일·전화번호·카드·계좌번호 모양 번호·[이메일N]·비밀로 보이는 글이 들었는지 */
export function secretish(s: string): boolean {
	return has(EMAIL_RE, s) || has(TOKEN_RE, s) || has(PHONE_RE, s) || has(CARD_RE, s) || SECRET_RE.test(s) || [...s.matchAll(NUMBER_RE)].some((m) => accountPart(m[0]) !== null);
}

/** 기록에 남길 글: 이메일·전화번호·카드·계좌번호 모양 번호·[이메일N] 은 '…' 로 빼고, 비밀로 보이는 글이면 "" */
export function scrubText(s: string): string {
	if (SECRET_RE.test(s)) return "";
	return s
		.replace(EMAIL_RE, "…")
		.replace(TOKEN_RE, "…")
		.replace(CARD_RE, "…")
		.replace(PHONE_RE, "…")
		.replace(NUMBER_RE, (m) => {
			const a = accountPart(m);
			return a === null ? m : `…${m.slice(a.length)}`;
		});
}

/** 메시지 하나의 글 (글자 수를 셀 것): 그림·생각(thinking)은 빼고, 도구 호출은 이름과 인자 */
export function msgText(m: any): string {
	const parts = (c: any): string =>
		typeof c === "string"
			? c
			: Array.isArray(c)
				? c.map((p: any) => (p?.type === "text" ? String(p.text || "") : p?.type === "toolCall" ? `${p.name || ""}${JSON.stringify(p.arguments ?? {})}` : "")).join("")
				: "";
	if (m?.role === "bashExecution") return `${m.command || ""}\n${m.output || ""}`;
	if (m?.role === "compactionSummary" || m?.role === "branchSummary") return String(m.summary || "");
	return parts(m?.content);
}

/** 사용자 요청이 작업을 지시하는 것인지 판정 */
export function isTaskRequest(text: string): boolean {
	if (!text) return false;
	return /(?:만들(?:어|기|어줘)?|고쳐|실행|돌려|추가|수정|써(?:줘)?|지워|확인해|세어)/.test(text);
}

/** 답이 말로 하겠다는 꼴(하겠습니다·다음과 같이·명령 코드 블록)이고 질문으로 끝나지 않는지 판정 */
export function isVerbalAnswer(text: string): boolean {
	if (!text) return false;
	const t = text.trim();
	if (/[?？]$|까요[.?]?$|습니까[.?]?$|나요[.?]?$/.test(t)) return false;
	if (/하겠습니다|해\s*드리겠습니다|다음과\s*같이|아래와\s*같이/.test(t)) return true;
	if (/```(?:bash|sh|shell|zsh|python|py)?\s*[\r\n]/.test(t)) return true;
	return false;
}

export const TEXT_ONLY_BOUNCE_PROMPT =
	"[도구로 하기] 방금 답은 말로만 설명했습니다. 설명 대신 도구(bash·read·edit·write)를 불러 실제로 해 주세요. 할 수 없으면 왜 못 하는지 한 줄로.";

/** 글로만 답하고 끝났을 때 한 번 되돌리기 판정 */
export function shouldBounceTextOnly(opts: {
	userText: string;
	assistantText: string;
	toolCallCount: number;
	hasUI?: boolean;
	mode?: string;
	isReview?: boolean;
	alreadyBounced?: boolean;
	isSmallModel?: boolean;
}): boolean {
	if (opts.isSmallModel === false) return false;
	if (opts.hasUI === false) return false;
	if (opts.mode === "plan" || opts.mode === "ask") return false;
	if (opts.isReview) return false;
	if (opts.alreadyBounced) return false;
	if (opts.toolCallCount > 0) return false;
	if (!isTaskRequest(opts.userText)) return false;
	if (!isVerbalAnswer(opts.assistantText)) return false;
	return true;
}
