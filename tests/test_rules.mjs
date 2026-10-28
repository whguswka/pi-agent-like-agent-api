// 팀 규칙 (profiles/common/agent-template/extensions/rules.ts, lib/rules.ts) 단위 시험:
//  다른 코딩 도구의 지침·규칙 파일 찾기·나누기, 지침에 넣기(실제 pi 의 지침 만들기로), 파일·명령에 걸리는 규칙을 도구 결과에 붙이기, 노트북 찾기 명령(실제 bash)
// 사용법: node tests/test_rules.mjs   (저장소의 runtime/node_modules/jiti 로 .ts 를, pi 는 tests/stubs 의 것으로)
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "../runtime/node_modules/jiti/lib/jiti.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let fails = 0;
const check = (name, cond, detail = "") => {
	console.log((cond ? "OK   " : "FAIL ") + name + (cond ? "" : `  -> ${typeof detail === "string" ? detail : JSON.stringify(detail)}`.slice(0, 900)));
	if (!cond) fails++;
};
const slash = (p) => p.split("\\").join("/");

// 시험 폴더: 홈(HOME·USERPROFILE: Node 의 homedir 는 Windows 에서 USERPROFILE), pi 설정 폴더, 프로젝트
const T = slash(mkdtempSync(join(tmpdir(), "rules-test-")));
const HOME = `${T}/home`;
const AGENT = `${T}/agent`;
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;
process.env.PI_CODING_AGENT_DIR = AGENT;
process.env.PI_COPILOT_USER_CONFIG = `${AGENT}/bridge.json`;
const put = (rel, body) => {
	const p = `${T}/${rel}`;
	mkdirSync(dirname(p), { recursive: true });
	writeFileSync(p, body);
	return p;
};
mkdirSync(AGENT, { recursive: true });

const jiti = createJiti(import.meta.url, {
	alias: { "@earendil-works/pi-coding-agent": join(ROOT, "tests/stubs/pi-coding-agent.mjs"), "@earendil-works/pi-tui": join(ROOT, "tests/stubs/pi-tui.mjs") },
});
const L = await jiti.import("../profiles/common/agent-template/extensions/lib/rules.ts");
const R = await jiti.import("../profiles/common/agent-template/extensions/rules.ts");

// ── 머리말, 역할 줄 ────────────────────────────────────────────────────────
let fm = L.splitFrontmatter("\uFEFF---\r\ndescription: \"SQL 규칙\"\r\nglobs: [\"**/*.sql\", 'db/*.py']\r\nalwaysApply: false\r\ntools:\r\n  - bash\r\n  - write\r\n---\r\n본문\r\n");
check("머리말: 따옴표 값, [a, b] 목록, 다음 줄의 '- 값' 목록 (BOM·CRLF)",
	fm.meta.description === "SQL 규칙" && JSON.stringify(fm.meta.globs) === JSON.stringify(["**/*.sql", "db/*.py"]) && fm.meta.alwaysApply === "false"
	&& JSON.stringify(fm.meta.tools) === JSON.stringify(["bash", "write"]) && fm.body === "본문\r\n", fm);
fm = L.splitFrontmatter('---\ncondition: ["x{1,3}", \'a,b\', c]\n---\n본문');
check("[…] 목록: 따옴표 안의 쉼표는 나누지 않음", JSON.stringify(fm.meta.condition) === JSON.stringify(["x{1,3}", "a,b", "c"]), fm.meta);
fm = L.splitFrontmatter("# 제목\n---\n본문");
check("머리말이 없으면 meta 는 비고 글은 그대로", JSON.stringify(fm.meta) === "{}" && fm.body === "# 제목\n---\n본문", fm);
check("역할 줄: 맨 앞의 'You are … developer' 와 '당신은 … 전문가' 줄은 빼고, 제목·본문과 뒤의 같은 말은 그대로",
	L.stripIdentity("You are an expert Python developer.\n# 규칙\n당신은 사내 데이터 전문가입니다\n\n- 들여쓰기 4칸\nYou are free to refactor.\n")
		=== "# 규칙\n\n\n- 들여쓰기 4칸\nYou are free to refactor.\n");
