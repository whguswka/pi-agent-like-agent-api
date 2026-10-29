/**
 * 키트 훅: 문서 규칙, /hooks (훅 목록·켜고 끄기), 위험 명령 확인이 꺼져 있을 때의 경고
 *
 * 문서 규칙 (2026-10: Copilot 이 작업 하나에 계획·이력 문서를 단계마다 새로 만들어 50개가 되었고, 목록 문서에 링크도 달지 않았음)
 *  - 작업 폴더에 새 Markdown 문서가 생기면 목록 문서(docs/INDEX.md)에 링크를 이 코드가 더한다 (모델에게 맡기지 않음).
 *    목록 문서가 없으면 프로젝트마다 한 번 만들지 묻는다 (답은 ~/.pi/agent/doc-rules.json)
 *  - 한 요청에서 새 문서가 doc_new_limit(2)개를 넘으면 한 번 묻고, 그 요청 동안 같은 답을 쓴다
 *  - 이력 문서로 보이는 새 문서는 HISTORY.md 하나에 이어 쓰게 할지, 같은 세션의 두 번째 계획 문서는 만들지 묻는다
 *  - bash 로 만드는 문서(cat > x.md, tee x.md)도 같게 본다 (write 를 막아도 bash 로 돌아가지 않게)
 *  지키는 것 (사용자가 만든 훅이 계획 문서가 없으면 조회까지 막아, 결국 모든 훅을 꺼야 했던 일 때문):
 *  - 읽기·조회는 보지 않는다. 막는 것은 새 문서 쓰기뿐이고, 사용자가 '아니요' 라고 답했을 때만
 *  - 화면이 없는 실행(pi -p 등)에서는 묻지도 막지도 않고 도구 결과에 안내만 붙인다
 *  - 계획 모드에서는 하지 않는다 (쓰기가 막혀 있음). 확인 모드에서는 쓰기마다 확인 모드가 물으므로 묻지 않고 안내·목록 링크만
 *  - 한 답의 도구 호출은 동시에 돌 수 있으므로 판단과 목록 고치기는 한 번에 하나씩
 * 설정 (내 설정 파일 bridge.json): "doc_rules": false (끔), "doc_index": "docs/INDEX.md", "doc_new_limit": 2
 *
 * 완료 점검 (2026-10 모델 운영 시험: 팀 표준 스킬을 읽고도 5단계 시험을 끝까지 마치지 않고, 끝나지 않은 실행 기록을 남긴 채 마침.
 *  지침·스킬의 '끝내기 전에 확인' 은 지나칠 수 있어, 팀이 정한 점검 명령을 키트가 돌린다. Claude Code 의 Stop 훅과 같은 자리)
 *  - 프로젝트의 .pi/checks.json: {"checks": [{"name": "모델 표준 점검", "when": ["models/**", "common/**"], "run": "python tools/check_standard.py --changed", "timeout": 180}]}
 *  - 요청이 끝까지 쓴 답으로 끝났고, 그 요청이 시작된 뒤 고친 파일(명령·스크립트로 바꾼 것도: 고친 시각으로 찾음)이 when 에 맞을 때만
 *  - 실패(종료 코드가 0 이 아님)하면 출력 끝부분과 함께 '고치고 다시 확인하라' 는 요청을 pi 에게 한 번 보내고, 그 뒤에 다시 돌려 결과를 알린다 (더 되풀이하지 않음).
 *    그래도 실패한 점검은 뒤 요청(도구를 쓴 것)이 끝날 때 파일이 바뀌지 않았어도 다시 돌려, 통과하거나 결과가 달라지면 알리기만 한다
 *    (2026-10 시험: pi 가 '12개 모델을 시험해도 되느냐' 고 묻고, 사용자가 허락한 다음 요청은 파일을 바꾸지 않아 점검하지 않았음)
 *  - 명령은 프로젝트·명령마다 처음 한 번 실행해도 되는지 묻는다 (답은 doc-rules.json 의 checks). 계획 모드·화면이 없는 실행에서는 하지 않음
 *  - 설정: "done_checks": false (끔, /hooks off checks 와 같음)
 *
 * 문법 확인 (2026-10-27, oh-my-pi 가 고친 파일의 진단을 도구 결과에 붙이는 것을 참고해 새로 씀)
 *  - write·edit 로 고친 .py·.json·.ipynb·.yaml·.yml 이 깨졌으면 그 도구 결과에 줄 번호와 함께 알린다 (통과하면 아무것도 붙이지 않음)
 *  - .py 는 지금 실행 위치(jupyter 모드면 노트북)의 Python 으로 (작업 폴더의 .venv 먼저: 그 버전의 문법), .yaml 은 PyYAML 이 있을 때만,
 *    JSON 은 주석·끝 쉼표만 있는 것(tsconfig.json·VS Code 설정)과 {{ }} 틀은 깨진 것으로 보지 않음
 *  - 설정: "syntax_check": false (끔, /hooks off syntax 와 같음)
 *
 * /hooks: 키트 훅(위험 명령 확인, 문서 규칙, 완료 점검, 팀 규칙, 문법 확인)과 내 훅(extensions 폴더의 키트 밖 파일)을 보여 주고 켜고 끈다.
 *   '/hooks off mine' 은 내 훅만 끈다 (훅을 모두 끄면서 guard.ts 까지 꺼져 git push 가 묻지 않고 실행된 일 때문).
 *   위험 명령 확인이 꺼져 있으면(guard.ts 가 없거나 "guard": false) 상태 줄에 늘 알린다
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, posix } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Box, Text } from "@earendil-works/pi-tui";
import { cleanPath, isPlanDoc, isPlanName, projectRel, type WorkDir } from "./lib/paths.ts";
import { localPython, NB_FIND_PY, runProc } from "./lib/python.ts";
import { nbRun, readTarget, shown, shq, type Target, target, userAsk } from "./lib/relay.ts";
import { rulesOn, writtenText } from "./lib/rules.ts";
import { base, parseShell, strip, writtenPaths } from "./lib/shell.ts";

// ---------------------------------------------------------------------------
// 설정
// ---------------------------------------------------------------------------

/** 키트가 설치하는 확장 (install.sh·update.sh 의 KIT_EXT 와 같게. tests/test_hooks.mjs 가 확인). 이 밖의 파일이 '내 훅' */
export const KIT_EXT = ["copilot-session.ts", "jupyter.ts", "guard.ts", "notify.ts", "kit.ts", "undo.ts", "modes.ts", "memory.ts", "files.ts", "wiki.ts", "hooks.ts", "rules.ts"];

const agentDir = () => process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
const userConfigFile = () => process.env.PI_COPILOT_USER_CONFIG || join(agentDir(), "bridge.json");
const stateFile = () => join(agentDir(), "doc-rules.json");
export const extDir = () => join(agentDir(), "extensions");

function readJson(p: string): any {
	try {
		const v = JSON.parse(readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
		return v && typeof v === "object" && !Array.isArray(v) ? v : {};
	} catch {
		return {};
	}
}

/** 내 설정 파일에 값 하나를 쓴다 (다른 값은 그대로, undefined 면 지움). 형식이 틀린 파일은 고치지 않고 오류 */
export function saveSetting(key: string, value: unknown, file = userConfigFile()) {
	let raw = "";
	try {
		raw = readFileSync(file, "utf8").replace(/^\uFEFF/, "");
	} catch (e: any) {
		if (e?.code !== "ENOENT") throw e;
	}
	const v = raw.trim() ? JSON.parse(raw) : {};
	if (value === undefined) delete v[key];
	else v[key] = value;
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, `${JSON.stringify(v, null, 2)}\n`);
}

export type DocCfg = { on: boolean; index: string; limit: number };
/** 설정의 상대 경로 정리 (앞의 ./, 끝의 /). 절대 경로·.. 이 든 경로는 null */
function relSetting(s: unknown): string | null {
	if (typeof s !== "string") return null;
	const t = s.trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
	if (!t || t.startsWith("/") || /^[a-zA-Z]:/.test(t) || t.split("/").includes("..")) return null;
	return t;
}
export function docCfg(v: any = readJson(userConfigFile())): DocCfg {
	const lim = Number(v.doc_new_limit);
	return { on: v.doc_rules !== false, index: relSetting(v.doc_index) || "docs/INDEX.md", limit: Number.isInteger(lim) && lim >= 0 ? lim : 2 };
}
/** 계획서 폴더 (계획 모드에서 쓸 수 있는 곳, 작업 폴더 기준. 설정 "plan_dir", 기본 docs/plans) */
export const planDirOf = (v: any = readJson(userConfigFile())) => relSetting(v.plan_dir) || "docs/plans";

/** 지침에 더하는 문서 규칙 (늘 같은 글: 바뀌면 Copilot·사내AI 가 새 대화를 엶) */
export const DOC_GUIDE =
	"문서 규칙: 한 일·바뀐 점(이력)은 새 문서로 만들지 말고 프로젝트의 HISTORY.md 하나에 '## 날짜 제목' 절로 이어 쓴다. " +
	"계획 문서는 작업마다 하나만 두고 다음 단계는 그 문서를 고친다. 새 문서는 꼭 필요할 때만 만든다 (문서 목록에는 pi 가 링크를 더한다).";

// ---------------------------------------------------------------------------
// 문서 가리기 (시험할 수 있게 순수 함수로)
// ---------------------------------------------------------------------------

