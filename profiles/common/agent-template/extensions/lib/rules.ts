/**
 * 팀 규칙: 다른 코딩 도구의 지침·규칙 파일과 이 키트의 .pi/rules (rules.ts 와 jupyter.ts 가 함께 씀).
 * 2026-10-27: oh-my-pi(can1357/oh-my-pi, MIT)가 다른 도구의 파일을 읽는 방식과 도구 인자에 걸리는 규칙(TTSR)을 읽고 이 키트에 맞게 새로 씀.
 * - 늘 넣는 지침 (지침 파일 목록에 더함): .github/copilot-instructions.md, .claude/CLAUDE.md, AGENTS.md 옆의 CLAUDE.md (pi 는 AGENTS.md 만 읽음),
 *   .cursorrules, applyTo 가 모든 파일인 .github/instructions/*.instructions.md, alwaysApply 인 .cursor/rules/*.mdc, always: true 인 .pi/rules/*.md
 * - 파일·명령에 걸리는 규칙 (도구 결과에 붙임): applyTo·globs 가 있는 것, condition(정규식)이 있는 .pi/rules
 * - 목록만 (필요할 때 read 로): 설명만 있는 .cursor/rules·.pi/rules, applyTo 가 없는 .instructions.md
 * 지침은 세션마다 한 번 찾아 그대로 쓴다 (지침이 바뀌면 Copilot 이 새 대화를 열기 때문). 규칙은 도구 결과에 붙이므로 지침을 바꾸지 않는다.
 * 이 폴더(lib)에는 index.ts 가 없으므로 pi 가 확장으로 불러오지 않는다.
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, posix } from "node:path";

// path: 절대 경로 (/ 로. PC 는 C:/..., 노트북은 /home/...). base: globs 의 기준 폴더를 정해 줄 때 ("" 는 그때의 작업 폴더: 내 규칙)
export type RuleSource = { path: string; text: string; base?: string };
export type TeamRule = {
	name: string;
	path: string; // 규칙 파일
	base: string; // globs 의 기준 폴더 (.github·.cursor·.pi·.claude 가 있는 폴더, "" 는 작업 폴더)
	kind: "always" | "match" | "list";
	body: string;
	description: string;
	globs: string[];
	condition: RegExp[];
	tools: string[]; // 걸리는 도구
};

/** write·edit·bash 로 새로 들어가는 글 (edit 는 바꿀 글만. hooks.ts 의 그 순간 안내와 함께 씀) */
export function writtenText(toolName: string, input: any): string {
	if (toolName === "write") return typeof input?.content === "string" ? input.content : "";
	if (toolName === "bash") return typeof input?.command === "string" ? input.command : "";
	if (toolName !== "edit") return "";
	const edits: any[] = Array.isArray(input?.edits) ? input.edits : input?.newText !== undefined ? [{ newText: input.newText }] : [];
	return edits.map((e) => String(e?.newText ?? "")).join("\n");
}

export const RULE_MAX = 8000; // 늘 넣는 지침 한 파일
export const RULE_TOTAL = 16000; // 늘 넣는 지침 모두
export const NOTE_MAX = 1500; // 도구 결과에 붙이는 규칙 하나