check("역할 줄이 아닌 'You are' 는 그대로 (assistant·engineer 같은 말이 없음)", L.stripIdentity("You are working on the billing service.\n- A") === "You are working on the billing service.\n- A");

// ── 규칙 파일 나누기 ───────────────────────────────────────────────────────
const P = "C:/w/proj";
const rule = (path, text, base) => L.toRule({ path, text, base });
const kinds = [
	[`${P}/.github/copilot-instructions.md`, "You are an AI assistant.\n- 표는 pandas 로", "always"],
	[`${P}/.github/instructions/py.instructions.md`, "---\napplyTo: \"**/*.py\"\n---\n- 타입 힌트", "match"],
	[`${P}/.github/instructions/all.instructions.md`, "---\napplyTo: '**'\n---\n- 한국어 주석", "always"],
	[`${P}/.github/instructions/deploy.instructions.md`, "---\ndescription: 배포 절차\n---\n- 운영은 승인 뒤", "list"],
	[`${P}/.cursor/rules/style.mdc`, "---\nalwaysApply: true\n---\n- 함수는 짧게", "always"],
	[`${P}/.cursor/rules/sql.mdc`, "---\nglobs: \"**/*.sql, migrations/**\"\n---\n- DROP 금지", "match"],
	[`${P}/.cursor/rules/arch.mdc`, "---\ndescription: 구조 설명\n---\n- 계층", "list"],
	[`${P}/.cursorrules`, "- 옛 Cursor 규칙", "always"],
	[`${P}/.claude/CLAUDE.md`, "- Claude 지침", "always"],
	[`${P}/CLAUDE.md`, "- 옆의 CLAUDE.md", "always"],
	[`${P}/.pi/rules/always.md`, "---\nalways: true\n---\n- 늘", "always"],
	[`${P}/.pi/rules/no-drop.md`, "---\ncondition: \"(?i)drop\\\\s+table\"\n---\n- 지우지 말 것", "match"],
	[`${P}/.pi/rules/desc.md`, "---\ndescription: 설명만\n---\n- 필요할 때", "list"],
];
const got = kinds.map(([p, t]) => rule(p, t)?.kind);
check("나누기: 늘 넣는 것(copilot-instructions, applyTo **, alwaysApply, .cursorrules, CLAUDE.md, always: true) · 파일·명령에 걸리는 것 · 목록만",
	JSON.stringify(got) === JSON.stringify(kinds.map((k) => k[2])), got);
const py = rule(kinds[1][0], kinds[1][1]);
check("applyTo 규칙: 기준 폴더는 .github 가 있는 폴더, 읽기·쓰기·고치기에 걸림, 이름은 파일 이름에서",
	py.base === P && JSON.stringify(py.globs) === JSON.stringify(["**/*.py"]) && JSON.stringify(py.tools) === JSON.stringify(["read", "write", "edit"]) && py.name === "py", py);
const sql = rule(kinds[5][0], kinds[5][1]);
check("globs 를 쉼표로 적은 것도 목록으로", JSON.stringify(sql.globs) === JSON.stringify(["**/*.sql", "migrations/**"]), sql.globs);
const nd = rule(kinds[11][0], kinds[11][1]);
check(".pi/rules 의 condition: (?i) 는 대소문자 무시, 도구는 쓰기·고치기·bash (읽기는 내용을 보지 않음)",
	nd.condition.length === 1 && nd.condition[0].flags.includes("i") && nd.condition[0].test("Drop  TABLE x") && JSON.stringify(nd.tools) === JSON.stringify(["write", "edit", "bash"]), nd);
