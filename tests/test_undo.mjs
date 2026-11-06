// 되돌리기(profiles/common/agent-template/extensions/undo.ts) 단위 테스트: git 기준점 제안, HTML 표기 풀기
// 사용법: node tests/test_undo.mjs   (Node 20.15 이상. 저장소의 runtime/node_modules/jiti 로 .ts 를 불러옴. git 이 없으면 git 부분은 건너뜀)
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "../runtime/node_modules/jiti/lib/jiti.mjs";

const jiti = createJiti(import.meta.url);
const u = await jiti.import("../profiles/common/agent-template/extensions/undo.ts");
// 이 시험은 git 기준점 제안 자체를 보므로, 시험 모음(release-check)이 켜 둔 끄기(PI_GIT_OFFER=0)는 뺀다
const oldGitOffer = process.env.PI_GIT_OFFER;
delete process.env.PI_GIT_OFFER;
let fails = 0;
const check = (name, cond, detail = "") => {
	console.log((cond ? "OK   " : "FAIL ") + name + (cond ? "" : "  -> " + JSON.stringify(detail).slice(0, 800)));
	if (!cond) fails++;
};
const win = process.platform === "win32";

// HTML 표기 풀기 (실사용 시험: Copilot 이 'List&lt;PerformanceCounter&gt;' 로 보내 고치기가 실패함)
check("풀기: &lt; &gt; &quot; &#39; &amp; (&amp;lt; 는 &lt; 로 한 번만)",
	u.unescapeHtml("List&lt;int&gt; a = &quot;x&quot; &#39;y&#39; &amp;&amp; b") === "List<int> a = \"x\" 'y' && b" && u.unescapeHtml("&amp;lt;") === "&lt;");
const cs = "    class Metrics\n    {\n        readonly PerformanceCounter cpu;\n        readonly List<PerformanceCounter> gpu = new List<PerformanceCounter>();\n";
let fx = u.fixEntityEdits(cs, [{ oldText: "readonly List&lt;PerformanceCounter&gt; gpu = new List&lt;PerformanceCounter&gt;();", newText: "Dictionary&lt;string, CounterSample&gt; last;" }]);
check("고칠 글이 HTML 표기로 와서 파일에 없고 풀면 있음 -> oldText·newText 를 풂",
	fx && fx[0].oldText === "readonly List<PerformanceCounter> gpu = new List<PerformanceCounter>();" && fx[0].newText === "Dictionary<string, CounterSample> last;", fx);
check("표기가 없는 고치기·이미 맞는 고치기는 그대로 (null)",
	u.fixEntityEdits(cs, [{ oldText: "readonly PerformanceCounter cpu;", newText: "x" }]) === null
	&& u.fixEntityEdits("<p>&lt;b&gt; 는 굵게</p>", [{ oldText: "&lt;b&gt;", newText: "&lt;i&gt;" }]) === null);
check("풀어도 파일에 없으면 그대로 (pi 가 원래대로 '찾지 못함' 을 알림)", u.fixEntityEdits(cs, [{ oldText: "List&lt;Foo&gt;", newText: "x" }]) === null);
fx = u.fixEntityEdits("a\r\nList<int> x;\r\n", [{ oldText: "a\nList&lt;int&gt; x;", newText: "b" }, { oldText: "a", newText: "c" }]);
check("CRLF 파일도 맞춰 보고, 여러 고치기 중 표기가 있는 것만 풂", fx && fx[0].oldText === "a\nList<int> x;" && fx[1].oldText === "a", fx);

// git 을 제안하지 않는 폴더
const H = win ? "C:\\Users\\u" : "/home/u";
check("제안하지 않는 폴더: 홈, 드라이브 맨 위, 시스템 폴더, pi 폴더 / 그 밖은 제안",
	u.gitOfferBlocked(H, H) === "홈 폴더" && u.gitOfferBlocked(win ? "C:\\" : "/", H) === "드라이브 맨 위"
	&& (!win || u.gitOfferBlocked("C:\\Windows\\System32", H) === "시스템 폴더" && u.gitOfferBlocked("c:/program files/app", H) === "시스템 폴더")
	&& u.gitOfferBlocked(join(H, ".pi", "agent"), H) === "pi 폴더" && u.gitOfferBlocked(join(H, "tools", "pi"), H) === "pi 폴더"
	&& u.gitOfferBlocked(join(H, "work", "resmon"), H) === "" && u.gitOfferBlocked(join(H, "tools", "pix"), H) === "",
	[u.gitOfferBlocked(H, H), u.gitOfferBlocked(join(H, "work", "resmon"), H)]);