const NO_RULES = new Set(["index.md", "readme.md", "agents.md", "claude.md", "notes.md", "skill.md", "changelog.md", "license.md", "contributing.md"]);
const NO_LINK = new Set(["agents.md", "claude.md", "notes.md", "skill.md"]);
const nameOf = (rel: string) => rel.split("/").pop() || rel;

/** 문서 규칙이 보는 파일: Markdown, 숨김 폴더·node_modules 밖 (경로는 작업 폴더 기준) */
export function isDoc(rel: string): boolean {
	return /\.(md|markdown)$/i.test(rel) && !rel.split("/").some((s) => s.startsWith(".") || s === "node_modules");
}

export type DocKind = "history" | "plan" | "doc";
/** 파일 이름으로 본 문서 종류: 이력(이력·작업 기록·진행 상황·worklog 등), 계획(계획·plan·todo·할 일), 그 밖 */
export function docKind(rel: string): DocKind {
	const n = nameOf(rel).replace(/\.(md|markdown)$/i, "").toLowerCase();
	if (/(이력|히스토리|history|작업[\s_-]*(기록|내역)|변경[\s_-]*(내역|이력)|진행[\s_-]*(기록|상황)|work-?log|dev-?log)/.test(n)) return "history";
	if (isPlanName(n)) return "plan";
	return "doc";
}
/** 개수·이력·계획 규칙을 보지 않는 문서: 목록 문서, README 같은 정해진 이름 (이력 파일 자신은 tool_call 에서 따로) */
export const ruleFree = (rel: string, index: string) => rel.toLowerCase() === index.toLowerCase() || NO_RULES.has(nameOf(rel).toLowerCase());
/** 목록에 링크하지 않는 문서: 목록 문서 자신, 맨 위 README, 지침·메모·스킬 파일 */
export const linkFree = (rel: string, index: string) =>
	rel.toLowerCase() === index.toLowerCase() || rel.toLowerCase() === "readme.md" || NO_LINK.has(nameOf(rel).toLowerCase());