check("copilot-instructions 의 역할 줄은 빼고 넣음", rule(kinds[0][0], kinds[0][1]).body === "- 표는 pandas 로");
check("목록 규칙의 설명: description, 없으면 첫 줄", rule(kinds[3][0], kinds[3][1]).description === "배포 절차" && rule(`${P}/.cursor/rules/x.mdc`, "# 데이터 규칙\n- a").description === "데이터 규칙");
check("내용이 비면 규칙이 아님 (머리말만, 역할 줄만)", rule(`${P}/.cursor/rules/e.mdc`, "---\nglobs: a\n---\n") === null && rule(`${P}/.github/copilot-instructions.md`, "You are a helpful assistant.") === null);
check("잘못된 정규식은 빼고 (규칙은 목록으로)", rule(`${P}/.pi/rules/bad.md`, "---\ncondition: \"(\"\n---\n- x").kind === "list");
check("condition 을 따옴표 없이·작은따옴표로 적어도 같은 정규식 (\\ 를 두 번 쓰지 않음)",
	[`condition: (?i)drop\\s+table`, `condition: '(?i)drop\\s+table'`, `condition: ["(?i)drop\\\\s+table", 'truncate']`].every((c) => rule(`${P}/.pi/rules/c.md`, `---\n${c}\n---\n- x`)?.condition[0]?.test("DROP  table t")));
check("내 규칙(기준 폴더 \"\")은 그대로 \"\" (작업 폴더 기준)", rule("C:/u/.pi/agent/rules/m.md", "---\nglobs: \"*.ipynb\"\n---\n- 셀 출력 지우기", "").base === "");

// ── glob ──────────────────────────────────────────────────────────────────
const gm = (g, rel) => L.globsMatch([g], rel);
check("glob: **/*.py 는 어느 깊이든, src/** 는 그 아래 모두, *.{ts,tsx}, ?, 대소문자 무시, / 없는 glob 은 파일 이름에도",
	gm("**/*.py", "a/b/c.py") && gm("**/*.py", "c.py") && gm("src/**", "src/a/b.ts") && !gm("src/**", "lib/src.ts") && gm("*.{ts,tsx}", "x.tsx")
	&& gm("*.{ts,tsx}", "deep/x.ts") && gm("a?.md", "ab.md") && !gm("a?.md", "abc.md") && gm("**/*.SQL", "db/q.sql") && !gm("src/*.py", "src/a/b.py") && gm("./docs/*.md", "docs/a.md"));

// ── 도구 호출에 걸리는지, 붙일 글 ───────────────────────────────────────────
check("걸리는지: 도구가 맞고 파일이 globs 에 맞을 때. 경로를 모르면 globs 규칙은 아님",
	L.ruleMatches(py, "edit", "src/a.py", "") && !L.ruleMatches(py, "bash", "src/a.py", "") && !L.ruleMatches(py, "read", "a.txt", "") && !L.ruleMatches(py, "write", null, "x"));
check("condition 규칙: 쓴 내용·명령이 맞을 때만, 읽기는 보지 않음",
	L.ruleMatches(nd, "bash", null, "psql -c 'drop table t'") && !L.ruleMatches(nd, "bash", null, "select 1") && !L.ruleMatches(nd, "read", "x.sql", "drop table"));
const long = rule(`${P}/.cursor/rules/long.mdc`, `---\nglobs: "*.py"\n---\n${"가".repeat(2000)}`);
const note = L.ruleNote(long, "a.py");
check(`붙일 글: 규칙 이름·위치·까닭, 본문은 ${L.NOTE_MAX}자까지`, note.startsWith("(팀 규칙 «long» · .cursor/rules/long.mdc: 이 파일(a.py)에 해당하는 팀 규칙입니다") && note.includes(`줄임: 2000자 중 ${L.NOTE_MAX}자`), note.slice(0, 200));
check("condition 규칙의 글: 도구는 이미 실행됐으니 어긋나면 다음 호출에서 고치라고", L.ruleNote(nd, null).includes("도구는 이미 실행됐으니"));