const tmp = mkdtempSync(join(tmpdir(), "undo-test-"));
const mk = (rel, text = "x\n") => {
	const p = join(tmp, rel);
	mkdirSync(join(p, ".."), { recursive: true });
	writeFileSync(p, text);
	return p;
};
mk("cnt/a.py");
mk("cnt/src/b.py");
mk("cnt/node_modules/m/index.js");
mk("cnt/src/__pycache__/b.pyc");
mk("cnt/.git/HEAD");
const cnt = u.countFiles(join(tmp, "cnt"));
check("파일 세기: node_modules·__pycache__·.git 안은 세지 않고 이름을 알려 줌, 한도를 넘으면 null",
	cnt && cnt.n === 2 && cnt.heavy.sort().join(",") === "__pycache__,node_modules" && u.countFiles(join(tmp, "cnt"), 1) === null, cnt);

// 가짜 pi 로: 처음 고치기 직전에 묻고, '예' 면 기준점 커밋, '아니요' 면 다시 묻지 않음
let hasGit = true;
try {
	execFileSync("git", ["--version"], { stdio: "ignore" });
} catch {
	hasGit = false;
}
const oldAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = join(tmp, "agent");
const on = {};
u.default({ on: (e, f) => (on[e] ||= []).push(f), registerCommand: () => {} });
const asked = [];
const notes = [];
let answer = true;
let lastOpts = null;
let confirmDelay = 0; // 묻는 창이 저절로 닫히는 것(시간 다 됨)을 흉내
const ctx = {
	hasUI: true,
	ui: {
		notify: (t, l) => notes.push([t, l]),
		confirm: async (title, msg, opts) => {
			asked.push([title, msg]);
			lastOpts = opts;
			if (confirmDelay) await new Promise((r) => setTimeout(r, confirmDelay));
			return answer;
		},
	},
};
const emit = async (e, ev = {}, c = ctx) => {
	let r;
	for (const f of on[e] || []) r = (await f(ev, c)) ?? r;
	return r;
};
const gitOut = (dir, args) => execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();

