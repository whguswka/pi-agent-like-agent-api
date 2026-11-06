/**
 * 되돌리기 (/undo): pi 가 write·edit 도구로 고친 파일을 요청 단위로 원래대로 돌린다.
 *
 *  /undo     마지막 요청에서 고친 파일을 되돌림
 *  /undo 2   마지막 두 요청
 *  - 요청이 시작될 때마다 기록을 새로 열고, 파일을 고치기 직전 내용과 고친 직후 내용을 함께 남긴다.
 *  - 되돌리기 전에 파일 목록(복원 / 지움: 새로 만든 파일)을 보여 주고 확인을 받는다.
 *  - 고친 뒤에 다른 곳에서 다시 바뀐 파일은 덮어쓰지 않고 알린다.
 *  - 셸 명령(bash)으로 바뀐 파일은 기록하지 않으므로 되돌리지 못한다. 5MB 넘는 파일도 기록하지 않는다.
 *  - jupyter 모드에서 노트북 파일을 고친 것도 되돌린다 (중계 서버를 거침).
 *  - 기록은 파일에 남는다 (~/.pi/agent/undo/<프로젝트>, 최근 요청 30개·14일): pi 를 다시 켜거나 새 세션이어도 그 폴더의 요청을 되돌린다 (2026-11-05).
 *    되돌린 뒤 다음 요청에는 LLM 에게 되돌린 파일을 알려 준다.
 *
 * git 기준점 제안: 작업 폴더가 git 저장소가 아니면, pi 가 그 폴더의 파일을 처음 고치기 직전에 한 번 묻는다.
 *  '예' 면 git init 하고 지금 상태를 첫 커밋(기준점)으로 남긴다 (pi 를 끄거나 새 세션을 열어도 git 으로 되돌릴 수 있게).
 *  커밋 이름(user.email)이 설정되어 있지 않으면 그 저장소에만 'pi <pi@localhost>' 로 적는다.
 *  node_modules·__pycache__·.venv 같은 폴더가 있고 .gitignore 가 없으면 .gitignore 에 넣어 뺀다.
 *  '아니요' 면 그 폴더에서는 다시 묻지 않는다 (~/.pi/agent/git-offer.json. 그 파일에 "enabled": false 면 어디서도 묻지 않음). jupyter 모드(노트북 파일)·홈 폴더·드라이브 맨 위·
 *  시스템 폴더·pi 폴더, 파일이 2000개 넘는 폴더, git 이 없을 때, 화면이 없는 실행(pi -p)에서는 묻지 않는다.
 *  (실사용 시험: pi 가 원인을 찾는다며 코드를 비운 채 세션이 끝났는데, git 이 없어 되돌릴 수 없었음)
 *
 * HTML 표기 풀기: Copilot 이 edit 의 바꿀 글(oldText)의 < > 를 &lt; &gt; 로 보내 파일에서 찾지 못하면, 풀어서 파일에 있을 때만
 *  oldText·newText 를 풀어 고친다 (파일에 &lt; 가 실제로 있는 HTML 등은 그대로 맞으므로 건드리지 않음).
 *  (실사용 시험: 'List&lt;PerformanceCounter&gt;' 로 와서 고치기가 실패하자, 파일이 깨졌다고 여겨 14분 동안 다시 읽기만 함)
 */

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	decodeText,
	rawInput,
	readTarget,
	removeTarget,
	shown,
	type Target,
	target,
	transformInput,
	userAskOf,
	type WorkDir,
	workDir,
	writeTarget,
} from "./lib/relay.ts";

const MAX_FILE = 5 * 1024 * 1024;

// ── HTML 표기 풀기 ──────────────────────────────────────────────
const ENTITY_RE = /&(?:lt|gt|amp|quot|#39|apos);/;
/** &lt; &gt; &quot; &#39; &amp; 를 원래 글자로 (&amp; 는 맨 나중: '&amp;lt;' 는 '&lt;' 로 한 번만) */
export const unescapeHtml = (s: string) =>
	s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, "&");