// ── 지침에 넣기 ────────────────────────────────────────────────────────────
const rs = kinds.map(([p, t]) => rule(p, t)).filter(Boolean);
const existing = [{ path: `${P}/AGENTS.md`, content: "# 지침\n\n- 함수는 짧게\n" }];
const cf = L.contextFromRules(rs, existing);
check("지침 파일 목록에: 늘 넣는 것만, 이미 있는 내용(문단이 모두 있음)은 빼고 까닭을 남김",
	cf.files.map((f) => f.path.replace(`${P}/`, "")).join(",") === ".github/copilot-instructions.md,.github/instructions/all.instructions.md,.cursorrules,.claude/CLAUDE.md,CLAUDE.md,.pi/rules/always.md"
	&& cf.skipped.length === 1 && cf.skipped[0].path.endsWith("style.mdc") && cf.skipped[0].why === "이미 같은 내용이 있음", cf);
check("이미 목록에 있는 경로는 다시 넣지 않음 (대소문자·\\ 무시)", L.contextFromRules(rs, [{ path: "c:\\w\\proj\\CLAUDE.md", content: "x" }]).files.every((f) => !f.path.endsWith("/CLAUDE.md") || f.path.includes(".claude")));
const big = [1, 2, 3].map((i) => rule(`${P}/.cursor/rules/big${i}.mdc`, `---\nalwaysApply: true\n---\n${String(i).repeat(9000)}`));
const capped = L.contextFromRules(big, []);
check(`크기 상한: 한 파일 ${L.RULE_MAX}자, 모두 ${L.RULE_TOTAL}자 (넘는 것은 빼고 까닭)`,
	capped.files.length === 1 && capped.files[0].content.length < L.RULE_MAX + 40 && capped.skipped.length === 2 && capped.skipped[0].why.includes(`${L.RULE_TOTAL}자`), [capped.files.map((f) => f.content.length), capped.skipped]);
const sec = L.teamRulesSection([".github/copilot-instructions.md"], rs.filter((r) => r.kind === "list"));
check("team_rules 부분: 넣은 지침 파일은 다시 읽지 말라고, 목록 규칙은 이름·설명·경로", sec.includes("다시 찾거나 읽지 마세요") && sec.includes(`«deploy»: 배포 절차 — ${P}/.github/instructions/deploy.instructions.md`) && sec.includes("«arch»: 구조 설명"), sec);
check("넣을 것이 없으면 부분도 없음", L.teamRulesSection([], []) === undefined);

// ── 실제 파일로: PC 의 작업 폴더부터 위로 (rules.ts) ─────────────────────────
const PJ = `${HOME}/work/proj`;
put("home/.claude/CLAUDE.md", "- 홈의 개인 설정 (읽으면 안 됨)");
put("home/work/.github/copilot-instructions.md", "- 저장소 밖 (읽으면 안 됨)");
mkdirSync(`${PJ}/.git`, { recursive: true });
put("home/work/proj/AGENTS.md", "# pi 지침\n\n- 함수는 짧게\n");
put("home/work/proj/CLAUDE.md", "- AGENTS.md 옆의 CLAUDE.md");
put("home/work/proj/.github/copilot-instructions.md", "You are an expert Python developer.\n\n- 들여쓰기는 4칸\n");
put("home/work/proj/.github/instructions/py.instructions.md", "---\napplyTo: \"**/*.py\"\n---\n- 함수에 타입 힌트");
put("home/work/proj/.github/instructions/deploy.instructions.md", "---\ndescription: 배포 절차\n---\n- 운영 반영은 승인 뒤");
put("home/work/proj/.cursor/rules/sql.mdc", "---\nglobs: \"**/*.sql\"\n---\n- 먼 sql 규칙");
put("home/work/proj/.cursor/rules/style.mdc", "---\nalwaysApply: true\n---\n- 함수는 짧게");
put("home/work/proj/.cursor/rules/notes.txt", "규칙 파일 아님");
put("home/work/proj/.pi/rules/no-drop.md", "---\ncondition: \"(?i)drop\\\\s+table\"\n---\n- 테이블을 지우지 말 것. 꼭 필요하면 먼저 사용자에게");
put("home/work/proj/sub/.cursor/rules/sql.mdc", "---\nglobs: \"*.sql\"\n---\n- 가까운 sql 규칙");
put("agent/rules/mine.md", "---\nglobs: \"**/*.ipynb\"\n---\n- 노트북은 셀 출력을 지우고 저장");
put("agent/rules/team/x.md", "---\ndescription: 내 목록 규칙\n---\n- 필요할 때");
put("agent/rules/skip.txt", "아님");
const CWD = `${PJ}/sub`;
const srcs = R.localRuleSources(CWD, HOME);
const rel = (p) => p.replace(`${PJ}/`, "");
check("PC 찾기: 작업 폴더부터 위로 git 저장소 맨 위에서 멈춤 (홈·저장소 밖·규칙 아닌 파일은 안 봄), AGENTS.md 옆의 CLAUDE.md",
	JSON.stringify(srcs.map((s) => rel(slash(s.path)))) === JSON.stringify([
		"sub/.cursor/rules/sql.mdc", ".github/copilot-instructions.md", "CLAUDE.md", ".github/instructions/deploy.instructions.md", ".github/instructions/py.instructions.md",
		".cursor/rules/sql.mdc", ".cursor/rules/style.mdc", ".pi/rules/no-drop.md",
	]), srcs.map((s) => s.path));