if (!hasGit) {
	console.log("건너뜀: git 이 없어 git 기준점 부분은 시험하지 않음");
} else {
	const proj = join(tmp, "proj");
	mk("proj/main.cs", "class A { List<int> x; }\n");
	mk("proj/node_modules/lib/x.js");
	globalThis.__piWorkDir = { remote: false, cwd: proj };
	await emit("session_start", { reason: "startup" });
	await emit("agent_start");
	const ev1 = { toolName: "edit", input: { path: join(proj, "main.cs"), edits: [{ oldText: "List&lt;int&gt; x;", newText: "List&lt;long&gt; x;" }] } };
	await emit("tool_call", ev1);
	check("처음 고치기 직전에 한 번 물음 (파일 수, .gitignore, 커밋 이름 안내)",
		asked.length === 1 && asked[0][0] === "이 폴더를 git 으로 관리할까요?" && asked[0][1].includes("파일 1개") && asked[0][1].includes("node_modules 폴더는 .gitignore"), asked);
	check("'예' -> git init, .gitignore, 기준점 커밋 (node_modules 는 빠짐)",
		existsSync(join(proj, ".git")) && readFileSync(join(proj, ".gitignore"), "utf8") === "node_modules/\n"
		&& gitOut(proj, ["log", "--format=%s"]) === "pi: 기준점 (pi 가 고치기 전)" && gitOut(proj, ["ls-files"]).split("\n").sort().join(",") === ".gitignore,main.cs",
		[gitOut(proj, ["log", "--format=%s"]), gitOut(proj, ["ls-files"])]);
	check("같은 고치기의 HTML 표기도 풂 (기준점과 함께)", ev1.input.edits[0].oldText === "List<int> x;" && ev1.input.edits[0].newText === "List<long> x;", ev1.input);
	const r = await emit("input", { text: "다음 요청" });
	check("다음 요청에 git 으로 관리하기 시작했다고 알림", r?.text?.startsWith("(이 작업 폴더를 git 으로 관리하기 시작했습니다.") && r.text.endsWith("다음 요청"), r);
	await emit("tool_call", { toolName: "write", input: { path: join(proj, "b.cs") } });
	check("이미 저장소면 다시 묻지 않음", asked.length === 1, asked.length);

	const proj2 = join(tmp, "proj2");
	mk("proj2/a.txt");
	globalThis.__piWorkDir = { remote: false, cwd: proj2 };
	answer = false;
	await emit("session_start", { reason: "new" });
	await emit("tool_call", { toolName: "write", input: { path: join(proj2, "a.txt") } });
	check("'아니요' -> 저장소를 만들지 않고 이 폴더는 기억", asked.length === 2 && !existsSync(join(proj2, ".git"))
		&& Object.keys(JSON.parse(readFileSync(join(tmp, "agent", "git-offer.json"), "utf8")).declined).length === 1);
	await emit("session_start", { reason: "new" });
	await emit("tool_call", { toolName: "write", input: { path: join(proj2, "a.txt") } });
	check("새 세션에서도 그 폴더는 다시 묻지 않음", asked.length === 2, asked.length);

	const proj3 = join(tmp, "proj3");
	mk("proj3/a.txt");
	globalThis.__piWorkDir = { remote: false, cwd: proj3 };
	await emit("session_start", { reason: "new" });
	await emit("tool_call", { toolName: "write", input: { path: join(proj3, "a.txt") } }, { hasUI: false, ui: ctx.ui });
	await emit("tool_call", { toolName: "write", input: { path: join(tmp, "elsewhere.txt") } });
	check("화면이 없는 실행(pi -p)·작업 폴더 밖의 파일이면 묻지 않음", asked.length === 2 && !existsSync(join(proj3, ".git")), asked.length);
	globalThis.__piWorkDir = { remote: true, cwd: "/home/jovyan/proj" };
	await emit("session_start", { reason: "new" });
	await emit("tool_call", { toolName: "write", input: { path: "/home/jovyan/proj/a.py" } });
	check("jupyter 모드(노트북 파일)는 묻지 않음", asked.length === 2, asked.length);

	const proj4 = join(tmp, "proj4");
	mk("proj4/a.txt");
	const cfgFile = join(tmp, "agent", "git-offer.json");
	const declinedBefore = JSON.parse(readFileSync(cfgFile, "utf8")).declined;
	writeFileSync(cfgFile, JSON.stringify({ enabled: false, declined: declinedBefore }));
	globalThis.__piWorkDir = { remote: false, cwd: proj4 };
	await emit("session_start", { reason: "new" });
	await emit("tool_call", { toolName: "write", input: { path: join(proj4, "a.txt") } });
	check("git-offer.json 에 \"enabled\": false 면 어디서도 묻지 않음 (시험용 HOME 등)", asked.length === 2 && !existsSync(join(proj4, ".git")), asked.length);
	writeFileSync(cfgFile, JSON.stringify({ declined: declinedBefore }));
	answer = false;
	await emit("session_start", { reason: "new" });
	await emit("tool_call", { toolName: "write", input: { path: join(proj4, "a.txt") } });
	check("'아니요' 로 더할 때 다른 설정은 그대로", asked.length === 3
		&& Object.keys(JSON.parse(readFileSync(cfgFile, "utf8")).declined).length === Object.keys(declinedBefore).length + 1);
	check("묻는 창에는 시간 제한 (아무도 보지 않는 실행이 멈추지 않게)", lastOpts?.timeout === u.GIT_OFFER.timeoutMs && u.GIT_OFFER.timeoutMs === 120000, lastOpts);

	const proj5 = join(tmp, "proj5");
	mk("proj5/a.txt");
	globalThis.__piWorkDir = { remote: false, cwd: proj5 };
	process.env.PI_GIT_OFFER = "0";
	await emit("session_start", { reason: "new" });
	await emit("tool_call", { toolName: "write", input: { path: join(proj5, "a.txt") } });
	check("환경 변수 PI_GIT_OFFER=0 이면 묻지 않음 (release-check 의 시험용 HOME)", asked.length === 3, asked.length);
	delete process.env.PI_GIT_OFFER;
	u.GIT_OFFER.timeoutMs = 60;
	confirmDelay = 80;
	const nDeclined = Object.keys(JSON.parse(readFileSync(cfgFile, "utf8")).declined).length;
	await emit("session_start", { reason: "new" });
	await emit("tool_call", { toolName: "write", input: { path: join(proj5, "a.txt") } });
	check("시간이 다 돼 저절로 닫히면 '아니요' 로 기억하지 않음 (다음 세션에 다시 물음)",
		asked.length === 4 && Object.keys(JSON.parse(readFileSync(cfgFile, "utf8")).declined).length === nDeclined && !existsSync(join(proj5, ".git")));
	confirmDelay = 0;
	await emit("session_start", { reason: "new" });
	await emit("tool_call", { toolName: "write", input: { path: join(proj5, "a.txt") } });
	check("그래서 다음 세션에는 다시 물음", asked.length === 5, asked.length);
}