export type EditItem = { oldText?: unknown; newText?: unknown };
/** edit 의 바꿀 글이 HTML 표기로 와서 파일에 없고 풀면 있으면, newText 까지 푼 edits. 고칠 것이 없으면 null */
export function fixEntityEdits(content: string, edits: EditItem[]): EditItem[] | null {
	const lf = (s: string) => s.replace(/\r\n/g, "\n");
	const c = lf(content);
	let changed = false;
	const out = edits.map((e) => {
		const o = e?.oldText;
		if (typeof o !== "string" || !ENTITY_RE.test(o) || c.includes(lf(o))) return e;
		const u = unescapeHtml(o);
		if (!c.includes(lf(u))) return e;
		changed = true;
		return { ...e, oldText: u, newText: typeof e.newText === "string" ? unescapeHtml(e.newText) : e.newText };
	});
	return changed ? out : null;
}

// ── git 기준점 제안 ─────────────────────────────────────────────
export const GIT_MAX_FILES = 2000;
// 묻는 창은 2분 안에 답이 없으면 '묻지 않은 것' 으로 넘어간다 (아무도 보지 않는 실행이 멈추지 않게. '아니요' 로 기억하지 않음)
export const GIT_OFFER = { timeoutMs: 120_000 };
// 세지 않고 .gitignore 에 넣는 폴더 (files.ts 의 @ 목록에서 건너뛰는 것과 같은 종류)
export const HEAVY_DIRS = ["node_modules", "__pycache__", ".venv", "venv", ".ipynb_checkpoints", ".mypy_cache", ".pytest_cache", ".tox", ".cache"];
const winLike = process.platform === "win32";
const norm = (p: string) => {
	const s = resolve(p).split("\\").join("/").replace(/\/+$/, "") || "/";
	return winLike ? s.toLowerCase() : s;
};
/** 이 폴더에서 git 을 제안하지 않는 이유 ("" 이면 제안해도 됨) */
export function gitOfferBlocked(dir: string, home = homedir()): string {
	const d = norm(dir);
	const h = norm(home);
	if (d === "/" || /^[a-z]:$/i.test(d)) return "드라이브 맨 위";
	if (d === h) return "홈 폴더";
	if (/^[a-z]:\/(windows|program files|program files \(x86\)|programdata)(\/|$)/i.test(d)) return "시스템 폴더";
	if (d === `${h}/.pi` || d.startsWith(`${h}/.pi/`) || d === `${h}/tools/pi` || d.startsWith(`${h}/tools/pi/`)) return "pi 폴더";
	return "";
}
/** 폴더의 파일 수 (HEAVY_DIRS·.git 은 세지 않고, 찾은 이름은 heavy 에). limit 를 넘으면 null */
export function countFiles(dir: string, limit = GIT_MAX_FILES): { n: number; heavy: string[] } | null {
	const heavy = new Set<string>();
	let n = 0;
	const stack: [string, number][] = [[dir, 0]];
	while (stack.length) {
		const [d, depth] = stack.pop()!;
		let list: import("node:fs").Dirent[];
		try {
			list = readdirSync(d, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const e of list) {
			if (e.isDirectory()) {
				if (e.name === ".git") continue;
				if (HEAVY_DIRS.includes(e.name)) heavy.add(e.name);
				else if (depth < 12) stack.push([join(d, e.name), depth + 1]);
			} else if (++n > limit) return null;
		}
	}
	return { n, heavy: [...heavy] };
}
/** git 명령 (실패하면 code: git 이 없으면 'ENOENT', 저장소가 아니면 128) */
const git = (cwd: string, args: string[], timeout = 30_000) =>
	new Promise<string>((ok, fail) =>
		execFile("git", args, { cwd, timeout, windowsHide: true }, (err, out, errOut) => {
			if (!err) return ok(String(out));
			fail(Object.assign(new Error(String(errOut || err.message).trim()), { code: (err as any).code }));
		}),
	);
// ~/.pi/agent/git-offer.json: {"declined": {폴더: 날짜}} ('아니요' 한 폴더), {"enabled": false} 면 아예 묻지 않음
const offerFile = () => join(process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent"), "git-offer.json");
function offerConfig(): { enabled?: boolean; declined?: Record<string, string> } {
	try {
		return JSON.parse(readFileSync(offerFile(), "utf8")) || {};
	} catch {
		return {};
	}
}
function decline(dir: string) {
	const cfg = offerConfig();
	cfg.declined = { ...(cfg.declined || {}), [norm(dir)]: new Date().toISOString().slice(0, 10) };
	mkdirSync(dirname(offerFile()), { recursive: true });
	writeFileSync(offerFile(), `${JSON.stringify(cfg, null, 2)}\n`);
}
type Snap = Target & { label: string; before?: Buffer | null; after?: Buffer | null; skip?: string };
type Checkpoint = { id: string; t: number; req: string; dir: string; files: Map<string, Snap> };

const keyOf = (t: Target) => (t.remote ? "nb:" : "pc:") + t.abs.toLowerCase();
const same = (a: Buffer | null | undefined, b: Buffer | null | undefined) => (a === null || b === null ? a === b : !!a && !!b && a.equals(b));

// ── 되돌리기 기록을 파일에 (2026-11-05, Claude Code 의 체크포인트(30일 보관)를 보고: pi 를 다시 켜거나 새 세션이어도 /undo) ──
//  ~/.pi/agent/undo/<프로젝트>/index.json (요청마다 시각·요청·파일마다 고치기 전·후 내용의 id) + 내용 파일 <id>.bin (같은 내용은 하나만).
//  프로젝트마다 최근 요청 UNDO_KEEP 개, UNDO_DAYS 일까지, 내용 파일은 모두 UNDO_MAX 까지 (넘으면 오래된 요청부터 뺌)
export const UNDO_KEEP = 30;
export const UNDO_DAYS = 14;
export const UNDO_MAX = 200 * 1024 * 1024;
/** before·after: 내용 파일 id, null 은 '파일이 없었음' (새로 만든 파일·지운 파일), 없으면 기록 못 함 */
export type SavedSnap = { abs: string; remote: boolean; label: string; before?: string | null; after?: string | null; skip?: string };
export type SavedCp = { id: string; t: number; req: string; files: SavedSnap[] };
const agentDirOf = () => process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
/** 프로젝트(작업 폴더, jupyter 모드면 노트북 폴더)마다 기록 폴더: 끝 두 이름 + 경로의 짧은 해시 */
export function undoDir(wd: WorkDir, root = join(agentDirOf(), "undo")): string {
	const p = String(wd.cwd || "").replace(/\\/g, "/").replace(/\/+$/, "");
	const id = (wd.remote ? "nb:" : "pc:") + (!wd.remote && process.platform === "win32" ? p.toLowerCase() : p);
	const name = p.split("/").filter((x) => x && !/^[A-Za-z]:$/.test(x)).slice(-2).join("-").replace(/[^\p{L}\p{N}._-]+/gu, "_").slice(0, 60) || "home";
	return join(root, `${wd.remote ? "nb-" : ""}${name}-${createHash("sha256").update(id).digest("hex").slice(0, 8)}`);
}
const blobId = (b: Buffer) => createHash("sha1").update(b).digest("hex");
export function loadCps(dir: string): SavedCp[] {
	try {
		const v = JSON.parse(readFileSync(join(dir, "index.json"), "utf8"));
		return Array.isArray(v?.cps) ? v.cps.filter((c: any) => c && typeof c.id === "string" && Array.isArray(c.files)) : [];
	} catch {
		return [];
	}
}
export const readBlob = (dir: string, id: string): Buffer | null => {
	try {
		return readFileSync(join(dir, `${id}.bin`));
	} catch {
		return null;
	}
};
/** 오래된 요청·넘치는 내용을 빼고, 어디에도 쓰지 않는 내용 파일을 지움 */
function pruneCps(dir: string, cps: SavedCp[], now: number): SavedCp[] {
	let keep = cps
		.filter((c) => c.files.length && now - c.t < UNDO_DAYS * 86400_000)
		.sort((a, b) => a.t - b.t)
		.slice(-UNDO_KEEP);
	const size = (id: string) => {
		try {
			return statSync(join(dir, `${id}.bin`)).size;
		} catch {
			return 0;
		}
	};
	const ids = (cs: SavedCp[]) => new Set(cs.flatMap((c) => c.files.flatMap((f) => [f.before, f.after].filter((x): x is string => typeof x === "string"))));
	while (keep.length > 1 && [...ids(keep)].reduce((a, id) => a + size(id), 0) > UNDO_MAX) keep = keep.slice(1);
	const used = ids(keep);
	try {
		for (const f of readdirSync(dir)) if (f.endsWith(".bin") && !used.has(f.slice(0, -4))) unlinkSync(join(dir, f));
	} catch {}
	return keep;
}
function writeIndex(dir: string, cps: SavedCp[]) {
	mkdirSync(dir, { recursive: true });
	const tmp = join(dir, `index.json.${process.pid}.tmp`);
	writeFileSync(tmp, `${JSON.stringify({ v: 1, cps }, null, 1)}\n`);
	try {
		renameSync(tmp, join(dir, "index.json"));
	} catch {
		writeFileSync(join(dir, "index.json"), `${JSON.stringify({ v: 1, cps }, null, 1)}\n`);
	}
}
/** 요청 하나의 기록을 파일에 (같은 id 면 바꿈). 내용은 처음 보는 것만 씀. 다른 pi 가 쓴 기록은 그대로 */
export function saveCp(dir: string, cp: { id: string; t: number; req: string; files: Snap[] }, now = Date.now()) {
	mkdirSync(dir, { recursive: true });
	const put = (b: Buffer | null | undefined): string | null | undefined => {
		if (b === null || b === undefined) return b;
		const id = blobId(b);
		if (!existsSync(join(dir, `${id}.bin`))) writeFileSync(join(dir, `${id}.bin`), b);
		return id;
	};
	const files: SavedSnap[] = cp.files.map((s) =>
		s.skip ? { abs: s.abs, remote: s.remote, label: s.label, skip: s.skip } : { abs: s.abs, remote: s.remote, label: s.label, before: put(s.before), after: put(s.after) },
	);
	const cps = loadCps(dir).filter((c) => c.id !== cp.id);
	cps.push({ id: cp.id, t: cp.t, req: cp.req, files });
	writeIndex(dir, pruneCps(dir, cps, now));
}
/** 되돌린 요청의 기록을 뺌 */
export function dropCps(dir: string, ids: string[], now = Date.now()) {
	writeIndex(dir, pruneCps(dir, loadCps(dir).filter((c) => !ids.includes(c.id)), now));
}

export default function (pi: ExtensionAPI) {
	// 기록은 파일에 (~/.pi/agent/undo/<프로젝트>/): pi 를 다시 켜거나 새 세션(/new, /resume)이어도 그 폴더의 최근 요청을 되돌림 (2026-11-05)
	// note: 다음 요청에 붙일 알림 (되돌린 파일), req: 지금 요청의 첫 줄 (기록에 남김)
	// gitChecked: 이 세션에서 git 기준점을 이미 살펴본 작업 폴더
	const S: { seq: number; note: string; req: string; gitChecked?: Set<string> } = ((globalThis as any).__piUndo ||= {
		seq: 0,
		note: "",
		req: "",
	});
	let current: Checkpoint | null = null;

	pi.on("session_start", async (event: any) => {
		if (event?.reason !== "reload") Object.assign(S, { note: "", req: "", gitChecked: new Set() });
	});

	// 고치기 직전 (아래의 '고치기 직전 내용' 보다 먼저: 기준점은 고치기 전 상태로)
	pi.on("tool_call", async (event: any, ctx: any) => {
		if ((event.toolName !== "write" && event.toolName !== "edit") || !event.input?.path) return;
		const t = target(event.input.path);
		if (event.toolName === "edit") await fixEntities(event.input, t, ctx);
		await offerGit(t, ctx);
	});

	async function fixEntities(input: any, t: Target, ctx: any) {
		const list: EditItem[] = Array.isArray(input.edits)
			? input.edits
			: typeof input.oldText === "string"
				? [{ oldText: input.oldText, newText: input.newText }]
				: [];
		if (!list.some((e) => typeof e?.oldText === "string" && ENTITY_RE.test(e.oldText))) return;
		let data: Buffer | null = null;
		try {
			data = await readTarget(t);
		} catch {
			return;
		}
		const fixed = data ? fixEntityEdits(decodeText(data).text, list) : null;
		if (!fixed) return;
		if (Array.isArray(input.edits)) input.edits = fixed;
		else Object.assign(input, { oldText: fixed[0].oldText, newText: fixed[0].newText });
		try {
			ctx?.ui?.notify(`고칠 글에 HTML 표기(&lt; &gt; 등)가 섞여 와서 < > 로 풀어 맞췄습니다: ${shown(t)}`, "info");
		} catch {}
	}

	async function offerGit(t: Target, ctx: any) {
		const wd = workDir();
		if (t.remote || wd.remote || !ctx?.hasUI) return;
		const dir = resolve(wd.cwd);
		const key = norm(dir);
		const checked = (S.gitChecked ||= new Set());
		if (checked.has(key)) return;
		const rel = relative(dir, resolve(t.abs));
		if (!rel || rel.startsWith("..") || resolve(rel) === rel) return; // 작업 폴더 밖의 파일: 안의 파일을 고칠 때 다시 봄
		checked.add(key);
		const cfg = offerConfig();
		if (cfg.enabled === false || /^(0|off|false|no)$/i.test(process.env.PI_GIT_OFFER || "")) return; // 끔 (시험용 HOME 은 환경 변수로)
		if (cfg.declined?.[key] || gitOfferBlocked(dir)) return;
		try {
			if ((await git(dir, ["rev-parse", "--is-inside-work-tree"], 5000)).trim() === "true") return;
		} catch (e) {
			if ((e as any).code !== 128) return; // git 이 없거나 알 수 없는 오류 -> 묻지 않음 (128: 저장소가 아님)
		}
		const files = countFiles(dir);
		if (!files) return;
		let email = "";
		try {
			email = (await git(dir, ["config", "user.email"], 5000)).trim();
		} catch {}
		const ignore = files.heavy.length && !existsSync(join(dir, ".gitignore")) ? files.heavy : [];
		const asked = Date.now();
		const ok = await ctx.ui.confirm(
			"이 폴더를 git 으로 관리할까요?",
			[
				`pi 가 이 폴더의 파일을 처음 고치려고 합니다: ${shown(t)}`,
				"이 폴더는 git 저장소가 아니라서 /undo 로 되돌릴 수 있는 것은 최근 요청 30개(14일)까지이고, 셸 명령으로 바뀐 파일은 되돌리지 못합니다.",
				`'예' 면 git init 하고 지금 상태(파일 ${files.n}개)를 첫 커밋(기준점)으로 남겨, 나중에도 git 으로 되돌릴 수 있게 합니다.`,
				...(ignore.length ? [`${ignore.join("·")} 폴더는 .gitignore 에 넣어 뺍니다.`] : []),
				...(email ? [] : ["커밋 이름이 설정되어 있지 않아 이 저장소에만 'pi <pi@localhost>' 로 적습니다."]),
				"'아니요' 면 이 폴더에서는 다시 묻지 않습니다.",
			].join("\n"),
			{ timeout: GIT_OFFER.timeoutMs },
		);
		if (!ok) {
			// 시간이 다 돼 저절로 닫힌 것은 '아니요' 가 아님 (다음 세션에 다시 물음)
			if (Date.now() - asked < GIT_OFFER.timeoutMs - 1000) {
				try {
					decline(dir);
				} catch {}
			}
			return;
		}
		try {
			await git(dir, ["init", "-q"]);
			if (ignore.length) writeFileSync(join(dir, ".gitignore"), `${ignore.map((d) => `${d}/`).join("\n")}\n`);
			if (!email) {
				await git(dir, ["config", "user.name", "pi"]);
				await git(dir, ["config", "user.email", "pi@localhost"]);
			}
			await git(dir, ["add", "-A"], 60_000);
			await git(dir, ["commit", "-q", "--allow-empty", "-m", "pi: 기준점 (pi 가 고치기 전)"], 60_000);
			const head = (await git(dir, ["rev-parse", "--short", "HEAD"], 5000)).trim();
			S.note = `(이 작업 폴더를 git 으로 관리하기 시작했습니다. 첫 커밋 ${head} 이 pi 가 고치기 전 상태입니다. 동작을 확인한 단계마다 커밋해 주세요.)`;
			ctx.ui.notify(`git 기준점을 남겼습니다 (커밋 ${head}). 바뀐 것은 git diff 로 보고, 되돌리려면 git restore <파일>`, "info");
		} catch (e) {
			ctx.ui.notify(`git 기준점을 남기지 못했습니다 (고치기는 그대로 진행): ${(e as Error).message}`, "warning");
		}
	}

	pi.on("agent_start", async () => {
		const t = Date.now();
		current = { id: `${t.toString(36)}-${process.pid}-${++S.seq}`, t, req: S.req, dir: undoDir(workDir()), files: new Map() };
	});
	/** 지금 요청의 기록을 파일에 (파일을 고칠 때마다: pi 가 도중에 꺼져도 남게) */
	const persist = (cp: Checkpoint) => {
		try {
			saveCp(cp.dir, { id: cp.id, t: cp.t, req: cp.req, files: [...cp.files.values()] });
		} catch {}
	};

	// 고치기 직전 내용 (요청마다 파일당 한 번)
	pi.on("tool_call", async (event: any) => {
		if (!current || (event.toolName !== "write" && event.toolName !== "edit") || !event.input?.path) return;
		const t = target(event.input.path);
		const key = keyOf(t);
		if (current.files.has(key)) return;
		const snap: Snap = { ...t, label: shown(t) };
		current.files.set(key, snap);
		try {
			const data = await readTarget(t);
			if (data && data.length > MAX_FILE) snap.skip = "5MB 가 넘어 기록하지 않음";
			else snap.before = data;
		} catch (e) {
			snap.skip = `처음 내용을 읽지 못함 (${(e as Error).message})`;
		}
	});

	// 고친 직후 내용 (같은 요청에서 여러 번 고치면 마지막 것)
	pi.on("tool_result", async (event: any) => {
		if (!current || (event.toolName !== "write" && event.toolName !== "edit") || !event.input?.path) return;
		const snap = current.files.get(keyOf(target(event.input.path)));
		if (!snap || snap.skip) return;
		try {
			snap.after = await readTarget(snap);
		} catch {
			snap.after = undefined;
		}
		// 바뀐 것이 없으면(실패한 고치기 등) 기록하지 않음: /undo 가 빈 요청을 되돌리느라 한 번을 쓰지 않게
		if (same(snap.after, snap.before)) current.files.delete(keyOf(snap));
		persist(current);
	});

	pi.on("input", async (event: any) => {
		const said = String(event.text || "");
		if (said && !said.startsWith("/")) {
			const req = event.source === "extension" ? userAskOf(said) || "" : rawInput(said);
			if (req.trim() || event.source !== "extension") S.req = req.trim().split("\n")[0].slice(0, 80);
		}
		if (!S.note || !event.text || event.text.startsWith("/")) return;
		const text = `${S.note}\n\n${event.text}`;
		S.note = "";
		return transformInput(event.text, text);
	});

	pi.registerCommand("undo", {
		description: "pi 가 고친 파일을 원래대로 (/undo: 마지막 요청, /undo 2: 마지막 두 요청). 셸 명령으로 바뀐 파일은 제외",
		handler: async (args, ctx) => {
			const n = Math.max(1, Number.parseInt(String(args || "1"), 10) || 1);
			const dir = undoDir(workDir());
			const cps = loadCps(dir)
				.filter((c) => c.files.length > 0)
				.sort((a, b) => a.t - b.t)
				.slice(-n)
				.reverse(); // 최근 것부터
			if (!cps.length) return ctx.ui.notify(`되돌릴 변경이 없습니다 (이 작업 폴더에서 pi 가 write·edit 로 고친 파일을 최근 ${UNDO_KEEP}개 요청, ${UNDO_DAYS}일까지 기록합니다)`, "info");
			const when = (t: number) => {
				const d = new Date(t);
				const p = (x: number) => String(x).padStart(2, "0");
				return `${d.toDateString() === new Date().toDateString() ? "" : `${d.getMonth() + 1}/${d.getDate()} `}${p(d.getHours())}:${p(d.getMinutes())}`;
			};
			const plan: string[] = [];
			for (const cp of cps) {
				plan.push(`${when(cp.t)}${cp.req ? ` "${cp.req.length > 50 ? `${cp.req.slice(0, 50)}…` : cp.req}"` : ""}`);
				for (const s of cp.files)
					plan.push(s.skip ? `  되돌릴 수 없음: ${s.label} (${s.skip})` : `  ${s.before === null ? "지움 (새로 만든 파일)" : "복원"}: ${s.label}`);
			}
			const ok = await ctx.ui.confirm(
				`되돌릴까요? (요청 ${cps.length}개)`,
				`${plan.join("\n")}\n\n셸 명령(bash)으로 바뀐 파일은 되돌리지 않습니다.`,
			);
			if (!ok) return;
			const done: string[] = [];
			const skipped: string[] = [];
			for (const cp of cps) {
				for (const s of cp.files) {
					const before = typeof s.before === "string" ? readBlob(dir, s.before) : s.before;
					const after = typeof s.after === "string" ? readBlob(dir, s.after) : s.after;
					if (s.skip || before === undefined || (typeof s.before === "string" && before === null)) {
						skipped.push(`${s.label} (${s.skip || "기록 없음"})`);
						continue;
					}
					try {
						const cur = await readTarget(s);
						if (same(cur, before)) continue; // 이미 원래 내용
						if (after === undefined || (typeof s.after === "string" && after === null) || !same(cur, after)) {
							skipped.push(`${s.label} (그 뒤에 다른 변경이 있어 덮어쓰지 않음)`);
							continue;
						}
						if (before === null) await removeTarget(s);
						else await writeTarget(s, before);
						done.push(s.label);
					} catch (e) {
						skipped.push(`${s.label} (${(e as Error).message})`);
					}
				}
			}
			try {
				dropCps(
					dir,
					cps.map((c) => c.id),
				);
			} catch {}
			if (done.length) S.note = `(사용자가 /undo 로 앞 요청에서 바꾼 파일을 원래대로 돌렸습니다: ${done.join(", ")}. 지금 파일 내용을 기준으로 이어 가세요.)`;
			const msg = [done.length ? `되돌렸습니다: ${done.join(", ")}` : "되돌린 파일이 없습니다", ...(skipped.length ? [`그대로 둠: ${skipped.join(", ")}`] : [])];
			ctx.ui.notify(msg.join(" / "), skipped.length ? "warning" : "info");
		},
	});
}