const mine = L.myRuleSources();
check("내 규칙: ~/.pi/agent/rules 의 .md (아래 폴더 한 단계), 기준 폴더는 작업 폴더(\"\")",
	JSON.stringify(mine.map((s) => s.path.replace(`${AGENT}/`, ""))) === JSON.stringify(["rules/mine.md", "rules/team/x.md"]) && mine.every((s) => s.base === ""), mine);
const all = L.buildRules([...srcs, ...mine]);
check("규칙 만들기: 먼 폴더 것부터, 같은 이름의 파일·목록 규칙은 가까운 것만 (sub 의 sql)",
	all.filter((r) => r.name === "sql").length === 1 && all.find((r) => r.name === "sql").body === "- 가까운 sql 규칙" && all[0].base === "" && all.filter((r) => r.kind === "always").length === 3, all.map((r) => [r.kind, r.name, r.base]));

// 실제 pi 의 지침 만들기로 (test_jupyter.mjs 와 같은 방법: pi 는 이 함수를 내보내지 않아 번들에서 꺼냄)
let piPrompt = null;
try {
	const dir = join(ROOT, "runtime/dist/bundle/chunks");
	const file = readdirSync(dir).map((f) => join(dir, f)).find((f) => f.endsWith(".js") && readFileSync(f, "utf8").includes("function buildSystemPromptSections("));
	const s = file ? readFileSync(file, "utf8") : "";
	const grab = (start, end) => {
		const i = s.indexOf(start);
		const k = i < 0 ? -1 : s.indexOf(end, i + start.length);
		if (k < 0) throw new Error(`pi 번들에서 찾지 못함: ${start} … ${end}`);
		return s.slice(i, k);
	};
	piPrompt = new Function([
		"var SYSTEM_PROMPT_SECTION_NAME=/^[a-z][a-z0-9_-]*$/;",
		grab("function normalizeBuildSystemPromptOptions", "function buildRules"),
		"function buildRules(){return ''};function getReadmePath(){return 'R'};function getDocsPath(){return 'D'};function getExamplesPath(){return 'E'};",
		grab("function renderProjectContext", "function buildRules"),
		grab("function formatSkillsForPrompt", "function loadSkills"),
		grab("function buildSystemPromptSections", "function buildSystemPromptState"),
		"return {normalizeBuildSystemPromptOptions, buildSystemPromptSections};",
	].join("\n"))();
} catch (e) {
	check("pi 번들에서 지침 만들기 함수를 찾음 (pi 를 올렸으면 이 시험의 찾는 표시를 고칠 것)", false, e.message);
}