// 되돌리기 기록을 파일에 (2026-11-05): pi 를 다시 켜거나 새 세션이어도 그 폴더의 최근 요청을 /undo
{
	process.env.PI_GIT_OFFER = "0";
	const p6 = join(tmp, "proj6");
	const A = mk("proj6/a.txt", "v0");
	const NEW = join(p6, "new.txt");
	const wd6 = { remote: false, cwd: p6 };
	globalThis.__piWorkDir = wd6;
	const D = u.undoDir(wd6);
	check("기록 폴더: ~/.pi/agent/undo/<끝 두 이름>-<해시>, 폴더마다 다름 (Windows 는 대소문자 무시), 노트북 폴더는 nb-",
		D.startsWith(join(tmp, "agent", "undo")) && /[\\/]undo[\\/][^\\/]*proj6-[0-9a-f]{8}$/.test(D) && u.undoDir({ remote: false, cwd: join(tmp, "proj7") }) !== D
		&& (!win || u.undoDir({ remote: false, cwd: p6.toUpperCase() }).toLowerCase() === D.toLowerCase()) && /[\\/]nb-[^\\/]+$/.test(u.undoDir({ remote: true, cwd: "/home/jovyan/proj6" })), D);
	const req = async (text, edits, o = on) => {
		const em = async (e, ev = {}) => {
			for (const f of o[e] || []) await f(ev, ctx);
		};
		await em("input", { text, source: "interactive" });
		await em("agent_start");
		for (const [p, v] of edits) {
			await em("tool_call", { toolName: existsSync(p) ? "edit" : "write", input: { path: p } });
			if (v !== undefined) writeFileSync(p, v);
			await em("tool_result", { toolName: existsSync(p) ? "edit" : "write", input: { path: p } });
		}
	};
	await emit("session_start", { reason: "startup" });
	await req("첫 요청: a 고치고 new 만들기", [[A, "v1"], [NEW, "n1"]]);
	let cps = u.loadCps(D);
	check("고칠 때마다 파일에 기록: 요청의 첫 줄, 파일마다 고치기 전·후 (새로 만든 파일은 '없었음'), 내용 파일",
		cps.length === 1 && cps[0].req === "첫 요청: a 고치고 new 만들기" && cps[0].files.length === 2 && cps[0].files[1].before === null
		&& u.readBlob(D, cps[0].files[0].before)?.toString() === "v0" && u.readBlob(D, cps[0].files[0].after)?.toString() === "v1", cps);
	await req("둘째 요청", [[A, "v2"], [NEW, undefined]]);
	cps = u.loadCps(D);
	check("바뀐 것이 없는 고치기(실패한 고치기 등)는 기록하지 않음", cps.length === 2 && cps[1].files.length === 1 && cps[1].req === "둘째 요청", cps.map((c) => c.files.length));
	// pi 를 다시 켬: 확장을 새로 (세션 상태 없음)
	delete globalThis.__piUndo;
	const on2 = {};
	const cmds2 = {};
	u.default({ on: (e, f) => (on2[e] ||= []).push(f), registerCommand: (n, d) => (cmds2[n] = d) });
	for (const f of on2.session_start || []) await f({ reason: "startup" }, ctx);
	answer = true;
	const a0 = asked.length;
	await cmds2.undo.handler("", ctx);
	check("다시 켠 뒤 /undo: 파일의 기록으로 마지막 요청을 되돌림 (묻는 창에 시각·요청·파일), 그 기록은 뺌",
		readFileSync(A, "utf8") === "v1" && existsSync(NEW) && asked.length === a0 + 1 && asked.at(-1)[0] === "되돌릴까요? (요청 1개)"
		&& asked.at(-1)[1].includes('"둘째 요청"') && asked.at(-1)[1].includes("복원: ") && u.loadCps(D).length === 1 && notes.at(-1)[0].startsWith("되돌렸습니다:"), [asked.at(-1), notes.at(-1)]);
	let r = null;
	for (const f of on2.input || []) r = (await f({ text: "다음 요청", source: "interactive" }, ctx)) ?? r;
	check("다음 요청에 되돌린 파일을 알림", r?.text?.startsWith("(사용자가 /undo 로 앞 요청에서 바꾼 파일을 원래대로 돌렸습니다:") && r.text.endsWith("다음 요청"), r);
	await cmds2.undo.handler("1", ctx);
	check("한 번 더: 그 앞 요청 (새로 만든 파일은 지움)", readFileSync(A, "utf8") === "v0" && !existsSync(NEW) && asked.at(-1)[1].includes("지움 (새로 만든 파일)") && u.loadCps(D).length === 0, asked.at(-1));
	await cmds2.undo.handler("", ctx);
	check("기록이 없으면 알림", notes.at(-1)[0].startsWith("되돌릴 변경이 없습니다") && notes.at(-1)[0].includes(`${u.UNDO_DAYS}일`), notes.at(-1));
	await req("셋째", [[A, "v3"]], on2);
	writeFileSync(A, "사용자가 고침");
	await cmds2.undo.handler("", ctx);
	check("그 뒤에 다른 변경이 있으면 덮어쓰지 않음", readFileSync(A, "utf8") === "사용자가 고침" && notes.at(-1)[0].includes("그 뒤에 다른 변경이 있어 덮어쓰지 않음"), notes.at(-1));
	await req("넷째", [[A, "v4"]], on2);
	await req("다섯째", [[A, "v5"]], on2);
	answer = false;
	await cmds2.undo.handler("2", ctx);
	check("'아니요' 면 그대로 (기록도 그대로)", readFileSync(A, "utf8") === "v5" && u.loadCps(D).length === 2 && asked.at(-1)[0] === "되돌릴까요? (요청 2개)");
	answer = true;
	await cmds2.undo.handler("2", ctx);
	check("/undo 2: 두 요청을 최근 것부터 차례로", readFileSync(A, "utf8") === "사용자가 고침" && u.loadCps(D).length === 0, readFileSync(A, "utf8"));
	// 보관: UNDO_DAYS 일이 지난 기록, UNDO_KEEP 개를 넘는 기록은 빼고 쓰지 않는 내용 파일은 지움
	const snap = (b, a) => ({ abs: A, remote: false, label: "a.txt", before: Buffer.from(b), after: Buffer.from(a) });
	u.saveCp(D, { id: "old", t: Date.now() - (u.UNDO_DAYS + 1) * 86400_000, req: "옛", files: [snap("옛 전", "옛 후")] });
	for (let i = 0; i < u.UNDO_KEEP + 2; i++) u.saveCp(D, { id: `k${i}`, t: Date.now() - (100 - i) * 1000, req: `r${i}`, files: [snap(`b${i}`, `a${i}`)] });
	cps = u.loadCps(D);
	const bins = readdirSync(D).filter((f) => f.endsWith(".bin")).length;
	check(`보관: ${u.UNDO_DAYS}일이 지난 기록과 ${u.UNDO_KEEP}개를 넘는 오래된 기록은 빼고, 그 내용 파일도 지움`,
		cps.length === u.UNDO_KEEP && !cps.some((c) => c.id === "old" || c.id === "k0" || c.id === "k1") && cps.at(-1).id === `k${u.UNDO_KEEP + 1}` && bins === u.UNDO_KEEP * 2, [cps.length, bins]);
	delete process.env.PI_GIT_OFFER;
}

if (oldAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
else process.env.PI_CODING_AGENT_DIR = oldAgentDir;
if (oldGitOffer !== undefined) process.env.PI_GIT_OFFER = oldGitOffer;
try {
	rmSync(tmp, { recursive: true, force: true });
} catch {}
console.log(fails ? `실패 ${fails}` : "모두 통과");
process.exit(fails ? 1 : 0);