/** 목록에 적을 제목: 문서의 첫 '# 제목', 없으면 이력 문서는 '작업 이력'(첫 줄이 '## 날짜 제목' 절이라), 그 밖은 파일 이름 */
export function docTitle(content: unknown, rel: string): string {
	const m = typeof content === "string" ? content.match(/^#\s+(.+?)\s*#*\s*$/m) : null;
	const t = (m ? m[1] : docKind(rel) === "history" ? "작업 이력" : nameOf(rel).replace(/\.(md|markdown)$/i, "")).replace(/[[\]]/g, "").trim();
	return t.length > 80 ? `${t.slice(0, 79)}…` : t;
}

/** 자리만 잡는 내용인지: 자리 표시 말(placeholder, '나중에 채움' 등)이 있고 실제 코드 줄이 거의 없는 짧은 글.
 *  빈 파일(__init__.py 등)은 아님 (2026-10 ML 시험: train_v2.py 를 '# placeholder … will contain …' 로 먼저 쓰고 다시 씀) */
export function placeholderOnly(content: unknown): boolean {
	if (typeof content !== "string" || content.length > 800) return false;
	if (!/placeholder|자리\s*표시|to be (filled|implemented|written)|will (contain|be (written|implemented|filled))|TODO:?\s*(implement|fill|write)|(나중에|다음 단계에서|이후에?)\s*(채|작성|구현)/i.test(content))
		return false;
	const code = content.split(/\r?\n/).filter((l) => {
		const s = l.trim();
		return s && !/^(#|\/\/|--|\/\*|\*|<!--|;|%|"""|'''|pass$|\.\.\.$)/.test(s);
	});
	return code.length <= 2;
}
export const PLACEHOLDER_NOTE = "(이 파일에는 자리 표시 내용만 있습니다. 빈 파일을 먼저 만들지 말고, 실제 내용으로 바로 쓰세요)";

/** 끝날 때까지 아무것도 찍지 않고 기다리는 호출의 이름 (없으면 ""). 2026-10 ML 시험: 지침에 이름을 적어도
 *  프로젝트에 있던 코드를 따라 wait_for_run_completion 으로 기다리는 파일을 새로 씀 (기다리는 동안 사용자는 진행을 못 봄) */
export function silentWait(text: unknown): string {
	if (typeof text !== "string") return "";
	if (/\bwait_for_run_completion\s*\(/.test(text)) return "wait_for_run_completion";
	if (/\bkubectl\s+wait\b/.test(text)) return "kubectl wait";
	return "";
}
export const waitNote = (name: string) =>
	`(${name} 은 끝날 때까지 아무것도 찍지 않아, 기다리는 동안 사용자가 진행을 볼 수 없습니다. ` +
	"30초마다 상태를 찍는 반복(10분 안쪽, print 는 flush=True)으로 바꾸세요. KFP 는 client.get_run(run_id).state)";

/** 파이프라인 단계 안에서 DB 에 접속하는 코드인지 (KFP 단계·파이프라인 표시와 DB 접속이 한 글에 있음). 2026-10-23 ML 시험:
 *  프로젝트 안내 문서를 먼저 읽고도 그 규칙('단계 안에서 DB 를 쓰려면 먼저 사용자에게')을 지나쳐, DB 를 읽는 단계를 만들어 바로 제출함 */
export function stepDb(text: unknown): boolean {
	if (typeof text !== "string") return false;
	const step = /@(?:dsl\.)?(?:component|pipeline)\b|\bdsl\.(?:component|pipeline)\s*\(|\bcreate_component_from_func\b/.test(text);
	return step && /\bcreate_engine\s*\(|\bpsycopg2?\.connect\s*\(|\bpymysql\.connect\s*\(|\bPG(?:HOST|USER|PASSWORD)\b/.test(text);
}
export const STEP_DB_NOTE =
	"(이 코드는 파이프라인 단계 안에서 DB 에 접속합니다. 단계 파드에는 노트북의 DB 접속 정보(환경 변수)가 없어 Secret 설정이 따로 필요합니다. " +
	"제출하기 전에 사용자에게 알리고 어떻게 할지 정하세요. 비밀번호는 코드·파이프라인 인자에 넣지 마세요)";
/** write·edit·bash 로 새로 들어가는 글: lib/rules.ts 로 옮김 (팀 규칙도 씀) */
export { writtenText };
/** 목록 문서에서 본 링크 대상 (빈칸은 %20) */
export const linkTarget = (index: string, rel: string) => posix.relative(posix.dirname(index), rel).replace(/ /g, "%20");

export const NEW_INDEX = "# 문서 목록\n\n이 프로젝트의 문서입니다. pi 가 새 문서를 만들면 아래에 링크를 더합니다 (문서 규칙: pi 의 /hooks).\n\n## 문서\n";
/** 목록 글에 링크 줄을 더한 글 ('## 문서' 절 끝에, 없으면 절을 만듦). 그 대상의 링크가 이미 있으면 null */
export function addLink(text: string, line: string, target: string): string | null {
	if (text.includes(`](${target})`)) return null;
	const nl = text.includes("\r\n") ? "\r\n" : "\n";
	const lines = text.split(/\r?\n/);
	const h = lines.findIndex((l) => /^##\s+문서\s*$/.test(l));
	if (h < 0) return `${text.replace(/\s+$/, "")}${nl}${nl}## 문서${nl}${line}${nl}`;
	let end = lines.length;
	for (let i = h + 1; i < lines.length; i++)
		if (/^#{1,2}\s/.test(lines[i])) {
			end = i;
			break;
		}
	let at = end;
	while (at > h + 1 && !lines[at - 1].trim()) at--;
	lines.splice(at, 0, line);
	return lines.join(nl);
}

// 작업 폴더 기준 상대 경로 (작업 폴더 밖이면 null: 그쪽은 위험 명령 확인이 봄). 계획 모드(modes.ts)와 함께 쓰므로 lib 에 둠
export { projectRel, type WorkDir } from "./lib/paths.ts";

/** 이 도구 호출이 만들 수 있는 Markdown 파일: write 의 path, bash 의 > 파일·>> 파일·tee 파일 (content 는 write 만) */
export function docTargets(toolName: string, input: any): { path: string; content?: string }[] {
	const out: { path: string; content?: string }[] = [];
	if (toolName === "write" && typeof input?.path === "string") out.push({ path: input.path, content: input.content });
	else if (toolName === "bash" && typeof input?.command === "string") for (const p of writtenPaths(input.command)) out.push({ path: p });
	return out.filter((t, i) => /\.(md|markdown)$/i.test(t.path) && out.findIndex((u) => u.path === t.path) === i);
}

// ---------------------------------------------------------------------------
// 파일 (PC 는 Node fs, jupyter 모드는 jupyter.ts 가 여는 노트북 파일 기능)
// ---------------------------------------------------------------------------

export type Fs = { abs(rel: string): string; exists(p: string): Promise<boolean>; read(p: string): Promise<string | null>; write(p: string, text: string): Promise<void> };
export function fsFor(wd: WorkDir): Fs | null {
	if (wd.remote) {
		const r = (globalThis as any).__piRemoteFs;
		if (!r) return null;
		return {
			abs: (rel) => posix.join(wd.cwd, rel),
			exists: async (p) => {
				try {
					await r.stat(p);
					return true;
				} catch (e: any) {
					if (e?.code === "ENOENT") return false;
					throw e;
				}
			},
			read: async (p) => {
				try {
					return await r.read(p);
				} catch {
					return null;
				}
			},
			write: (p, t) => r.write(p, t),
		};
	}
	return {
		abs: (rel) => join(wd.cwd, rel),
		exists: async (p) => existsSync(p),
		read: async (p) => {
			try {
				return readFileSync(p, "utf8");
			} catch {
				return null;
			}
		},
		write: async (p, t) => {
			mkdirSync(dirname(p), { recursive: true });
			writeFileSync(p, t);
		},
	};
}

// ---------------------------------------------------------------------------
// 완료 점검 (프로젝트의 .pi/checks.json, 시험할 수 있게 순수 함수로)
// ---------------------------------------------------------------------------

export const CHECKS_FILE = ".pi/checks.json";
export type Check = { name: string; when: string[]; run: string; timeout: number };
/** 점검 목록: {"checks": [{"name", "when": ["models/**", ...], "run": "명령", "timeout": 초}]} (배열만 적어도 됨). 형식이 틀린 항목은 뺌 */
export function parseChecks(text: string | null): Check[] {
	if (!text) return [];
	let v: any;
	try {
		v = JSON.parse(text.replace(/^﻿/, ""));
	} catch {
		return [];
	}
	const list = Array.isArray(v) ? v : Array.isArray(v?.checks) ? v.checks : [];
	const out: Check[] = [];
	for (const c of list) {
		const run = typeof c?.run === "string" ? c.run.trim() : "";
		const when = (Array.isArray(c?.when) ? c.when : typeof c?.when === "string" ? [c.when] : []).filter((g: unknown) => typeof g === "string" && g.trim());
		if (!run || !when.length) continue;
		const t = Number(c.timeout);
		out.push({ name: typeof c.name === "string" && c.name.trim() ? c.name.trim() : run.slice(0, 60), when, run, timeout: Number.isFinite(t) && t > 0 ? Math.min(Math.max(t, 5), 600) : 120 });
	}
	return out;
}

const reEsc = (s: string) => s.replace(/[.+^${}()|[\]\\]/g, "\\$&");
/** 작업 폴더 기준 경로에 맞춰 볼 glob: ** 는 여러 폴더, * 는 / 없는 글자, ? 는 한 글자. 와일드카드가 없으면 그 파일·폴더 아래 전부 */
export function globRe(glob: string): RegExp {
	let g = glob.trim().replace(/\\/g, "/").replace(/^\.\//, "");
	if (g.endsWith("/")) g += "**";
	if (!/[*?]/.test(g)) return new RegExp(`^${reEsc(g)}(?:/.*)?$`);
	let re = "";
	for (let i = 0; i < g.length; i++) {
		const c = g[i];
		if (c === "*" && g[i + 1] === "*") {
			if (g[i + 2] === "/") {
				re += "(?:.*/)?";
				i += 2;
			} else {
				re += ".*";
				i += 1;
			}
		} else if (c === "*") re += "[^/]*";
		else if (c === "?") re += "[^/]";
		else re += reEsc(c);
	}
	return new RegExp(`^${re}$`);
}
export const matchesAny = (rel: string, globs: string[]) => globs.some((g) => globRe(g).test(rel));
/** 바뀐 파일을 찾을 폴더: glob 의 앞쪽 와일드카드 없는 폴더들 (하나라도 처음부터 와일드카드면 작업 폴더 전체 ".") */
export function globRoots(globs: string[]): string[] {
	const roots = new Set<string>();
	for (const glob of globs) {
		const parts = glob.trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "").split("/");
		const k = parts.findIndex((p) => /[*?]/.test(p));
		const lit = (k < 0 ? parts : parts.slice(0, k)).join("/");
		roots.add(lit && !lit.split("/").includes("..") ? lit : ".");
	}
	if (roots.has(".")) return ["."];
	const list = [...roots].sort();
	return list.filter((r) => !list.some((o) => o !== r && r.startsWith(`${o}/`)));
}
const SKIP_DIRS = new Set([".git", "node_modules", "__pycache__", ".venv", ".ipynb_checkpoints"]);
/** 노트북에서 '요청이 시작된 뒤(sec 초 전부터, 2초 여유) 고친 파일' 을 찾는 명령 (시각은 노트북 시계로: PC 와 시계가 달라도 됨) */
export function findChangedCmd(roots: string[], sec: number): string {
	const prune = [...SKIP_DIRS].map((n) => `-name ${n}`).join(" -o ");
	return `t=$(( $(date +%s) - ${Math.ceil(sec) + 2} )); find ${roots.map(shq).join(" ")} \\( ${prune} \\) -prune -o -type f -newermt "@$t" -print 2>/dev/null | head -500`;
}
/** PC 의 작업 폴더에서 since(ms) 뒤에 고친 파일 (폴더를 많이 돌지 않게 limit 개까지 봄) */
export function localChanged(cwd: string, roots: string[], since: number, limit = 20000): string[] {
	const out: string[] = [];
	let seen = 0;
	const walk = (rel: string) => {
		if (++seen > limit) return;
		let st: ReturnType<typeof statSync>;
		try {
			st = statSync(join(cwd, rel));
		} catch {
			return;
		}
		if (st.isDirectory()) {
			let names: string[] = [];
			try {
				names = readdirSync(join(cwd, rel));
			} catch {
				return;
			}
			for (const n of names) if (!SKIP_DIRS.has(n)) walk(rel === "." ? n : `${rel}/${n}`);
		} else if (st.mtimeMs >= since - 1000) out.push(rel);
	};
	for (const r of roots) walk(r);
	return out;
}
/** 점검 명령의 출력 끝부분 (pi 에게·알림에) */
export function tail(out: string, max = 2500): string {
	const t = out.replace(/\r/g, "").trim();
	return t.length > max ? `…${t.slice(t.length - max)}` : t;
}
export type CheckResult = { check: Check; code: number | null; out: string };
export const CHECK_ASK = "(완료 점검 실패: 고치고 다시 확인)";
/** 점검 명령을 돌려도 되는지 묻는 고르기 창의 답 (예·아니요만 프로젝트에 남김) */
export const CONSENT = { yes: "예, 이 프로젝트에서 요청이 끝날 때마다 실행", no: "아니요, 이 프로젝트에서는 실행하지 않음", skip: "이번만 건너뛰기 (다음에 다시 묻기)" };
/** 점검이 실패했을 때 pi 에게 한 번 보내는 요청 */
export function followUpText(failed: CheckResult[]): string {
	return [
		`[완료 점검] 팀이 정한 완료 점검(${CHECKS_FILE})이 실패했습니다.`,
		...failed.map((r) => `\n## ${r.check.name} (${r.check.run} → ${r.code === null ? "시간 초과·실행 못 함" : `종료 코드 ${r.code}`})\n${tail(r.out) || "(출력 없음)"}`),
		"",
		"이번 요청에서 한 일에 관계된 것은 고치고, 같은 점검 명령으로 다시 확인한 뒤 결과를 답하세요.",
		// 2026-10-24 비교 시험: 점검이 돌려준 것을 고친 뒤 도구를 다시 돌리지 않고, 고치기 전 실행 결과로 '실행 확인' 이라고 답함
		"고친 파일(만든 도구·스크립트 등)은 고친 뒤 다시 실행해 결과를 보세요. 고치기 전에 돌린 결과로 확인했다고 쓰지 마세요.",
		"사용자 승인이 필요한 것(운영 반영, 등록, 이번 요청에서 만들지 않은 데이터 지우기 등)은 하지 말고 답에 적어 물으세요. " +
			"이번 요청에서 만든 임시 파일·기록을 정리하는 것은 고칠 일에 들어갑니다. 이번 요청과 관계없는 항목은 고치지 말고 알리기만 하세요.",
	].join("\n");
}

// ---------------------------------------------------------------------------
// 문법 확인 (시험할 수 있게 순수 함수로. 실행은 확장 안에서)
// ---------------------------------------------------------------------------

export type SyntaxKind = "py" | "json" | "yaml";
/** 문법을 확인할 파일 종류 (경로에 {{ }} 가 든 틀 폴더는 뺌: cookiecutter 등) */
export function syntaxKind(path: string): SyntaxKind | null {
	if (path.includes("{{")) return null;
	const ext = (path.toLowerCase().match(/\.([a-z]+)$/) || [])[1];
	if (ext === "py") return "py";
	if (ext === "json" || ext === "ipynb") return "json";
	if (ext === "yaml" || ext === "yml") return "yaml";
	return null;
}
export type SyntaxProblem = { line?: number; col?: number; msg: string; text?: string; by?: string };
/** 이보다 큰 JSON 은 문법을 보지 않음 (바이트·글자) */
export const SYNTAX_JSON_MAX = 2_000_000;

/** 주석(//, /* … *\/)과 끝 쉼표를 뺀 JSON (tsconfig.json·VS Code 설정 같은 JSONC 를 깨진 것으로 보지 않으려고) */
export function stripJsonc(s: string): string {
	let out = "";
	for (let i = 0; i < s.length; i++) {
		const c = s[i];
		if (c === '"') {
			let j = i + 1;
			while (j < s.length && s[j] !== '"') j += s[j] === "\\" ? 2 : 1;
			out += s.slice(i, j + 1);
			i = j;
		} else if (c === "/" && s[i + 1] === "/") {
			while (i < s.length && s[i] !== "\n") i++;
			out += "\n";
		} else if (c === "/" && s[i + 1] === "*") {
			const k = s.indexOf("*/", i + 2);
			i = k < 0 ? s.length : k + 1;
		} else out += c;
	}
	return out.replace(/,(\s*[}\]])/g, "$1");
}
/** JSON 문법: 깨졌으면 문제, 아니면 null. 빈 파일, 주석·끝 쉼표만 있는 JSONC, {{ }} 틀은 깨진 것으로 보지 않음 */
export function jsonProblem(text: string): SyntaxProblem | null {
	const t = text.replace(/^﻿/, "");
	if (!t.trim()) return null;
	try {
		JSON.parse(t);
		return null;
	} catch (e) {
		if (t.includes("{{")) return null;
		try {
			JSON.parse(stripJsonc(t));
			return null;
		} catch {}
		const msg = String((e as Error)?.message ?? e);
		const lc = msg.match(/line (\d+) column (\d+)/);
		const pos = msg.match(/position (\d+)/);
		let line: number | undefined;
		let col: number | undefined;
		if (lc) [line, col] = [Number(lc[1]), Number(lc[2])];
		else if (pos) {
			const before = t.slice(0, Number(pos[1]));
			line = before.split("\n").length;
			col = before.length - before.lastIndexOf("\n");
		}
		return { line, col, msg: msg.replace(/\s*\(line \d+ column \d+\)/, "").replace(/ in JSON at position \d+/, "").slice(0, 160) };
	}
}
/** .py·.yaml 문법 확인 (Python 에 '<파일> <py|yaml>' 인자, '@@SYNTAX {…}' 한 줄을 찍음). yaml 은 PyYAML 이 있을 때만, {{ }} 틀은 건너뜀.
 *  yaml 은 구조만 읽음 (!Ref 같은 사용자 태그를 오류로 보지 않게) */
export const SYNTAX_PY = `import json, sys
def done(**k):
    print("@@SYNTAX " + json.dumps(k, ensure_ascii=False))
    sys.exit(0)
path, kind = sys.argv[1], sys.argv[2]
try:
    src = open(path, "rb").read()
except Exception:
    done(skip=1)
if kind == "py":
    by = sys.version.split()[0]
    try:
        compile(src, path, "exec", 1024, True)
    except SyntaxError as e:
        done(line=e.lineno, col=e.offset, msg=str(e.msg)[:200], text=(e.text or "").strip()[:160], by=by)
    except (ValueError, TypeError) as e:
        done(msg=str(e)[:200], by=by)
elif kind == "yaml":
    if b"{{" in src:
        done(skip=1)
    try:
        import yaml
    except Exception:
        done(skip=1)
    try:
        for _ in yaml.parse(src.decode("utf-8", "replace")):
            pass
    except yaml.YAMLError as e:
        m = getattr(e, "problem_mark", None)
        done(line=m.line + 1 if m else None, col=m.column + 1 if m else None, msg=str(getattr(e, "problem", None) or e)[:200])
done(ok=1)
`;
/** 노트북에서 돌리는 문법 확인 명령 (Python 은 NB_FIND_PY 로 찾음. 없으면 건너뜀) */
export function notebookSyntaxCmd(abs: string, kind: SyntaxKind): string {
	return [
		NB_FIND_PY,
		`[ -n "$PY" ] || { echo '@@SYNTAX {"skip": 1}'; exit 0; }`,
		`PYTHONIOENCODING=utf-8 PYTHONDONTWRITEBYTECODE=1 timeout 30 "$PY" - ${shq(abs)} ${kind} <<'PISYNTAXEOF' 2>/dev/null`,
		SYNTAX_PY.trimEnd(),
		"PISYNTAXEOF",
	].join("\n");
}
/** 확인 결과 줄 -> 문제 (통과·건너뜀·못 읽음은 null) */
export function parseSyntaxOut(out: string): SyntaxProblem | null {
	const m = out.match(/^@@SYNTAX (\{.*\})\s*$/m);
	if (!m) return null;
	try {
		const v = JSON.parse(m[1]);
		if (v.ok || v.skip || typeof v.msg !== "string") return null;
		const num = (x: unknown) => (typeof x === "number" && x > 0 ? x : undefined);
		return { line: num(v.line), col: num(v.col), msg: v.msg, text: v.text || undefined, by: v.by || undefined };
	} catch {
		return null;
	}
}
/** 도구 결과에 붙일 글 */
export function syntaxNote(file: string, kind: SyntaxKind, p: SyntaxProblem): string {
	const where = p.line ? ` ${p.line}번째 줄${p.col ? ` ${p.col}번째 글자` : ""}` : "";
	const what = kind === "py" ? `Python 문법 오류${p.by ? ` (Python ${p.by} 기준)` : ""}` : kind === "json" ? "JSON 형식 오류" : "YAML 형식 오류";
	return `(문법 확인: ${file}${where} — ${what}: ${p.msg}${p.text ? ` · ${p.text}` : ""}. 이대로는 ${kind === "py" ? "실행되지" : "읽히지"} 않으니 고치세요)`;
}

// ---------------------------------------------------------------------------
// 훅 상태 (/hooks)
// ---------------------------------------------------------------------------

/** 위험 명령 확인이 켜져 있는지: guard.ts 가 있고 "guard": false 가 아님 */
export function guardState(dir = extDir(), cfg: any = readJson(userConfigFile())): { on: boolean; why?: string } {
	if (!existsSync(join(dir, "guard.ts"))) return { on: false, why: existsSync(join(dir, "guard.ts.off")) ? "guard.ts.off" : "guard.ts 없음" };
	if (cfg.guard === false) return { on: false, why: '"guard": false' };
	return { on: true };
}

export type MyHook = { name: string; on: boolean; path: string; folder: boolean };
/** 내 훅: extensions 폴더의 키트 밖 확장 (파일 .ts·.js, index 가 든 폴더). 끈 것은 이름 끝이 .off (폴더는 index.ts.off) */
export function myHooks(dir = extDir()): MyHook[] {
	let names: string[] = [];
	try {
		names = readdirSync(dir);
	} catch {
		return [];
	}
	const out: MyHook[] = [];
	for (const n of names.sort()) {
		if (n === "lib") continue;
		const p = join(dir, n);
		let folder = false;
		try {
			folder = statSync(p).isDirectory();
		} catch {
			continue;
		}
		if (folder) {
			const on = ["index.ts", "index.js"].some((f) => existsSync(join(p, f)));
			if (on || ["index.ts.off", "index.js.off"].some((f) => existsSync(join(p, f)))) out.push({ name: n, on, path: p, folder: true });
			continue;
		}
		const m = n.match(/^(.+\.(?:ts|js))(\.off)?$/);
		if (m && !KIT_EXT.includes(m[1])) out.push({ name: m[1], on: !m[2], path: p, folder: false });
	}
	return out;
}
/** 내 훅 하나 켜기·끄기 (이름 바꾸기). 바꿨으면 true */
export function switchHook(h: MyHook, on: boolean): boolean {
	if (h.on === on) return false;
	if (h.folder) {
		for (const f of ["index.ts", "index.js"]) {
			const a = join(h.path, f);
			if (on && existsSync(`${a}.off`)) renameSync(`${a}.off`, a);
			if (!on && existsSync(a)) renameSync(a, `${a}.off`);
		}
	} else renameSync(h.path, on ? h.path.replace(/\.off$/, "") : `${h.path}.off`);
	return true;
}

// ---------------------------------------------------------------------------
// 확장
// ---------------------------------------------------------------------------

const ENTRY = "pi-docs";
const today = () => {
	const d = new Date();
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
type Doc = { rel: string; title: string; kind: DocKind; counted: boolean };
type Pending = { docs: Doc[]; notes: string[] };

export default function (pi: ExtensionAPI) {
	// 요청마다: 새로 만든 문서, '새 문서를 더 만들까요?'·'이력은 HISTORY 로?'·'계획 문서를 또?' 의 답. 세션마다: 만든 계획 문서, 안내를 붙인 파일 ('wait:경로'·'db:경로')
	const S: { newDocs: string[]; more?: boolean; history?: boolean; plan?: boolean; plans: string[]; warned: boolean; noted: string[] } = ((globalThis as any).__piDocRules ||= {
		newDocs: [],
		plans: [],
		warned: false,
		noted: [],
	});
	S.noted ||= []; // 예전 버전이 만든 상태를 /reload 로 이어받았을 때
	const pending = new Map<string, Pending>();
	let queue: Promise<unknown> = Promise.resolve();
	/** 한 번에 하나씩 (한 답의 도구 호출이 동시에 돌 때 개수 세기·묻기·목록 고치기가 섞이지 않게) */
	const serial = <T>(fn: () => Promise<T>): Promise<T> => {
		const p = queue.then(fn, fn);
		queue = p.catch(() => {});
		return p;
	};
	const workDir = (ctx: any): WorkDir => (globalThis as any).__piWorkDir || { remote: false, cwd: ctx?.cwd || process.cwd() };
	/** 묻는지: 화면이 있고 확인 모드가 아닐 때 (확인 모드는 쓰기마다 그쪽이 물음) */
	const canAsk = (ctx: any) => !!ctx?.hasUI && (globalThis as any).__piMode !== "ask";
	const post = (ctx: any, lines: string[]) => {
		if (!lines.length || ctx?.mode !== "tui" || typeof pi.appendEntry !== "function") return;
		try {
			pi.appendEntry(ENTRY, { lines });
		} catch {}
	};
	pi.registerEntryRenderer?.(ENTRY, (entry: any, _opts: unknown, theme: any) => {
		const lines = entry?.data?.lines;
		if (!Array.isArray(lines)) return undefined;
		const box = new Box(1, 0, (t: string) => theme.bg("customMessageBg", t));
		box.addChild(new Text([theme.fg("customMessageLabel", theme.bold("[문서]")), ...lines.map((l: string) => theme.fg("customMessageText", String(l)))].join("\n"), 0, 0));
		return box;
	});

	/** 이력 파일: 있는 것 (맨 위 HISTORY.md, 목록 문서 옆 HISTORY.md 차례). 둘 다 없으면 지금 만들려는 것이 그 둘 중 하나면 그것
	 *  (지침대로 맨 위 HISTORY.md 를 처음 만들 때 묻지 않게), 아니면 목록 문서 옆 (기본 docs/HISTORY.md) */
	const historyFile = async (fs: Fs, cfg: DocCfg, rel = "") => {
		const near = posix.join(posix.dirname(cfg.index), "HISTORY.md");
		for (const c of ["HISTORY.md", near]) if (await fs.exists(fs.abs(c)).catch(() => false)) return c;
		return ["history.md", near.toLowerCase()].includes(rel.toLowerCase()) ? rel : near;
	};

	/** 새 문서 하나에 대한 규칙: 막을 이유(모델에게), 결과에 붙일 안내, 대화창 항목 */
	async function rules(rel: string, kind: DocKind, cfg: DocCfg, ctx: any, hist: string): Promise<{ block?: string; note?: string; view?: string }> {
		const ask = canAsk(ctx);
		let allowed = false; // 이 문서로 이미 물었고 '만들어도 됨' (같은 문서로 두 번 묻지 않음)
		if (kind === "history") {
			if (!ask) return { note: `(문서 규칙: 이력은 새 문서 대신 ${hist} 하나에 '## 날짜 제목' 절로 이어 쓰기로 했습니다. 다음부터는 그렇게 하세요)` };
			if (S.history === undefined)
				S.history = await ctx.ui.confirm(
					"이력 문서",
					`새 문서 ${rel} 은(는) 이력 문서로 보입니다. 이력은 ${hist} 하나에 날짜 절로 이어 쓰기로 했습니다.\n\n새로 만들지 않고 ${hist} 에 이어 쓰게 할까요?\n(아니요: ${rel} 을(를) 그대로 만듦)`,
				);
			if (S.history)
				return {
					block:
						`사용자 문서 규칙: 이력(한 일·바뀐 점)은 새 문서(${rel})로 만들지 않고 ${hist} 하나에 '## 날짜 제목' 절로 이어 씁니다. ` +
						`같은 내용을 ${hist} 끝에 덧붙이세요 (없으면 만들고, 있으면 edit 로 끝에 더함). 다른 작업은 그대로 계속하세요.`,
					view: `이력 문서 ${rel} 대신 ${hist} 에 이어 쓰게 함`,
				};
			allowed = true;
		}
		if (kind === "plan" && S.plans.length && !allowed) {
			const last = S.plans[S.plans.length - 1];
			if (!ask) return { note: `(문서 규칙: 계획 문서는 작업마다 하나입니다. 같은 작업이면 새 계획 문서 대신 ${last} 를 고치세요)` };
			if (S.plan === undefined)
				S.plan = await ctx.ui.confirm(
					"계획 문서",
					`이번 세션에서 계획 문서 ${S.plans.join(", ")} 을(를) 이미 만들었습니다.\n새 계획 문서 ${rel} 을(를) 만들까요?\n\n아니요: 만들지 않고, 같은 작업이면 있는 계획 문서를 고치게 합니다.`,
				);
			if (!S.plan)
				return {
					block: `사용자 문서 규칙: 계획 문서는 작업마다 하나입니다. 새 계획 문서(${rel})를 만들지 말고 ${last} 를 고치세요. 다른 작업의 계획이라면 사용자에게 먼저 물어보세요.`,
					view: `두 번째 계획 문서 ${rel}: 만들지 않고 ${last} 를 고치게 함`,
				};
			allowed = true;
		}
		if (S.newDocs.length >= cfg.limit) {
			const list = S.newDocs.join(", ");
			if (!ask) return { note: `(문서 규칙: 이번 요청에서 새 문서가 ${S.newDocs.length + 1}개째입니다 (${list}). 새 문서보다 있는 문서에 이어 쓰세요)` };
			if (S.more === undefined && !allowed)
				S.more = await ctx.ui.confirm(
					"새 문서가 많습니다",
					`이번 요청의 새 문서가 벌써 ${S.newDocs.length}개입니다: ${list}\n또 만들 문서: ${rel}\n\n새 문서를 더 만들까요? (이 요청 동안 같은 답을 씁니다)\n아니요: 만들지 않고 이미 있는 문서에 이어 쓰게 합니다.`,
				);
			if (S.more === false && !allowed)
				return {
					block: `사용자 문서 규칙: 이번 요청에서는 새 문서를 더 만들지 않습니다 (이번 요청의 새 문서: ${list}). ${rel} 에 쓰려던 내용은 그 문서들이나 관련된 기존 문서에 이어 쓰세요.`,
					view: `새 문서 ${rel}: 이번 요청에서 ${S.newDocs.length}개를 넘어 만들지 않게 함`,
				};
		}
		return {};
	}

	/** 새 문서를 목록 문서에 링크 (목록이 없으면 프로젝트마다 한 번 묻고 만듦. 화면이 없으면 만들지 않음) */
	async function linkDoc(d: Doc, cfg: DocCfg, ctx: any, fs: Fs, wd: WorkDir): Promise<{ note: string; view: string } | null> {
		const indexPath = fs.abs(cfg.index);
		let text = await fs.read(indexPath);
		if (text === null) {
			const key = `${wd.remote ? "nb:" : ""}${wd.cwd}`;
			const st = readJson(stateFile());
			const known = st.index && typeof st.index === "object" ? st.index : {};
			let dec = known[key];
			if (dec !== "yes" && dec !== "no") {
				if (!ctx?.hasUI) return { note: `(문서 목록 ${cfg.index} 이 없어 링크를 달지 않았습니다)`, view: "" };
				const yes = await ctx.ui.confirm(
					"문서 목록",
					`새 문서 ${d.rel} 을(를) 만들었습니다.\n이 프로젝트 문서의 링크를 모아 둘 ${cfg.index} 를 만들까요?\n\n` +
						`(프로젝트마다 한 번만 묻습니다. 아니요면 이 프로젝트에서는 만들지 않고, 나중에 ${cfg.index} 를 직접 만들어 두면 그때부터 링크를 더합니다)`,
				);
				dec = yes ? "yes" : "no";
				try {
					writeFileSync(stateFile(), `${JSON.stringify({ ...st, index: { ...known, [key]: dec } }, null, 2)}\n`);
				} catch {}
			}
			if (dec !== "yes") return null;
			text = NEW_INDEX;
		}
		let title = d.title;
		if (title === docTitle(undefined, d.rel)) title = docTitle(await fs.read(fs.abs(d.rel)), d.rel); // bash 로 만든 문서: 파일의 첫 제목
		const target = linkTarget(cfg.index, d.rel);
		const out = addLink(text, `- [${title}](${target}) — ${today()}`, target);
		if (out === null) return null;
		await fs.write(indexPath, out);
		return { note: `(문서 목록 ${cfg.index} 에 링크를 더했습니다: ${d.rel})`, view: `새 문서 ${d.rel} → ${cfg.index} 에 링크` };
	}

	pi.on("agent_start", async () => {
		S.newDocs = [];
		S.more = S.history = S.plan = undefined;
		pending.clear();
	});
	pi.on("session_start", async (event: any, ctx: any) => {
		if (event?.reason !== "reload") {
			S.plans = [];
			S.warned = false;
			S.noted = [];
		}
		showGuard(ctx);
	});

	pi.on("before_agent_start", async (event: any) => {
		if (!docCfg().on) return;
		const g = event?.systemPromptOptions?.promptGuidelines;
		if (Array.isArray(g) && !g.includes(DOC_GUIDE)) g.push(DOC_GUIDE);
	});

	pi.on("tool_call", async (event: any, ctx: any) => {
		if (event.toolName !== "write" && event.toolName !== "bash") return;
		if ((globalThis as any).__piReview === "running") return; // /review 중에는 쓰기를 modes.ts 가 막음 (묻지 않음)
		const cfg = docCfg();
		if (!cfg.on) return;
		const plan = (globalThis as any).__piMode === "plan";
		if (plan && event.toolName !== "write") return; // 계획 모드는 계획서 쓰기(write)만 열려 있음 (modes.ts)
		let targets = docTargets(event.toolName, event.input);
		if (plan) targets = targets.filter((t) => isPlanDoc(projectRel(t.path, workDir(ctx)), planDirOf()));
		if (!targets.length) return;
		return serial(async () => {
			const wd = workDir(ctx);
			const fs = fsFor(wd);
			if (!fs) return;
			const got: Pending = { docs: [], notes: [] };
			const views: string[] = [];
			for (const t of targets) {
				const rel = projectRel(t.path, wd);
				if (!rel || !isDoc(rel) || S.newDocs.includes(rel) || got.docs.some((d) => d.rel === rel)) continue;
				let exists: boolean;
				try {
					exists = await fs.exists(fs.abs(rel));
				} catch {
					continue; // 노트북 연결 문제 등: 보지 않음
				}
				if (exists) continue;
				const kind = docKind(rel);
				const hist = kind === "history" ? await historyFile(fs, cfg, rel) : "";
				// 이력 파일 자신(HISTORY.md 를 처음 만듦)은 규칙 밖. 다른 곳의 HISTORY.md 는 이력 문서로 봄 (이력 파일이 둘이 되지 않게)
				const counted = !ruleFree(rel, cfg.index) && !(kind === "history" && rel.toLowerCase() === hist.toLowerCase());
				if (counted) {
					let v: { block?: string; note?: string; view?: string };
					try {
						v = await rules(rel, kind, cfg, ctx, hist);
					} catch {
						v = {};
					}
					if (v.block) {
						S.newDocs = S.newDocs.filter((x) => !got.docs.some((d) => d.rel === x)); // 같은 명령으로 셌던 것도 되돌림
						post(ctx, [...views, v.view || ""].filter(Boolean));
						return { block: true, reason: v.block };
					}
					if (v.note) got.notes.push(v.note);
					S.newDocs.push(rel);
				}
				got.docs.push({ rel, title: docTitle(t.content, rel), kind, counted });
			}
			if (got.docs.length) pending.set(event.toolCallId, got);
			post(ctx, views);
		});
	});

	pi.on("tool_result", async (event: any, ctx: any) => {
		const got = pending.get(event.toolCallId);
		if (!got) return;
		pending.delete(event.toolCallId);
		const cfg = docCfg();
		const wd = workDir(ctx);
		const fs = fsFor(wd);
		if (!fs) return;
		const notes = [...got.notes];
		const views: string[] = [];
		await serial(async () => {
			for (const d of got.docs) {
				let made = false;
				try {
					made = await fs.exists(fs.abs(d.rel));
				} catch {}
				if (!made) {
					if (d.counted) S.newDocs = S.newDocs.filter((x) => x !== d.rel);
					continue;
				}
				if (d.kind === "plan" && d.counted && !S.plans.includes(d.rel)) S.plans.push(d.rel);
				if (linkFree(d.rel, cfg.index)) continue;
				try {
					const r = await linkDoc(d, cfg, ctx, fs, wd);
					if (r) {
						notes.push(r.note);
						if (r.view) views.push(r.view);
					}
				} catch (e) {
					notes.push(`(문서 목록 ${cfg.index} 을 고치지 못했습니다: ${(e as Error).message})`);
				}
			}
		});
		post(ctx, views);
		if (!notes.length) return;
		return { content: [...(Array.isArray(event.content) ? event.content : []), { type: "text", text: notes.join("\n") }] };
	});

	// 자리 표시 파일, 아무것도 찍지 않고 기다리는 코드, 단계 안의 DB 접속 알림: 막지 않고 결과에 안내만 (문서 규칙 결과 뒤에 이어 붙음).
	//  기다리는 코드·DB 접속은 세션마다 파일(bash 는 한 번)마다 한 번만
	pi.on("tool_result", async (event: any) => {
		if (event.isError) return;
		const notes: string[] = [];
		if (event.toolName === "write" && placeholderOnly(event.input?.content)) notes.push(PLACEHOLDER_NOTE);
		const text = writtenText(event.toolName, event.input);
		const key = event.toolName === "bash" ? "(bash)" : String(event.input?.path ?? "");
		const once = (kind: string, note: string) => {
			if (S.noted.includes(`${kind}:${key}`)) return;
			S.noted.push(`${kind}:${key}`);
			notes.push(note);
		};
		const wait = silentWait(text);
		if (wait) once("wait", waitNote(wait));
		if (stepDb(text)) once("db", STEP_DB_NOTE);
		if (!notes.length) return;
		return { content: [...(Array.isArray(event.content) ? event.content : []), { type: "text", text: notes.join("\n") }] };
	});

	// ── 문법 확인 ──────────────────────────────────────────────────────────────
	// write·edit 로 고친 .py·.json·.ipynb·.yaml 이 깨졌을 때만 결과에 알림. 확인하지 못하면(Python 없음, 노트북 연결 문제) 조용히 넘어감
	const syntaxOn = () => readJson(userConfigFile()).syntax_check !== false;
	/** 파일 크기 (모르면 null: 노트북 홈 밖·숨김 경로는 노트북이 알려 주지 않음) */
	async function fileSize(t: Target): Promise<number | null> {
		try {
			if (!t.remote) return statSync(t.abs).size;
			const st = await (globalThis as any).__piRemoteFs?.stat(t.abs);
			return typeof st?.size === "number" ? st.size : null;
		} catch {
			return null;
		}
	}
	async function syntaxProblem(kind: SyntaxKind, t: Target, written: unknown, wd: WorkDir): Promise<SyntaxProblem | null> {
		if (kind === "json") {
			if (typeof written === "string") return written.length > SYNTAX_JSON_MAX ? null : jsonProblem(written);
			// 고친 파일은 다시 읽어 봄. 그림이 든 큰 .ipynb 등은 보지 않음 (jupyter 모드에서는 고칠 때 받은 파일을 한 번 더 받게 되므로)
			const size = await fileSize(t);
			if (size !== null && size > SYNTAX_JSON_MAX) return null;
			const text = (await readTarget(t))?.toString("utf8");
			return text == null || text.length > SYNTAX_JSON_MAX ? null : jsonProblem(text);
		}
		if (t.remote) return parseSyntaxOut((await nbRun(notebookSyntaxCmd(t.abs, kind), wd.cwd)).out);
		const py = await localPython(wd.remote ? homedir() : wd.cwd);
		if (!py) return null;
		return parseSyntaxOut((await runProc(py[0], [...py.slice(1), "-c", SYNTAX_PY, t.abs, kind], 30000)).out);
	}
	pi.on("tool_result", async (event: any, ctx: any) => {
		const tn = event.toolName;
		if ((tn !== "write" && tn !== "edit" && tn !== "bash") || !syntaxOn()) return;
		// bash 는 쓴 파일(리다이렉트·tee: 'cat > a.py <<EOF … EOF && python a.py')을, 뒤 명령이 실패했어도 본다. write·edit 는 성공했을 때만
		if (event.isError && tn !== "bash") return;
		const paths: unknown[] = tn === "bash" ? (typeof event.input?.command === "string" ? writtenPaths(event.input.command).slice(0, 5) : []) : [event.input?.path];
		const wd = workDir(ctx);
		const notes: string[] = [];
		for (const p of paths) {
			if (typeof p !== "string" || !cleanPath(p).trim()) continue;
			const kind = syntaxKind(cleanPath(p));
			if (!kind) continue;
			const t = target(p, wd);
			try {
				const prob = await syntaxProblem(kind, t, tn === "write" ? event.input?.content : undefined, wd);
				if (prob) notes.push(syntaxNote(shown(t, wd), kind, prob));
			} catch {}
		}
		if (!notes.length) return;
		return { content: [...(Array.isArray(event.content) ? event.content : []), { type: "text", text: notes.join("\n") }] };
	});

	// ── 완료 점검 ──────────────────────────────────────────────────────────────
	// 요청이 제대로 끝나면(마지막이 끝까지 쓴 답) 그 요청이 시작된 뒤 고친 파일을 찾아, 점검의 when 에 맞으면 점검 명령을 돌린다.
	// 실패하면 pi 에게 한 번 돌려주고(round 1), 그 요청이 끝나면 한 번 더 돌려 결과를 사용자에게 알린다 (더 되풀이하지 않음).
	// 다른 확장의 '끝남' 처리가 늦어지지 않게 따로 돌리고, 그동안 사용자가 새 요청을 보냈으면 pi 에게 보내지 않고 알리기만
	// pending: 고친 뒤에도 실패한 점검의 명령 (뒤 요청이 끝날 때 다시 돌려 알리기만), lastOut: 그 마지막 출력 (같은 결과는 다시 알리지 않음)
	// gen: 요청이 시작될 때마다 1 씩 (점검하는 동안 다른 요청이 시작·끝났는지), queued: 점검 중에 끝난 요청 (지금 점검이 끝나면 이어서)
	const C: {
		t0: number; used: boolean; end: string; round: number; failed: Check[]; busy: boolean; pending: string[]; lastOut: Record<string, string>;
		gen: number; queued: { round: number; t0: number; gen: number; ctx: any } | null;
	} = {
		gen: 0,
		queued: null,
		t0: 0,
		used: false,
		end: "",
		round: 0,
		failed: [],
		busy: false,
		pending: [],
		lastOut: {},
	};
	pi.on("session_start", async (event: any) => {
		if (event?.reason === "reload") return;
		C.pending = [];
		C.lastOut = {};
	});
	pi.on("agent_start", async () => {
		C.gen++;
		if (!C.t0) C.t0 = Date.now();
	});
	pi.on("tool_call", async (event: any) => {
		if (["write", "edit", "bash"].includes(event.toolName)) C.used = true;
	});
	pi.on("agent_end", async (event: any) => {
		const msgs: any[] = event.messages || [];
		const last = msgs[msgs.length - 1];
		C.end = last?.role === "assistant" ? String(last.stopReason || "") : "unfinished";
	});
	const checksOn = () => readJson(userConfigFile()).done_checks !== false;
	/** pi 의 bash 도구와 같은 셸 (릴리스 전 검토: Windows 에서 cmd·PowerShell 로 pi.cmd 를 켜면 PATH 의 bash 가 WSL 의 것일 수 있음) */
	async function checkShell(): Promise<{ shell: string; args: string[]; stdin: boolean }> {
		try {
			const m: any = await import("@earendil-works/pi-coding-agent");
			const c = typeof m.getShellConfig === "function" ? m.getShellConfig() : null;
			if (c?.shell) return { shell: c.shell, args: Array.isArray(c.args) ? c.args : ["-c"], stdin: c.commandTransport === "stdin" };
		} catch {}
		return { shell: "bash", args: ["-c"], stdin: false };
	}
	/** 점검 명령 실행: 노트북(jupyter 모드)이나 PC 의 작업 폴더에서. code null 은 시간 초과·실행 못 함 */
	async function runCheck(c: Check, wd: WorkDir): Promise<CheckResult> {
		if (wd.remote) {
			try {
				const r = await nbRun(`timeout ${c.timeout} bash -c ${shq(c.run)} 2>&1`, wd.cwd);
				return { check: c, code: r.code === 124 ? null : r.code, out: r.code === 124 ? `${r.out}\n(${c.timeout}초가 지나 멈춤)` : r.out };
			} catch (e) {
				return { check: c, code: null, out: `(노트북에서 실행하지 못함: ${(e as Error).message})` };
			}
		}
		const sh = await checkShell();
		return new Promise((ok) => {
			let out = "";
			let done = false;
			const finish = (code: number | null, extra = "") => {
				if (done) return;
				done = true;
				clearTimeout(timer);
				ok({ check: c, code, out: out + extra });
			};
			let ch: ReturnType<typeof spawn>;
			try {
				ch = spawn(sh.shell, sh.stdin ? sh.args : [...sh.args, c.run], { cwd: wd.cwd, windowsHide: true, env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
				if (sh.stdin) ch.stdin?.end(c.run);
			} catch (e) {
				return ok({ check: c, code: null, out: `(실행하지 못함: ${(e as Error).message})` });
			}
			const timer = setTimeout(() => {
				// Windows 에서 kill 은 bash 만 끝내고 그 아래 python 등은 남으므로 프로세스 나무째 끝낸다
				if (process.platform === "win32" && ch.pid) {
					try {
						spawn("taskkill", ["/pid", String(ch.pid), "/T", "/F"], { windowsHide: true });
					} catch {}
				} else ch.kill();
				finish(null, `\n(${c.timeout}초가 지나 멈춤)`);
			}, c.timeout * 1000);
			ch.stdout?.on("data", (d) => (out += d));
			ch.stderr?.on("data", (d) => (out += d));
			ch.on("error", (e) => finish(null, `\n(실행하지 못함: ${e.message})`));
			ch.on("close", (code) => finish(code));
		});
	}
	/** 이 프로젝트에서 이 점검 명령을 돌려도 되는지 (프로젝트·명령마다 한 번 묻고 doc-rules.json 의 checks 에 남김) */
	async function allowed(c: Check, wd: WorkDir, files: string[], ctx: any): Promise<boolean> {
		const key = `${wd.remote ? "nb:" : ""}${wd.cwd}`;
		const id = createHash("sha256").update(c.run).digest("hex").slice(0, 16);
		const st = readJson(stateFile());
		const all = st.checks && typeof st.checks === "object" ? st.checks : {};
		const known = all[key] && typeof all[key] === "object" ? all[key] : {};
		if (known[id] === "yes" || known[id] === "no") return known[id] === "yes";
		const shownFiles = files.slice(0, 5).join(", ") + (files.length > 5 ? ` 외 ${files.length - 5}개` : "");
		// 고르기 창: 예·아니요는 이 프로젝트에 남기고, 이번만 건너뛰기·Esc 는 남기지 않음 (릴리스 전 검토: 확인 창은 Esc 도 '아니요' 로 영구 저장됐음)
		const pick = await ctx.ui.select(
			`완료 점검: 이 프로젝트의 ${CHECKS_FILE} 에 요청이 끝날 때 돌릴 점검이 있습니다.\n\n  ${c.name}\n  명령: ${c.run}\n  (${wd.remote ? "노트북" : "PC"} ${wd.cwd} 에서)\n\n` +
				`이번 요청에서 바뀐 파일: ${shownFiles}\n실패하면 결과를 pi 에게 한 번 돌려줍니다. (명령이 바뀌면 다시 묻습니다. 끄기: /hooks off checks)\n\n이 명령을 이 프로젝트에서 요청이 끝날 때마다 실행할까요?`,
			[CONSENT.yes, CONSENT.no, CONSENT.skip],
		);
		const yes = pick === CONSENT.yes;
		if (pick !== CONSENT.yes && pick !== CONSENT.no) return false;
		try {
			writeFileSync(stateFile(), `${JSON.stringify({ ...st, checks: { ...all, [key]: { ...known, [id]: yes ? "yes" : "no" } } }, null, 2)}\n`);
		} catch {}
		return yes;
	}
	/** 이 작업 폴더에서 '아니요' 로 남긴 점검 동의를 지움 (/hooks on checks) */
	function clearCheckNo(wd: WorkDir): number {
		const key = `${wd.remote ? "nb:" : ""}${wd.cwd}`;
		const st = readJson(stateFile());
		const known = st.checks?.[key];
		if (!known || typeof known !== "object") return 0;
		const keep = Object.fromEntries(Object.entries(known).filter(([, v]) => v !== "no"));
		const n = Object.keys(known).length - Object.keys(keep).length;
		if (n) {
			try {
				writeFileSync(stateFile(), `${JSON.stringify({ ...st, checks: { ...st.checks, [key]: keep } }, null, 2)}\n`);
			} catch {}
		}
		return n;
	}
	async function readChecks(wd: WorkDir): Promise<Check[]> {
		if (wd.remote) {
			const r = (globalThis as any).__piRemoteFs;
			if (!r) return [];
			try {
				return parseChecks(await r.read(posix.join(wd.cwd, CHECKS_FILE)));
			} catch {
				return [];
			}
		}
		try {
			return parseChecks(readFileSync(join(wd.cwd, CHECKS_FILE), "utf8"));
		} catch {
			return [];
		}
	}
	async function doneCheck(ctx: any, round: number, t0: number, gen = C.gen) {
		const wd = workDir(ctx);
		const status = (s?: string) => {
			try {
				ctx.ui.setStatus("checks", s && fg(ctx, "accent", s));
			} catch {}
		};
		let due: Check[] = [];
		let left: Check[] = []; // 앞 요청에서 실패한 채 남은 점검: 이 요청에서 파일이 바뀌지 않았어도 다시 돌려 알리기만 (pi 에게 보내지 않음)
		if (round === 1) due = C.failed;
		else {
			const checks = await readChecks(wd);
			if (!checks.length) return;
			const roots = globRoots(checks.flatMap((c) => c.when));
			let changed: string[] = [];
			const sec = (Date.now() - t0) / 1000;
			try {
				changed = wd.remote
					? (await nbRun(findChangedCmd(roots, sec), wd.cwd)).out.split(/\r?\n/).map((l) => l.trim().replace(/^\.\//, "")).filter(Boolean)
					: localChanged(wd.cwd, roots, t0);
			} catch {
				return; // 노트북에 닿지 않음: 이번에는 보지 않음
			}
			for (const c of checks) {
				const files = changed.filter((f) => matchesAny(f, c.when));
				if (files.length && (await allowed(c, wd, files, ctx))) due.push(c);
			}
			left = checks.filter((c) => C.pending.includes(c.run) && !due.includes(c));
		}
		if (!due.length && !left.length) return;
		const results: CheckResult[] = [];
		for (const c of [...due, ...left]) {
			status(`완료 점검 중: ${c.name}`);
			results.push(await runCheck(c, wd));
		}
		status(undefined);
		const names = (rs: CheckResult[]) => rs.map((r) => r.check.name).join(", ");
		const lines = (r: CheckResult) => tail(r.out, 600).split("\n").slice(-6).join("\n");
		const stillFails = (rs: CheckResult[], why = "") =>
			ctx.ui.notify(`완료 점검이 아직 실패합니다: ${names(rs)}${why}\n${rs.map(lines).join("\n")}\n(pi 에게 다시 보내지 않습니다. 끄기: /hooks off checks)`, "warning");
		C.pending = C.pending.filter((run) => !results.some((r) => r.check.run === run && r.code === 0));
		const keep = (rs: CheckResult[]) => {
			for (const r of rs) {
				if (!C.pending.includes(r.check.run)) C.pending.push(r.check.run);
				C.lastOut[r.check.run] = r.out;
			}
		};
		// 남은 점검: 통과하면 알리고, 아직 실패면 결과가 달라졌을 때만 알림
		const lr = results.filter((r) => left.includes(r.check));
		if (lr.some((r) => r.code === 0)) ctx.ui.notify(`완료 점검 통과: ${names(lr.filter((r) => r.code === 0))} (앞 요청에서 실패했던 점검)`, "info");
		const lf = lr.filter((r) => r.code !== 0);
		const changedOut = lf.filter((r) => C.lastOut[r.check.run] !== r.out);
		keep(lf);
		if (changedOut.length) stillFails(changedOut, " (앞 요청에서 실패했던 점검)");
		const main = results.filter((r) => due.includes(r.check));
		const failed = main.filter((r) => r.code !== 0);
		if (!main.length) return;
		if (!failed.length) return ctx.ui.notify(`완료 점검 통과: ${names(main)}${round === 1 ? " (고친 뒤 다시 확인)" : ""}`, "info");
		if (round === 1) {
			keep(failed);
			return stillFails(failed);
		}
		if ((typeof ctx.isIdle === "function" && !ctx.isIdle()) || C.t0 || C.gen !== gen) {
			// 점검하는 동안 사용자가 새 요청을 보냄 (그 요청이 벌써 끝났어도: 지금 보내면 지난 요청에 대한 부탁이 됨)
			keep(failed);
			return ctx.ui.notify(`완료 점검 실패: ${names(failed)} (새 요청 중이라 pi 에게 보내지 않았습니다)\n${failed.map(lines).join("\n")}`, "warning");
		}
		C.round = 1;
		C.failed = failed.map((r) => r.check);
		ctx.ui.notify(`완료 점검 실패: ${names(failed)} → pi 에게 고치고 다시 확인하게 합니다 (한 번만)`, "warning");
		pi.sendUserMessage(userAsk(followUpText(failed), CHECK_ASK));
	}
	pi.on("agent_settled", async (_event: unknown, ctx: any) => {
		const { t0, used, end } = C;
		const round = C.round;
		C.t0 = 0;
		C.used = false;
		C.end = "";
		C.round = 0;
		// 끝까지 쓴 답으로 끝난 요청만 (Esc·오류·거부로 멈춘 요청은 사용자가 정함). 계획 모드·리뷰(/review: 고칠지는 리뷰 뒤에 물음)·화면이 없는 실행은 하지 않음
		if (end !== "stop" || !ctx?.hasUI || (globalThis as any).__piMode === "plan" || (globalThis as any).__piReview || !checksOn()) return;
		if (round === 0 && (!used || !t0)) return;
		// 앞 요청의 점검이 아직 돌면 버리지 않고 그 뒤에 (릴리스 전 검토: 점검 중에 끝난 요청의 점검이 사라졌음)
		if (C.busy) return void (C.queued = { round, t0, gen: C.gen, ctx });
		startCheck(ctx, round, t0, C.gen);
	});
	function startCheck(ctx: any, round: number, t0: number, gen: number) {
		C.busy = true;
		setTimeout(async () => {
			try {
				await doneCheck(ctx, round, t0, gen);
			} catch {
			} finally {
				C.busy = false;
				const q = C.queued;
				C.queued = null;
				if (q) startCheck(q.ctx, q.round, q.t0, q.gen);
			}
		}, 0);
	}

	// ── /hooks, 위험 명령 확인 경고 ───────────────────────────────────────────
	const fg = (ctx: any, c: string, s: string) => (ctx?.ui?.theme?.fg ? ctx.ui.theme.fg(c, s) : s);
	function showGuard(ctx: any) {
		if (!ctx?.hasUI) return;
		const g = guardState();
		try {
			ctx.ui.setStatus("hooks", g.on ? undefined : fg(ctx, "warning", "위험 명령 확인 꺼짐 (/hooks)"));
		} catch {}
		if (!g.on && !S.warned) {
			S.warned = true;
			ctx.ui.notify(`위험 명령 확인이 꺼져 있습니다 (${g.why}). git push, 폴더 지우기 같은 작업도 묻지 않고 실행됩니다.\n켜기: /hooks on guard`, "warning");
		}
	}
	const listText = () => {
		const g = guardState();
		const d = docCfg();
		const mine = myHooks();
		return [
			"키트 훅 (켜기·끄기: /hooks on|off <이름>)",
			`  guard  ${g.on ? "켜짐" : `꺼짐 (${g.why})`}  위험 명령 확인: git push·폴더 지우기·kubectl delete 등을 실행 전에 묻기. 끄면 GitLab 반영도 묻지 않음`,
			`  docs   ${d.on ? "켜짐" : "꺼짐"}  문서 규칙: 새 문서는 ${d.index} 에 링크, 한 요청에 ${d.limit}개를 넘으면 묻기, 이력은 HISTORY.md 하나에`,
			`  checks ${checksOn() ? "켜짐" : "꺼짐"}  완료 점검: 프로젝트의 ${CHECKS_FILE} 명령을 요청이 끝날 때 돌려, 실패하면 pi 에게 한 번 돌려줌`,
			`  rules  ${rulesOn() ? "켜짐" : "꺼짐"}  팀 규칙: .github/copilot-instructions.md·.cursor/rules·.pi/rules 등을 지침과 해당 파일·명령의 도구 결과에 (/rules 로 보기)`,
			`  syntax ${syntaxOn() ? "켜짐" : "꺼짐"}  문법 확인: write·edit 로 고친 .py·.json·.ipynb·.yaml 이 깨졌으면 그 결과에 알림`,
			`내 훅 (${extDir().replace(/\\/g, "/")}): ${mine.length ? mine.map((h) => `${h.name} ${h.on ? "켜짐" : "꺼짐"}`).join(", ") : "없음"}`,
			"  /hooks off mine: 내 훅만 모두 끄기 (키트 훅은 그대로)  ·  /hooks on mine: 다시 켜기",
		].join("\n");
	};
	pi.registerCommand("hooks", {
		description: "훅 목록과 켜고 끄기: /hooks, /hooks off|on <guard|docs|checks|rules|syntax|내 훅 이름|mine> (mine: 내 훅만 모두, 위험 명령 확인은 그대로)",
		handler: async (args: string, ctx: any) => {
			const [verb, ...rest] = (args || "").trim().split(/\s+/).filter(Boolean);
			const name = rest.join(" ");
			if (!verb) return ctx.ui.notify(listText(), "info");
			if ((verb !== "on" && verb !== "off") || !name) return ctx.ui.notify("사용법: /hooks, /hooks off <guard|docs|checks|rules|syntax|이름|mine>, /hooks on <…>", "warning");
			const on = verb === "on";
			if (name === "guard") {
				if (!on) {
					const ok = ctx.hasUI && (await ctx.ui.confirm("위험 명령 확인을 끌까요?", "끄면 git push(GitLab 반영), 폴더 지우기, kubectl delete 같은 작업도 묻지 않고 실행됩니다.\n내 훅만 끄려면 /hooks off mine 을 쓰세요."));
					if (!ok) return;
					saveSetting("guard", false);
					showGuard(ctx);
					return ctx.ui.notify("위험 명령 확인을 껐습니다. 켜기: /hooks on guard", "warning");
				}
				saveSetting("guard", undefined);
				const off = join(extDir(), "guard.ts.off");
				if (!existsSync(join(extDir(), "guard.ts")) && existsSync(off)) {
					renameSync(off, join(extDir(), "guard.ts"));
					ctx.ui.notify("위험 명령 확인을 켭니다 (guard.ts.off -> guard.ts, 다시 불러옴)", "info");
					return ctx.reload();
				}
				S.warned = false;
				showGuard(ctx);
				return ctx.ui.notify(guardState().on ? "위험 명령 확인이 켜져 있습니다" : `위험 명령 확인을 켜지 못했습니다 (${guardState().why}). 키트를 다시 설치하거나 업데이트하세요`, "info");
			}
			if (name === "docs") {
				saveSetting("doc_rules", on ? undefined : false);
				return ctx.ui.notify(`문서 규칙을 ${on ? "켰습니다" : "껐습니다"} (다음 요청부터)`, "info");
			}
			if (name === "checks") {
				saveSetting("done_checks", on ? undefined : false);
				const n = on ? clearCheckNo(workDir(ctx)) : 0;
				return ctx.ui.notify(`완료 점검을 ${on ? "켰습니다" : "껐습니다"} (다음 요청부터)${n ? `. 이 프로젝트에서 '아니요' 로 답한 점검 ${n}개는 다음에 다시 묻습니다` : ""}`, "info");
			}
			if (name === "rules") {
				saveSetting("team_rules", on ? undefined : false);
				return ctx.ui.notify(`팀 규칙을 ${on ? "켰습니다" : "껐습니다"} (다음 요청부터. 읽은 규칙이 있으면 지침이 바뀝니다)`, "info");
			}
			if (name === "syntax") {
				saveSetting("syntax_check", on ? undefined : false);
				return ctx.ui.notify(`문법 확인을 ${on ? "켰습니다" : "껐습니다"} (다음 도구 결과부터)`, "info");
			}
			const mine = myHooks();
			const pick = name === "mine" ? mine : mine.filter((h) => [h.name, h.name.replace(/\.(ts|js)$/, "")].includes(name));
			if (!pick.length) {
				const kit = KIT_EXT.find((k) => [k, k.replace(/\.ts$/, "")].includes(name));
				return ctx.ui.notify(
					kit
						? `${kit} 은(는) 키트 확장이라 여기서 끄지 않습니다 (위키는 /wiki off, 작업 기록은 /recall off, 작업 모드는 /mode)`
						: `'${name}' 훅이 없습니다. /hooks 로 목록을 보세요`,
					"warning",
				);
			}
			const changed = pick.filter((h) => switchHook(h, on)).map((h) => h.name);
			if (!changed.length) return ctx.ui.notify(`이미 ${on ? "켜져" : "꺼져"} 있습니다`, "info");
			ctx.ui.notify(`내 훅 ${on ? "켬" : "끔"}: ${changed.join(", ")} (다시 불러옴. 위험 명령 확인·문서 규칙은 그대로)`, "info");
			return ctx.reload();
		},
	});
}