// 확장 그대로: 가짜 pi 에 붙여 요청 시작·도구 결과·/rules
const handlers = {};
const commands = {};
const fakePi = { on: (ev, fn) => (handlers[ev] ||= []).push(fn), registerCommand: (n, c) => (commands[n] = c), registerTool() {} };
R.default(fakePi);
const notes = [];
const ctx = { hasUI: true, cwd: CWD, ui: { notify: (m, level) => notes.push([m, level]) } };
globalThis.__piWorkDir = { remote: false, cwd: CWD };
const fire = async (ev, event) => {
	let last;
	for (const fn of handlers[ev] || []) last = await fn(event, ctx);
	return last;
};
await fire("session_start", { reason: "startup" });
const optsFor = () => {
	const base = { cwd: CWD, contextFiles: [{ path: `${PJ}/AGENTS.md`, content: "# pi 지침\n\n- 함수는 짧게\n" }], skills: [], selectedTools: ["read", "bash", "edit", "write"] };
	return piPrompt ? piPrompt.normalizeBuildSystemPromptOptions(base) : { ...base, sections: {} };
};
const o1 = optsFor();
await fire("before_agent_start", { systemPromptOptions: o1 });
check("요청 시작: 늘 넣는 지침을 지침 파일 목록에 (이미 있는 내용 style.mdc 는 빼고)",
	JSON.stringify(o1.contextFiles.map((f) => rel(f.path))) === JSON.stringify(["AGENTS.md", ".github/copilot-instructions.md", "CLAUDE.md"]), o1.contextFiles.map((f) => f.path));
check("처음 보는 규칙이면 한 번 알림 (보기 /rules, 끄기 /hooks off rules)", notes.length === 1 && notes[0][0].includes("/rules") && notes[0][0].includes("/hooks off rules") && notes[0][0].includes("개는 해당 파일·명령을 다룰 때만"), notes);
if (piPrompt) {
	const sections = piPrompt.buildSystemPromptSections(o1);
	const pc = sections.project_context || "";
	check("실제 pi 지침: 지침 파일로 들어가고 (역할 줄은 빠짐), team_rules 부분이 생김",
		pc.includes(`<project_instructions path="${PJ}/.github/copilot-instructions.md">\n- 들여쓰기는 4칸`) && !pc.includes("You are an expert Python developer")
		&& (sections.team_rules || "").startsWith("<team_rules>\n다른 코딩 도구의 지침 파일(.github/copilot-instructions.md, CLAUDE.md)은 위 지침에 이미 넣었습니다")
		&& sections.team_rules.includes("«deploy»: 배포 절차") && sections.team_rules.includes("«x»: 내 목록 규칙"), sections);
	const o2 = optsFor();
	await fire("before_agent_start", { systemPromptOptions: o2 });
	check("다음 요청도 지침이 똑같음 (지침이 바뀌면 Copilot 이 새 대화를 엶) · 알림은 다시 안 함",
		JSON.stringify(piPrompt.buildSystemPromptSections(o2)) === JSON.stringify(sections) && notes.length === 1);
}
put("home/work/proj/.cursor/rules/new.mdc", "---\nalwaysApply: true\n---\n- 세션 중에 새로 둔 규칙");
const o3 = optsFor();
await fire("before_agent_start", { systemPromptOptions: o3 });
check("세션 중에 새로 둔 파일은 다음 세션부터 (처음 찾은 것을 그대로)", !o3.contextFiles.some((f) => f.path.endsWith("new.mdc")));