const noBom = (s: string) => s.replace(/^\uFEFF/, "");
/** \uB530\uC634\uD45C \uB5BC\uAE30. YAML \uCC98\uB7FC "\u2026" \uC548\uC758 \\ \uC640 \" \uB294 \uD480\uACE0 '\u2026' \uC548\uC758 '' \uB294 ' \uB85C (\uC815\uADDC\uC2DD condition: "(?i)drop\\s+table") */
const unquote = (v: string) => {
	const t = v.trim();
	const m = t.match(/^(["'])([\s\S]*)\1$/);
	if (!m) return t;
	return (m[1] === '"' ? m[2].replace(/\\(["\\])/g, "$1") : m[2].replace(/''/g, "'")).trim();
};

/** [a, "b,c"] 의 안쪽을 쉼표로 나눔 (따옴표 안의 쉼표는 그대로: 정규식 {1,3} 등) */
function splitList(s: string): string[] {
	const out: string[] = [];
	let cur = "";
	let q = "";
	for (const c of s) {
		if (q) {
			cur += c;
			if (c === q && !cur.endsWith(`\\${q}`)) q = "";
		} else if (c === '"' || c === "'") {
			q = c;
			cur += c;
		} else if (c === ",") {
			out.push(cur);
			cur = "";
		} else cur += c;
	}
	out.push(cur);
	return out;
}
/** 머리말(--- … ---): key: value, key: [a, b], 다음 줄들의 '- 값' 목록. 머리말이 없으면 meta 는 비어 있음 */
export function splitFrontmatter(text: string): { meta: Record<string, string | string[]>; body: string } {
	const t = noBom(text);
	const m = t.match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
	if (!m) return { meta: {}, body: t };
	const meta: Record<string, string | string[]> = {};
	const lines = m[1].split(/\r?\n/);
	for (let i = 0; i < lines.length; i++) {
		const kv = lines[i].match(/^([A-Za-z][\w-]*)\s*:\s*(.*)$/);
		if (!kv) continue;
		const v = kv[2].trim();
		if (v === "" || v === "|" || v === ">") {
			const items: string[] = [];
			const more: string[] = [];
			for (let j = i + 1; j < lines.length && /^\s+\S|^\s*-\s/.test(lines[j]); j++, i++) {
				const it = lines[j].match(/^\s*-\s+(.*)$/);
				if (it) items.push(unquote(it[1]));
				else more.push(lines[j].trim());
			}
			meta[kv[1]] = items.length ? items : more.join(v === "|" ? "\n" : " ");
		} else if (/^\[.*\]$/.test(v)) meta[kv[1]] = splitList(v.slice(1, -1)).map(unquote).filter(Boolean);
		else meta[kv[1]] = unquote(v);
	}
	return { meta, body: t.slice(m[0].length) };
}

const list = (v: string | string[] | undefined): string[] =>
	(Array.isArray(v) ? v : String(v ?? "").split(",")).map((s) => s.trim()).filter(Boolean);
const truthy = (v: string | string[] | undefined) => /^(true|yes|1)$/i.test(String(v ?? "").trim());

/** 파일 앞머리의 '너는 …다' 류 역할 줄 (IDE 용 Copilot 지침에 흔함: pi 의 역할과 부딪힘). 첫 내용 줄들만 본다 */
const IDENTITY_RE =
	/^\s*(?:you are|you're|당신은|너는)\s[^\n]{0,80}(?:assistant|engineer|developer|expert|agent|programmer|copilot|\bai\b|bot|전문가|개발자|어시스턴트|비서|도우미)[^\n]*$/i;
export function stripIdentity(body: string): string {
	const lines = body.split(/\r?\n/);
	let i = 0;
	while (i < lines.length && (lines[i].trim() === "" || /^#{1,3}\s/.test(lines[i]) || IDENTITY_RE.test(lines[i]))) {
		if (IDENTITY_RE.test(lines[i])) lines[i] = "";
		i++;
	}
	return lines.join("\n").replace(/^\s+/, "");
}

/** 'C:/a/.github/instructions/x.md' -> 규칙의 기준 폴더 'C:/a' (.github·.cursor·.pi·.claude 가 있는 폴더, 아니면 파일의 폴더) */
export function ruleBase(path: string): string {
	const p = path.replace(/\\/g, "/");
	const m = p.match(/^(.*?)\/\.(github|cursor|pi|claude)\//);
	return m ? m[1] || "/" : posix.dirname(p);
}

/** 규칙 이름: 머리말의 name, 없으면 파일 이름에서 .instructions.md·.mdc·.md 를 뗀 것 */
const ruleName = (path: string, meta: Record<string, string | string[]>) =>
	String(meta.name ?? "").trim() || posix.basename(path).replace(/\.instructions\.md$/i, "").replace(/\.(mdc|md)$/i, "");

/** (?i)로 시작하면 대소문자 무시. 잘못된 정규식은 뺌 */
function toRegExps(v: string | string[] | undefined): RegExp[] {
	const out: RegExp[] = [];
	for (const s of Array.isArray(v) ? v : v ? [v] : []) {
		const src = String(s);
		try {
			out.push(src.startsWith("(?i)") ? new RegExp(src.slice(4), "i") : new RegExp(src));
		} catch {}
	}
	return out;
}

const ALL_FILES = new Set(["*", "**", "**/*"]);
/** 규칙 파일 하나를 읽어 분류한다. 내용이 비면 null */
export function toRule(src: RuleSource): TeamRule | null {
	const path = src.path.replace(/\\/g, "/");
	const base = src.base ?? ruleBase(path);
	const { meta, body: raw } = splitFrontmatter(src.text);
	const body = stripIdentity(raw).trim();
	if (!body) return null;
	const name = ruleName(path, meta);
	const firstLine = (body.split(/\r?\n/).find((l) => l.trim()) || "").replace(/^#+\s*/, "").slice(0, 120);
	const description = String(meta.description ?? "").trim() || firstLine;
	const rule: TeamRule = { name, path, base, kind: "list", body, description, globs: [], condition: [], tools: [] };
	const always = () => Object.assign(rule, { kind: "always" as const });
	if (/\/(\.github\/copilot-instructions\.md|\.claude\/CLAUDE\.md|CLAUDE\.md|\.cursorrules)$/i.test(path) && !/\/\.(cursor|pi)\//.test(path)) return always();
	if (/\/\.github\/instructions\//.test(path)) {
		const globs = list(meta.applyTo);
		if (globs.some((g) => ALL_FILES.has(g))) return always();
		if (globs.length) return Object.assign(rule, { kind: "match" as const, globs, tools: ["read", "write", "edit"] });
		return rule;
	}
	if (/\/\.cursor\/rules\//.test(path)) {
		if (truthy(meta.alwaysApply)) return always();
		const globs = list(meta.globs);
		if (globs.length) return Object.assign(rule, { kind: "match" as const, globs, tools: ["read", "write", "edit"] });
		return rule;
	}
	// .pi/rules/*.md: always, globs, condition(정규식), tools (read·write·edit·bash)
	if (truthy(meta.always)) return always();
	const globs = list(meta.globs);
	const condition = toRegExps(meta.condition);
	if (globs.length || condition.length) {
		const tools = list(meta.tools).map((t) => t.toLowerCase());
		return Object.assign(rule, {
			kind: "match" as const,
			globs,
			condition,
			tools: tools.length ? tools : condition.length ? ["write", "edit", "bash"] : ["read", "write", "edit"],
		});
	}
	return rule;
}

/** glob -> 정규식 (**, *, ?, {a,b}). 앞의 ./ 와 / 는 뗌 */
export function globRe(glob: string): RegExp {
	const g = glob.trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\//, "");
	let re = "";
	for (let i = 0; i < g.length; i++) {
		const c = g[i];
		if (c === "*" && g[i + 1] === "*") {
			if (g[i + 2] === "/") {
				re += "(?:.*/)?";
				i += 2;
			} else {
				re += ".*";
				i++;
			}
		} else if (c === "*") re += "[^/]*";
		else if (c === "?") re += "[^/]";
		else if (c === "{") {
			const k = g.indexOf("}", i);
			if (k < 0) re += "\\{";
			else {
				re += `(?:${g.slice(i + 1, k).split(",").map((s) => s.replace(/[.+^$()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*")).join("|")})`;
				i = k;
			}
		} else re += c.replace(/[.+^$()|[\]\\]/g, "\\$&");
	}
	return new RegExp(`^${re}$`, "i");
}
/** 기준 폴더에 대한 상대 경로가 globs 하나에 맞는지 (/ 없는 glob 은 파일 이름에도 맞춰 봄) */
export function globsMatch(globs: string[], rel: string): boolean {
	const name = posix.basename(rel);
	return globs.some((g) => {
		const re = globRe(g);
		return re.test(rel) || (!g.includes("/") && re.test(name));
	});
}

/** 이 도구 호출에 걸리는 규칙인지. rel: 규칙 기준 폴더에 대한 상대 경로 (없으면 null), text: 쓴 내용이나 명령 */
export function ruleMatches(rule: TeamRule, toolName: string, rel: string | null, text: string): boolean {
	if (rule.kind !== "match" || !rule.tools.includes(toolName)) return false;
	if (rule.globs.length && !(rel && globsMatch(rule.globs, rel))) return false;
	if (rule.condition.length) {
		if (toolName === "read" || !text) return false; // 읽기는 내용이 아니라 경로만 (oh-my-pi 와 같게)
		if (!rule.condition.some((re) => re.test(text))) return false;
	}
	return true;
}

const cap = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}\n… (줄임: ${s.length}자 중 ${n}자)` : s);
/** 도구 결과에 붙일 글 */
export function ruleNote(rule: TeamRule, rel: string | null): string {
	const where = shortPath(rule);
	const why = rule.condition.length
		? "방금 내용이 이 규칙의 조건에 맞습니다. 도구는 이미 실행됐으니 규칙에 어긋나면 다음 호출에서 고치고, 규칙이 허용하는 경우면 그대로 두세요"
		: `${rel ? `이 파일(${rel})` : "이 작업"}에 해당하는 팀 규칙입니다. 이번 일에 맞게 따르세요`;
	// 2026-10-27 실사용 시험: 붙인 글이 규칙 전문인데도 규칙 파일을 다시 찾아 읽음 (도구 호출 2번) -> 전문이면 그렇다고
	const whole = rule.body.length <= NOTE_MAX ? ". 아래가 규칙 전문이라 규칙 파일은 따로 읽지 않아도 됩니다" : `. 아래는 앞부분이고 전문은 ${where}`;
	return `(팀 규칙 «${rule.name}» · ${where}: ${why}${whole})\n${cap(rule.body, NOTE_MAX)}`;
}

const paras = (s: string) =>
	s
		.split(/\r?\n\s*\r?\n/)
		.map((p) => p.replace(/\s+/g, " ").trim())
		.filter(Boolean);
/** 늘 넣는 지침 -> 지침 파일 목록에 더할 것. 이미 있는 경로·내용(문단이 모두 이미 있는 글)은 빼고, 크기 상한 */
export function contextFromRules(
	rules: TeamRule[],
	existing: { path: string; content: string }[],
): { files: { path: string; content: string }[]; skipped: { path: string; why: string }[] } {
	const files: { path: string; content: string }[] = [];
	const skipped: { path: string; why: string }[] = [];
	const have = existing.map((f) => ({ path: f.path.replace(/\\/g, "/").toLowerCase(), paras: new Set(paras(f.content)) }));
	let total = 0;
	for (const r of rules.filter((x) => x.kind === "always")) {
		const p = r.path.toLowerCase();
		if (have.some((h) => h.path === p)) continue;
		const ps = paras(r.body);
		if (ps.length && have.some((h) => ps.every((x) => h.paras.has(x)))) {
			skipped.push({ path: r.path, why: "이미 같은 내용이 있음" });
			continue;
		}
		const content = cap(r.body, RULE_MAX);
		if (total + content.length > RULE_TOTAL) {
			skipped.push({ path: r.path, why: `지침에 더하는 글이 ${RULE_TOTAL}자를 넘음` });
			continue;
		}
		total += content.length;
		files.push({ path: r.path, content });
		have.push({ path: p, paras: new Set(ps) });
	}
	return { files, skipped };
}

/** 지침의 팀 규칙 부분 (o.sections.team_rules): 이미 넣은 지침 파일은 다시 읽지 말라는 줄과, 목록만 있는 규칙 */
export function teamRulesSection(loaded: string[], listed: TeamRule[]): string | undefined {
	const out: string[] = [];
	if (loaded.length) out.push(`다른 코딩 도구의 지침 파일(${loaded.join(", ")})은 위 지침에 이미 넣었습니다. 다시 찾거나 읽지 마세요.`);
	if (listed.length) {
		out.push("아래 팀 규칙은 해당하는 일을 할 때 먼저 read 로 읽으세요:");
		for (const r of listed) out.push(`- «${r.name}»: ${r.description} — ${r.path}`);
	}
	return out.length ? out.join("\n") : undefined;
}

/** 규칙 파일을 찾는 곳 (한 폴더 기준): 늘 보는 파일과, 아래를 찾는 폴더 */
export const RULE_FILES = [".github/copilot-instructions.md", ".cursorrules", ".claude/CLAUDE.md"];
/** [폴더, 파일 이름, 찾는 깊이 (find -maxdepth: 1 은 그 폴더 바로 아래만), find 의 이름 조건] (PC 찾기와 노트북 찾기 명령이 함께 씀) */
export const RULE_DIRS: [string, RegExp, number, string][] = [
	[".github/instructions", /\.instructions\.md$/i, 4, '-name "*.instructions.md"'],
	[".cursor/rules", /\.(mdc|md)$/i, 2, '\\( -name "*.mdc" -o -name "*.md" \\)'],
	[".pi/rules", /\.md$/i, 2, '-name "*.md"'],
];
/** 노트북에서 돌리는 찾기 명령: 작업 폴더부터 위로 git 저장소 맨 위까지 (노트북 홈과 / 는 보지 않음: 다른 도구의 개인 설정).
 *  '@@RULE <경로>' 줄 다음에 그 파일 앞부분 (지침에 넣는 것은 RULE_MAX 자까지라 그만큼만 보냄: 찾기가 5초 안에 끝나게) */
export const RULE_SCAN =
	'd="$PWD"; while :; do { [ "$d" = "$HOME" ] || [ "$d" = / ]; } && break; for f in ' +
	RULE_FILES.map((f) => `"$d/${f}"`).join(" ") +
	'; do [ -f "$f" ] && echo "$f"; done; ' +
	'{ [ -f "$d/AGENTS.md" ] || [ -f "$d/AGENTS.override.md" ]; } && [ -f "$d/CLAUDE.md" ] && echo "$d/CLAUDE.md"; ' +
	RULE_DIRS.map(([sub, , depth, name]) => `[ -d "$d/${sub}" ] && find "$d/${sub}" -maxdepth ${depth} -type f ${name} 2>/dev/null | sort; `).join("") +
	'[ -e "$d/.git" ] && break; d=$(dirname "$d"); done | ' +
	"awk '!s[$0]++' | head -60 | " +
	`while IFS= read -r f; do echo "@@RULE $f"; head -c ${RULE_MAX * 3} "$f"; echo; done`;
/** 찾기 명령의 출력 -> 규칙 파일들 (@@SKILL 부분은 건너뜀: 스킬 찾기와 한 명령으로 돌림) */
export function parseRuleScan(out: string): RuleSource[] {
	const files: RuleSource[] = [];
	for (const chunk of out.split(/^@@(?=SKILL |RULE )/m).slice(1)) {
		if (!chunk.startsWith("RULE ")) continue;
		const nl = chunk.indexOf("\n");
		const path = (nl < 0 ? chunk.slice(5) : chunk.slice(5, nl)).trim();
		if (path) files.push({ path, text: nl < 0 ? "" : chunk.slice(nl + 1).replace(/\n$/, "") });
	}
	return files;
}

/** 규칙 파일의 짧은 이름 (기준 폴더에 대한 상대 경로: .github/copilot-instructions.md 등. 내 규칙은 ~/.pi/agent/rules/...) */
export const shortPath = (r: TeamRule) => {
	if (r.base && r.path.startsWith(`${r.base}/`)) return r.path.slice(r.base.length + 1);
	const h = homedir().replace(/\\/g, "/");
	return r.path.toLowerCase().startsWith(`${h.toLowerCase()}/`) ? `~${r.path.slice(h.length)}` : r.path;
};

/** 이번 세션의 팀 규칙 (rules.ts 의 도구 결과 처리와 /rules 가 읽음) */
export type RulesState = { key: string; all: TeamRule[]; match: TeamRule[]; loaded: string[]; skipped: { path: string; why: string }[] };
/** 지침에 팀 규칙 넣기 (rules.ts: PC 작업 폴더, jupyter.ts: 노트북 작업 폴더). 늘 넣는 지침은 지침 파일 목록에, 목록만 있는 규칙은 team_rules 부분에.
 *  파일·명령에 걸리는 규칙은 (globalThis).__piTeamRules 에 두어 도구 결과에 붙인다 */
export function applyRules(o: any, rules: TeamRule[], key: string): RulesState {
	const existing = Array.isArray(o?.contextFiles) ? o.contextFiles : [];
	const { files, skipped } = contextFromRules(rules, existing);
	if (files.length && Array.isArray(o?.contextFiles)) o.contextFiles.push(...files);
	const loaded = rules.filter((r) => files.some((f) => f.path === r.path));
	const section = teamRulesSection(loaded.map(shortPath), rules.filter((r) => r.kind === "list"));
	if (section && o?.sections) o.sections.team_rules = section;
	const st: RulesState = { key, all: rules, match: rules.filter((r) => r.kind === "match"), loaded: loaded.map((r) => r.path), skipped };
	(globalThis as any).__piTeamRules = st;
	return st;
}
/** 처음 보거나 바뀐 규칙 파일이 있을 때 한 번 알릴 글 (seen: 지난번 알린 목록의 지문, 프로젝트마다) */
export function rulesNotice(st: RulesState): string | null {
	if (!st.all.length) return null;
	const names = st.all.map(shortPath);
	const shown = names.slice(0, 3).join(", ") + (names.length > 3 ? ` 외 ${names.length - 3}개` : "");
	const matchN = st.match.length;
	return `다른 코딩 도구의 지침·팀 규칙을 읽습니다: ${shown}${matchN ? ` (${matchN}개는 해당 파일·명령을 다룰 때만)` : ""}. 보기: /rules, 끄기: /hooks off rules`;
}
export const rulesPrint = (st: RulesState) => st.all.map((r) => `${r.kind}:${r.path}`).sort().join("\n");

const agentDir = () => process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
const readJson = (f: string): any => {
	try {
		return JSON.parse(noBom(readFileSync(f, "utf8"))) || {};
	} catch {
		return {};
	}
};
/** 내 규칙: PC 의 ~/.pi/agent/rules/*.md (아래 폴더 한 단계까지). 어느 프로젝트에서나 쓰므로 globs 는 그때의 작업 폴더 기준 */
export function myRuleSources(dir = join(agentDir(), "rules")): RuleSource[] {
	const out: RuleSource[] = [];
	const walk = (d: string, depth: number) => {
		let names: string[] = [];
		try {
			names = readdirSync(d).sort();
		} catch {
			return;
		}
		for (const n of names) {
			const p = join(d, n);
			try {
				const st = statSync(p);
				if (st.isDirectory()) {
					if (depth > 0) walk(p, depth - 1);
				} else if (/\.md$/i.test(n) && st.size <= 200_000) out.push({ path: p.replace(/\\/g, "/"), text: readFileSync(p, "utf8"), base: "" });
			} catch {}
		}
	};
	walk(dir, 1);
	return out;
}
/** 내 설정 파일의 "team_rules": false 면 끔 (/hooks off rules) */
export const rulesOn = () => readJson(process.env.PI_COPILOT_USER_CONFIG || join(agentDir(), "bridge.json")).team_rules !== false;
/** 처음 보거나 바뀐 규칙 파일이면 한 번 알림 (프로젝트마다 목록의 지문을 ~/.pi/agent/rules-seen.json 에) */
export function noticeOnce(ctx: any, st: RulesState, file = join(agentDir(), "rules-seen.json")) {
	const msg = rulesNotice(st);
	if (!msg || !ctx?.hasUI) return;
	const seen = readJson(file);
	const print = rulesPrint(st);
	if (seen[st.key] === print) return;
	try {
		ctx.ui.notify(msg, "info");
	} catch {}
	try {
		writeFileSync(file, `${JSON.stringify({ ...seen, [st.key]: print }, null, 2)}\n`);
	} catch {}
}

/** 찾은 규칙 파일들 -> 규칙 (먼 폴더 것부터: 지침에 넣는 차례. 같은 이름의 match·list 규칙은 가까운 것만) */
export function buildRules(sources: RuleSource[]): TeamRule[] {
	const rules = sources.map(toRule).filter((r): r is TeamRule => !!r);
	const depth = (r: TeamRule) => r.base.split("/").length;
	rules.sort((a, b) => depth(a) - depth(b));
	const seen = new Map<string, TeamRule>();
	for (const r of rules) if (r.kind !== "always") seen.set(`${r.kind}:${r.name}`, r); // 뒤(가까운 것)가 이김
	return rules.filter((r) => r.kind === "always" || seen.get(`${r.kind}:${r.name}`) === r);
}