const tr = (toolName, input) => fire("tool_result", { toolName, input, content: [{ type: "text", text: "결과" }], isError: false });
const texts = (r) => (r?.content || []).slice(1).map((c) => c.text).join("\n");
let r = await tr("edit", { path: "src/train.py", edits: [{ oldText: "a", newText: "b" }] });
check("파일 규칙: 고친 파일이 applyTo 에 맞으면 결과 끝에 규칙 (원래 결과는 그대로)", r?.content?.[0]?.text === "결과" && texts(r).includes("«py»") && texts(r).includes("함수에 타입 힌트") && texts(r).includes("../src/train.py") === false, r);
check("같은 규칙은 세션에서 한 번만", (await tr("write", { path: "src/other.py", content: "x" })) === undefined);
r = await tr("write", { path: "q.sql", content: "select 1" });
check("가까운 sql 규칙 (작업 폴더 sub 기준 *.sql)", texts(r).includes("가까운 sql 규칙") && !texts(r).includes("먼 sql 규칙"), texts(r));
r = await tr("read", { path: "nb/a.ipynb" });
check("내 규칙: 작업 폴더 기준 globs (읽기에도)", texts(r).includes("셀 출력을 지우고"), texts(r));
r = await tr("bash", { command: "psql -c 'DROP TABLE tmp'" });
check("condition 규칙: 명령이 맞으면 '도구는 이미 실행됐으니' 와 함께", texts(r).includes("«no-drop»") && texts(r).includes("이미 실행됐으니"), texts(r));
check("condition 규칙은 명령에서 한 번 (같은 세션)", (await tr("bash", { command: "drop table x" })) === undefined);
r = await tr("write", { path: `${PJ}/db/m.sql`, content: "DROP TABLE a;" });
check("condition 규칙은 파일마다 따로 (bash 와 다른 파일), 저장소 밖 규칙 기준이면 안 붙음", texts(r).includes("«no-drop»") && !texts(r).includes("sql 규칙"), texts(r));
check("오류 결과에는 붙이지 않음", (await fire("tool_result", { toolName: "write", input: { path: "z.sql", content: "drop table q" }, content: [], isError: true })) === undefined);
// bash 로 쓰는 파일 (cat > … <<EOF): 그 파일에는 쓰기 규칙으로 (2026-10-27 실사용 시험: 모델이 새 .py 를 bash heredoc 으로 만듦)
const stNow = globalThis.__piTeamRules;
const bashNotes = R.notesFor(stNow, "bash", { command: "cd src && cat > n.py <<'PY'\nx = 1\nPY\ncat > ../q2.sql <<'SQL'\nselect 1\nSQL" }, { remote: false, cwd: CWD }, new Set());
check("bash 로 쓴 파일: cd 를 따라 경로를 붙여 파일 규칙 (src/n.py → «py», cd src 뒤의 ../q2.sql 은 작업 폴더 sub 의 것이라 가까운 sql 규칙)",
	bashNotes.length === 2 && bashNotes.some((t) => t.includes("«py»") && t.includes("이 파일(sub/src/n.py)")) && bashNotes.some((t) => t.includes("가까운 sql 규칙") && t.includes("이 파일(q2.sql)")), bashNotes);
check("bash 로 읽기만 하는 명령은 파일 규칙 없음", R.notesFor(stNow, "bash", { command: "cat src/a.py | head" }, { remote: false, cwd: CWD }, new Set()).length === 0);
check("붙일 글: 전문이면 '규칙 파일은 따로 읽지 않아도', 잘렸으면 '전문은 그 파일' (실사용 시험: 전문을 받고도 규칙 파일을 다시 찾아 읽음)",
	bashNotes.find((t) => t.includes("«py»")).includes("아래가 규칙 전문이라 규칙 파일은 따로 읽지 않아도 됩니다") && L.ruleNote(long, "a.py").includes("아래는 앞부분이고 전문은 .cursor/rules/long.mdc"));

await commands.rules.handler("", ctx);
const shown = notes[notes.length - 1][0];
check("/rules: 읽은 파일과 범위 (늘·목록·globs·조건), 넣지 않은 까닭",
	shown.includes(".github/copilot-instructions.md  (늘)") && shown.includes(".github/instructions/deploy.instructions.md  (목록)") && shown.includes("**/*.py · read/write/edit")
	&& shown.includes("모든 파일 · 조건 있음 · write/edit/bash") && shown.includes("넣지 않음: 이미 같은 내용이 있음") && shown.includes("~/") === false, shown);

// 끄기: 내 설정 파일의 "team_rules": false
writeFileSync(`${AGENT}/bridge.json`, JSON.stringify({ team_rules: false }));
const o4 = optsFor();
await fire("before_agent_start", { systemPromptOptions: o4 });
check("끄면: 지침에 넣지 않고 도구 결과에도 안 붙임", o4.contextFiles.length === 1 && !o4.sections?.team_rules && L.rulesOn() === false
	&& (await tr("edit", { path: "src/zz.py", edits: [{ oldText: "a", newText: "b" }] })) === undefined);
writeFileSync(`${AGENT}/bridge.json`, "{}");

// 알림은 프로젝트마다 목록이 바뀔 때만
const seenFile = `${T}/seen.json`;
const st = { key: "k1", all: all, match: all.filter((x) => x.kind === "match"), loaded: [], skipped: [] };
const n0 = notes.length;
L.noticeOnce(ctx, st, seenFile);
L.noticeOnce(ctx, st, seenFile);
L.noticeOnce(ctx, { ...st, all: all.slice(1) }, seenFile);
L.noticeOnce({ hasUI: false }, { ...st, key: "k2" }, seenFile);
check("알림: 같은 목록은 한 번, 바뀌면 다시, 화면이 없으면 안 함", notes.length === n0 + 2 && !JSON.parse(readFileSync(seenFile, "utf8")).k2, notes.slice(n0));

// ── 노트북 (jupyter 모드): 경로, 찾기 명령 ──────────────────────────────────
const nb = { remote: true, cwd: "/home/jovyan/work/lab", home: "/home/jovyan" };
check("노트북 경로: 상대·~ 는 노트북, PC 경로와 노트북 형식의 pi 설정 폴더는 아님",
	R.toolAbs("src/a.py", nb) === "/home/jovyan/work/lab/src/a.py" && R.toolAbs("~/x.py", nb) === "/home/jovyan/x.py" && R.toolAbs("C:/x/a.py", nb) === null
	&& R.toolAbs("~/.pi/agent/rules/a.md", nb) === null && R.toolAbs("", nb) === null && R.toolAbs(undefined, nb) === null);
check("기준 폴더에 대한 상대 경로 (밖이면 null)", R.relToBase("/home/jovyan/work", "/home/jovyan/work/lab/a.py", true) === "lab/a.py" && R.relToBase("/home/jovyan/work/lab", "/home/jovyan/a.py", true) === null
	&& R.relToBase(PJ, `${PJ}/src/a.py`, false) === "src/a.py");
const mixed = "@@SKILL /h/.pi/skills/a/SKILL.md\n---\nname: a\ndescription: d\n---\n@@RULE /h/w/.github/copilot-instructions.md\n- 규칙 줄\n@@RULE /h/w/.cursor/rules/x.mdc\n---\nglobs: a\n---\n- x\n";
const parsed = L.parseRuleScan(mixed);
check("찾기 출력 읽기: @@RULE 부분만 (스킬 부분은 건너뜀)", JSON.stringify(parsed) === JSON.stringify([
	{ path: "/h/w/.github/copilot-instructions.md", text: "- 규칙 줄" }, { path: "/h/w/.cursor/rules/x.mdc", text: "---\nglobs: a\n---\n- x" },
]), parsed);
const scan = spawnSync("bash", ["-c", L.RULE_SCAN], { cwd: CWD, env: { ...process.env, HOME: HOME.replace(/^([A-Za-z]):/, (_, d) => `/${d.toLowerCase()}`) }, encoding: "utf8" });
const nbFound = L.parseRuleScan(scan.stdout || "").map((s) => s.path.replace(/^.*\/work\/proj\//, ""));
check("노트북 찾기 명령 (실제 bash): PC 찾기와 같은 파일 (홈·저장소 밖은 안 봄)",
	JSON.stringify([...nbFound].sort()) === JSON.stringify(R.localRuleSources(CWD, HOME).map((s) => rel(slash(s.path))).sort()) && nbFound.includes(".cursor/rules/new.mdc"), { nbFound, err: scan.stderr });
check("노트북 찾기 명령: 파일 내용이 함께 (머리말 그대로)", L.parseRuleScan(scan.stdout || "").find((s) => s.path.endsWith("py.instructions.md"))?.text === "---\napplyTo: \"**/*.py\"\n---\n- 함수에 타입 힌트");

rmSync(T, { recursive: true, force: true });
console.log(fails ? `RESULT: FAIL (${fails})` : "RESULT: PASS");
process.exit(fails ? 1 : 0);
