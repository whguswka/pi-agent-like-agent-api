// 키트 훅(profiles/common/agent-template/extensions/hooks.ts) 단위 시험: 문서 규칙, /hooks, 위험 명령 확인 경고
// 사용법: node tests/test_hooks.mjs   (저장소의 runtime/node_modules/jiti 로 .ts 를, pi-tui 는 tests/stubs 의 것으로)
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "../runtime/node_modules/jiti/lib/jiti.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const jiti = createJiti(import.meta.url, { alias: { "@earendil-works/pi-tui": join(ROOT, "tests/stubs/pi-tui.mjs") } });
const tmp = mkdtempSync(join(tmpdir(), "hooks-test-"));
const AGENT = join(tmp, "agent");
const EXT = join(AGENT, "extensions");
mkdirSync(EXT, { recursive: true });
process.env.PI_CODING_AGENT_DIR = AGENT;
process.env.PI_COPILOT_USER_CONFIG = join(AGENT, "bridge.json");
const h = await jiti.import("../profiles/common/agent-template/extensions/hooks.ts");
let fails = 0;
const check = (name, cond, detail = "") => {
	console.log((cond ? "OK   " : "FAIL ") + name + (cond ? "" : `  -> ${typeof detail === "string" ? detail : JSON.stringify(detail)}`.slice(0, 700)));
	if (!cond) fails++;
};
const read = (p) => readFileSync(p, "utf8");

// ── 순수 함수 ─────────────────────────────────────────────────────────────
// 키트 확장 목록: 설치 스크립트의 KIT_EXT 는 모두 hooks.ts 의 KIT_EXT 에 있고, 저장소에 있는 확장은 모두 KIT_EXT 에 (API 키트는 PC 확장이 없음)
const shipped = ["common", "pc", "jupyter"].flatMap((p) => {
	const d = join(ROOT, "profiles", p, "agent-template", "extensions");
	return existsSync(d) ? readdirSync(d).filter((f) => /\.ts$/.test(f)) : [];
});
for (const f of ["install.sh", "update.sh", "api-kit/overlay/install.sh", "api-kit/overlay/update.sh"].filter((x) => existsSync(join(ROOT, x)))) {
	const m = read(join(ROOT, f)).match(/^KIT_EXT="([^"]*)"/m);
	const list = (m ? m[1] : "").split(/\s+/).filter((x) => x && !x.startsWith("lib/"));
	const want = f.startsWith("api-kit") ? shipped.filter((x) => !["copilot-session.ts", "jupyter.ts"].includes(x)) : shipped;
	check(`KIT_EXT: ${f} 의 목록은 모두 hooks.ts 에 있고, 저장소의 확장이 빠짐없이 (내 훅을 가리는 기준)`,
		list.every((x) => h.KIT_EXT.includes(x)) && want.every((x) => list.includes(x)) && shipped.every((x) => h.KIT_EXT.includes(x)), [list, want]);
}
check("문서: Markdown 만, 숨김 폴더·node_modules 는 뺌",
	h.isDoc("docs/a.md") && h.isDoc("x.MARKDOWN") && !h.isDoc("a.txt") && !h.isDoc(".github/x.md") && !h.isDoc("node_modules/p/README.md"));
for (const [rel, kind] of [["docs/작업이력_1022.md", "history"], ["HISTORY.md", "history"], ["진행-상황.md", "history"], ["worklog.md", "history"], ["devlog-3.md", "history"],
	["계획_v2.md", "plan"], ["plan.md", "plan"], ["release-plan.md", "plan"], ["todo.md", "plan"], ["할일.md", "plan"],
	["explanation.md", "doc"], ["planner-notes.md", "doc"], ["autodoc.md", "doc"], ["mastodon-api.md", "doc"], ["my_todo.md", "plan"], ["TODOs.md", "plan"], ["log-analysis.md", "doc"], ["설계.md", "doc"], ["README.md", "doc"]])
	check(`문서 종류: ${rel} -> ${kind}`, h.docKind(rel) === kind, h.docKind(rel));
check("규칙 밖: 목록 문서·README·지침·메모·스킬·CHANGELOG (HISTORY.md 는 tool_call 에서 따로)",
	["docs/INDEX.md", "README.md", "sub/readme.md", "AGENTS.md", "NOTES.md", "x/SKILL.md", "CHANGELOG.md"].every((r) => h.ruleFree(r, "docs/INDEX.md")) && !h.ruleFree("HISTORY.md", "docs/INDEX.md") && !h.ruleFree("docs/a.md", "docs/INDEX.md"));
check("링크 밖: 목록 문서 자신·맨 위 README·지침·메모·스킬 (하위 README·HISTORY 는 링크)",
	["docs/INDEX.md", "README.md", "AGENTS.md", "NOTES.md", "x/SKILL.md"].every((r) => h.linkFree(r, "docs/INDEX.md")) && !h.linkFree("docs/README.md", "docs/INDEX.md") && !h.linkFree("docs/HISTORY.md", "docs/INDEX.md"));
check("제목: 첫 '# 제목', 없으면 파일 이름", h.docTitle("앞글\n# 배포 계획 ##\n## 1\n", "x/a.md") === "배포 계획" && h.docTitle("본문만", "x/배포 메모.md") === "배포 메모" && h.docTitle(undefined, "a.md") === "a");
check("제목: '# 제목' 이 없는 이력 문서는 '작업 이력' (첫 줄이 '## 날짜 제목' 절)", h.docTitle("## 2026-10-22 KR 실험\n본문\n", "HISTORY.md") === "작업 이력" && h.docTitle("# 우리 이력\n", "HISTORY.md") === "우리 이력");
check("자리 표시 파일: '# placeholder … will contain …' 만 있는 글 (2026-10 ML 시험의 train_v2.py)",
	h.placeholderOnly("# placeholder\n# train_v2.py will contain the v2 feature generation, LightGBM training,\n# MLflow logging, prediction table write, and KFP pipeline entrypoint.\n# Create this file first, then submit via KFP in the next step.\n")
	&& h.placeholderOnly('"""자리 표시: 나중에 채움"""\npass\n') && h.placeholderOnly("// TODO: implement\n"));
check("자리 표시가 아님: 빈 파일, 실제 코드, 주석에 TODO 가 있는 코드, 긴 글",
	!h.placeholderOnly("") && !h.placeholderOnly("import os\nprint(1)\nx = 2\ny = 3\n# TODO: implement more\n") && !h.placeholderOnly("# 설정 파일\nlr = 0.01\n")
	&& !h.placeholderOnly(`# placeholder 설명\n${"a = 1\n".repeat(200)}`) && !h.placeholderOnly(undefined));
// 2026-10-23 ML 시험: 지침에 이름을 적어도 프로젝트에 있던 코드를 따라 wait_for_run_completion(timeout=600) 으로 기다리는 파일을 씀
check("아무것도 찍지 않고 기다리는 코드: KFP wait_for_run_completion, kubectl wait (상태를 찍는 반복·이름만 나온 글은 아님)",
	h.silentWait("completed = client.wait_for_run_completion(run.run_id, timeout=600)") === "wait_for_run_completion"
	&& h.silentWait("run.wait_for_run_completion (3600)") === "wait_for_run_completion" && h.silentWait("kubectl wait --for=condition=Ready pod/x --timeout=600s") === "kubectl wait"
	&& h.silentWait("for _ in range(20):\n    print(client.get_run(run_id).state, flush=True)\n    time.sleep(30)\n") === ""
	&& h.silentWait("# wait_for_run_completion 은 쓰지 않는다") === "" && h.silentWait(undefined) === "");
// 2026-10-23 ML 시험: 안내 문서를 먼저 읽고도 '단계 안에서 DB 를 쓰려면 먼저 사용자에게' 를 지나쳐 DB 를 읽는 단계를 바로 제출함
check("단계 안의 DB 접속: KFP 단계·파이프라인 표시와 DB 접속이 함께 있을 때만",
	h.stepDb('@dsl.component(base_image="python:3.11-slim")\ndef load():\n    from sqlalchemy import create_engine\n    e = create_engine("postgresql+psycopg2:///stock_analytics")\n')
	&& h.stepDb("@component\ndef f():\n    import psycopg2\n    c = psycopg2.connect()\n") && h.stepDb("@dsl.pipeline(name='p')\ndef p():\n    os.environ['PGPASSWORD']\n")
	&& !h.stepDb('e = create_engine("postgresql+psycopg2://")\npd.read_sql(q, e)\n') && !h.stepDb("@dsl.component\ndef add(a: int, b: int) -> int:\n    return a + b\n") && !h.stepDb(undefined));
check("새로 들어가는 글: write 는 내용, edit 는 바꿀 글만 (예전 형식도), bash 는 명령",
	h.writtenText("write", { content: "a" }) === "a" && h.writtenText("edit", { edits: [{ oldText: "x", newText: "b" }, { oldText: "y", newText: "c" }] }) === "b\nc"
	&& h.writtenText("edit", { oldText: "wait_for_run_completion(r)", newText: "d" }) === "d" && h.writtenText("bash", { command: "e" }) === "e" && h.writtenText("read", { path: "f" }) === "");
check("링크 대상: 목록 문서 폴더 기준, 빈칸은 %20", h.linkTarget("docs/INDEX.md", "docs/plans/a b.md") === "plans/a%20b.md" && h.linkTarget("docs/INDEX.md", "notes/x.md") === "../notes/x.md" && h.linkTarget("INDEX.md", "docs/y.md") === "docs/y.md");
let t = h.addLink(h.NEW_INDEX, "- [A](a.md) — d", "a.md");
t = h.addLink(t, "- [B](b.md) — d", "b.md");
check("목록: '## 문서' 절 끝에 차례로", t.endsWith("## 문서\n- [A](a.md) — d\n- [B](b.md) — d\n") && h.addLink(t, "- [A](a.md) — d", "a.md") === null, t);
const custom = "# 우리 문서\r\n\r\n## 문서\r\n- [옛](old.md)\r\n\r\n## 참고\r\n- 링크\r\n";
const c2 = h.addLink(custom, "- [새](new.md) — d", "new.md");
check("목록: 다음 절 앞에 넣고 CRLF 는 CRLF 로", c2 === "# 우리 문서\r\n\r\n## 문서\r\n- [옛](old.md)\r\n- [새](new.md) — d\r\n\r\n## 참고\r\n- 링크\r\n", c2);
check("목록: '## 문서' 절이 없으면 끝에 만듦", h.addLink("# 목록\n\n본문\n", "- [A](a.md)", "a.md") === "# 목록\n\n본문\n\n## 문서\n- [A](a.md)\n");
check("설정: 기본값 / 바꾼 값 / 이상한 값", JSON.stringify(h.docCfg({})) === JSON.stringify({ on: true, index: "docs/INDEX.md", limit: 2 })
	&& JSON.stringify(h.docCfg({ doc_rules: false, doc_index: "./notes/목록.md", doc_new_limit: 5 })) === JSON.stringify({ on: false, index: "notes/목록.md", limit: 5 })
	&& JSON.stringify(h.docCfg({ doc_index: "../x.md", doc_new_limit: -1 })) === JSON.stringify({ on: true, index: "docs/INDEX.md", limit: 2 }));
const W = join(tmp, "work");
mkdirSync(W, { recursive: true });
const local = { remote: false, cwd: W };
check("경로: 작업 폴더 기준 상대 경로, 밖이면 null", h.projectRel("docs/a.md", local) === "docs/a.md" && h.projectRel(join(W, "b.md"), local) === "b.md" && h.projectRel("../x.md", local) === null && h.projectRel(join(tmp, "y.md"), local) === null);
const nb = { remote: true, cwd: "/home/jovyan/proj", home: "/home/jovyan" };
check("경로: jupyter 모드는 노트북 경로 (~ 는 노트북 홈, C:/ 는 PC 라 null)", h.projectRel("docs/a.md", nb) === "docs/a.md" && h.projectRel("~/proj/b.md", nb) === "b.md" && h.projectRel("/home/jovyan/other/c.md", nb) === null && h.projectRel("C:/x/d.md", nb) === null);
const bt = (c) => h.docTargets("bash", { command: c }).map((x) => x.path).join(",");
check("bash 로 만드는 문서: > 파일, >> 파일, tee (Markdown 만, /dev/null·따옴표 안은 뺌)",
	bt("cat > docs/a.md <<'EOF'\n# A\nEOF") === "docs/a.md" && bt("echo x >> b.md && tee -a c.md d.txt < x") === "b.md,c.md" && bt("cat a.md > /dev/null") === "" && bt('echo "> e.md"') === "", [bt("echo x >> b.md && tee -a c.md d.txt < x")]);
check("write 의 문서와 내용", JSON.stringify(h.docTargets("write", { path: "a.md", content: "# A" })) === JSON.stringify([{ path: "a.md", content: "# A" }]) && h.docTargets("read", { path: "a.md" }).length === 0);
// bash 가 쓰는 파일 (문서 규칙·문법 확인·팀 규칙이 함께 씀): 앞의 cd 를 따라 경로를 붙임 (2026-10-27 실사용 시험: 'cd <폴더> && cat > tools/x.py <<'PY'')
const shell = await jiti.import("../profiles/common/agent-template/extensions/lib/shell.ts");
const wp = (c) => shell.writtenPaths(c).join(",");
check("bash 가 쓰는 파일: 리다이렉트·tee, cd 를 따라 (상대·절대), $변수 경로와 /dev/null·2>&1 은 뺌",
	wp("cat > a.py <<'PY'\nprint(1)\nPY") === "a.py" && wp("cd tools && cat > x.py <<EOF\nx = (\nEOF\npython x.py") === "tools/x.py"
	&& wp("cd /home/jovyan/w && echo 1 > a.json; cd sub && tee -a b.yaml < in") === "/home/jovyan/w/a.json,/home/jovyan/w/sub/b.yaml"
	&& wp('cat > "$OUT/x.py" <<EOF\nEOF') === "" && wp("make 2>&1 > /dev/null") === "" && wp("cd $X && echo > a.py") === "a.py" && wp("cd C:/w && echo > b.py") === "C:/w/b.py",
	[wp("cd /home/jovyan/w && echo 1 > a.json; cd sub && tee -a b.yaml < in"), wp("cd $X && echo > a.py")]);

// ── 가짜 pi 로 이벤트 차례대로 ───────────────────────────────────────────────
function fakePi() {
	const handlers = {};
	const commands = {};
	const entries = [];
	const pi = { on: (e, f) => (handlers[e] ||= []).push(f), registerCommand: (n, o) => (commands[n] = o), registerEntryRenderer: () => {}, appendEntry: (_t, d) => entries.push(d) };
	const emit = async (e, ev, ctx) => {
		let r;
		for (const f of handlers[e] || []) {
			const x = await f(ev, ctx);
			if (x !== undefined) r = x;
		}
		return r;
	};
	return { pi, commands, entries, emit };
}
function fakeCtx(answers = [], opts = {}) {
	const log = [];
	const status = {};
	return {
		log, status, answers, hasUI: opts.hasUI !== false, mode: "tui", cwd: W,
		ui: {
			confirm: async (title) => {
				log.push(title);
				return answers.length ? answers.shift() : true;
			},
			// 고르기 창 (완료 점검 동의): true = 첫 답(예), false = 둘째(아니요), "skip" = 셋째(이번만 건너뛰기), "esc" = 닫기
			select: async (title, options) => {
				log.push(title.startsWith("완료 점검") ? "완료 점검" : title);
				const a = answers.length ? answers.shift() : true;
				return a === true ? options[0] : a === false ? options[1] : a === "skip" ? options[2] : a === "esc" ? undefined : a;
			},
			notify: (m) => log.push(`알림:${m}`),
			setStatus: (k, v) => (status[k] = v),
		},
		reload: async () => log.push("reload"),
	};
}
const F = fakePi();
(globalThis.__piDocRules = undefined);
h.default(F.pi);
globalThis.__piWorkDir = local;
globalThis.__piMode = "auto";
let n = 0;
/** 도구 하나: tool_call -> (막히지 않았으면) 파일을 씀 -> tool_result. 결과에 붙은 안내를 돌려줌 */
async function tool(ctx, toolName, input, make) {
	const id = `t${++n}`;
	const r = await F.emit("tool_call", { toolName, toolCallId: id, input }, ctx);
	if (r?.block) return { blocked: r.reason };
	make?.();
	const res = await F.emit("tool_result", { toolName, toolCallId: id, input, content: [{ type: "text", text: "ok" }], isError: false }, ctx);
	return { note: (res?.content || []).slice(1).map((c) => c.text).join("\n") };
}
const writeDoc = (ctx, rel, content = `# ${rel} 제목\n`, cwd = W) =>
	tool(ctx, "write", { path: rel, content }, () => {
		mkdirSync(dirname(join(cwd, rel)), { recursive: true });
		writeFileSync(join(cwd, rel), content);
	});
const request = () => F.emit("agent_start", {}, fakeCtx());
const INDEX = join(W, "docs/INDEX.md");

await F.emit("session_start", { reason: "startup" }, fakeCtx());
await request();
let ctx = fakeCtx([true]);
let r = await writeDoc(ctx, "docs/plans/a.md", "# 배포 계획 A\n본문\n");
check("새 문서: 목록이 없으면 한 번 묻고 만들어 링크 (결과에 안내)", existsSync(INDEX) && read(INDEX).includes("- [배포 계획 A](plans/a.md) — ") && ctx.log.join() === "문서 목록" && r.note.includes("docs/INDEX.md 에 링크"), [ctx.log, r]);
r = await writeDoc(ctx, "notes/b.md");
check("두 번째 새 문서: 묻지 않고 링크 (목록 폴더 기준 ../)", read(INDEX).includes("(../notes/b.md)") && ctx.log.length === 1, ctx.log);
ctx = fakeCtx([false]);
r = await writeDoc(ctx, "c.md");
check("세 번째 새 문서: 한 번 묻고, 아니요면 막고 이유를 모델에게", r.blocked?.includes("사용자 문서 규칙") && r.blocked.includes("docs/plans/a.md") && ctx.log.join() === "새 문서가 많습니다" && !existsSync(join(W, "c.md")), [r, ctx.log]);
globalThis.__piReview = "running"; // /review 중: 쓰기는 modes.ts 가 막으므로 여기서는 묻지도 막지도 않음
r = await F.emit("tool_call", { toolName: "write", toolCallId: "rv", input: { path: "rv.md", content: "# 리뷰\n" } }, ctx);
globalThis.__piReview = undefined;
check("리뷰 중: 문서 규칙은 묻지 않음", r === undefined && ctx.log.length === 1, [r, ctx.log]);
r = await writeDoc(ctx, "d.md");
check("네 번째: 다시 묻지 않고 같은 답으로 막음", !!r.blocked && ctx.log.length === 1, ctx.log);
r = await tool(ctx, "read", { path: "c.md" });
check("읽기는 보지 않음", !r.blocked && !r.note);
r = await writeDoc(ctx, "docs/plans/a.md", "# 배포 계획 A\n고침\n");
check("있는 문서를 다시 쓰기: 규칙 밖, 목록 그대로", !r.blocked && !r.note && (read(INDEX).match(/plans\/a\.md/g) || []).length === 1, read(INDEX));

await request();
ctx = fakeCtx([true]);
r = await writeDoc(ctx, "e.md");
check("다음 요청: 개수를 다시 셈 (묻지 않고 만들고 링크)", !r.blocked && ctx.log.length === 0 && read(INDEX).includes("(../e.md)"), ctx.log);
r = await writeDoc(ctx, "docs/작업이력_1022.md");
check("이력 문서: HISTORY 에 이어 쓰게 할지 묻고, 예면 막고 docs/HISTORY.md 로", r.blocked?.includes("docs/HISTORY.md") && ctx.log.join() === "이력 문서", [r, ctx.log]);
r = await writeDoc(ctx, "docs/HISTORY.md", "# 작업 이력\n\n## 2026-10-22 시작\n");
check("이력 파일 자신: 묻지 않고 만들고 목록에 링크 (개수에 넣지 않음)", !r.blocked && ctx.log.length === 1 && read(INDEX).includes("- [작업 이력](HISTORY.md)"), [ctx.log, read(INDEX)]);
await request();
ctx = fakeCtx([true]);
r = await writeDoc(ctx, "HISTORY.md");
check("다른 곳의 HISTORY.md: 이력 문서로 보고 있는 이력 파일(docs/HISTORY.md)로", r.blocked?.includes("docs/HISTORY.md") && ctx.log.join() === "이력 문서", [r, ctx.log]);

await request();
ctx = fakeCtx([false]);
r = await writeDoc(ctx, "plan-a.md");
check("첫 계획 문서: 묻지 않음", !r.blocked && ctx.log.length === 0);
await request();
r = await writeDoc(ctx, "plan-b.md");
check("같은 세션의 두 번째 계획 문서: 묻고, 아니요면 막고 첫 계획 문서를 고치게", r.blocked?.includes("plan-a.md") && ctx.log.join() === "계획 문서", [r, ctx.log]);

// 새 프로젝트에서 지침대로 맨 위 HISTORY.md 를 처음 만들 때: 묻지 않고 그것을 이력 파일로 (없는 docs/HISTORY.md 로 돌리지 않음)
{
	const W3 = join(tmp, "work3");
	mkdirSync(W3, { recursive: true });
	globalThis.__piWorkDir = { remote: false, cwd: W3 };
	await request();
	ctx = fakeCtx([true]);
	r = await writeDoc(ctx, "HISTORY.md", "# 작업 이력\n", W3);
	check("새 프로젝트의 맨 위 HISTORY.md: 이력 질문 없이 만들고 목록에 링크 (개수에 넣지 않음)",
		!r.blocked && !ctx.log.includes("이력 문서") && read(join(W3, "docs/INDEX.md")).includes("- [작업 이력](../HISTORY.md)"), [ctx.log, r]);
	r = await writeDoc(ctx, "docs/작업이력.md", "# x\n", W3);
	check("그다음 이력 문서는 맨 위 HISTORY.md 로 돌림", r.blocked?.includes("HISTORY.md 하나에") && !r.blocked.includes("docs/HISTORY.md") && ctx.log.includes("이력 문서"), [r, ctx.log]);
	globalThis.__piWorkDir = local;
}

// 동시에 (한 답의 도구 호출 여럿): 묻는 것은 한 번
await request();
ctx = fakeCtx([false]);
await writeDoc(ctx, "p1.md");
await writeDoc(ctx, "p2.md");
const both = await Promise.all([writeDoc(ctx, "p3.md"), writeDoc(ctx, "p4.md")]);
check("동시에 온 새 문서 둘: 한 번만 묻고 둘 다 같은 답", both.every((x) => x.blocked) && ctx.log.filter((x) => x === "새 문서가 많습니다").length === 1, [both, ctx.log]);

// bash 로 만든 문서도 같게
await request();
ctx = fakeCtx();
r = await tool(ctx, "bash", { command: "cat > docs/f.md <<'EOF'\n# bash 로 쓴 문서\nEOF" }, () => writeFileSync(join(W, "docs/f.md"), "# bash 로 쓴 문서\n"));
check("bash 로 만든 문서: 목록에 링크 (제목은 파일의 첫 제목)", read(INDEX).includes("- [bash 로 쓴 문서](f.md)") && r.note.includes("docs/f.md"), [r, read(INDEX)]);
r = await tool(ctx, "bash", { command: "echo x > docs/g.md" });
check("bash 명령이 파일을 만들지 못했으면 링크하지 않음", !read(INDEX).includes("g.md") && !r.note);

// 화면이 없을 때 (pi -p): 묻지도 막지도 않고 안내만, 목록 문서는 만들지 않음
const W2 = join(tmp, "work2");
mkdirSync(W2, { recursive: true });
globalThis.__piWorkDir = { remote: false, cwd: W2 };
await request();
ctx = fakeCtx([], { hasUI: false });
await writeDoc(ctx, "x1.md", "# 1", W2);
await writeDoc(ctx, "x2.md", "# 2", W2);
const x3 = await writeDoc(ctx, "x3.md", "# 3", W2);
const xh = await writeDoc(ctx, "변경이력.md", "# h", W2);
check("화면 없음: 막지 않고 결과에 안내 (개수·이력), 목록은 만들지 않음",
	!x3.blocked && x3.note.includes("3개째") && !xh.blocked && xh.note.includes("HISTORY.md") && existsSync(join(W2, "x3.md")) && !existsSync(join(W2, "docs/INDEX.md")) && ctx.log.length === 0 && x3.note.includes("링크를 달지 않았습니다"), [x3, xh, ctx.log]);

// 확인 모드: 묻지 않고 안내, 목록 링크는 함 / 계획 모드: 아무것도 안 함
globalThis.__piWorkDir = local;
globalThis.__piMode = "ask";
await request();
ctx = fakeCtx();
await writeDoc(ctx, "k1.md");
await writeDoc(ctx, "k2.md");
r = await writeDoc(ctx, "k3.md");
check("확인 모드: 묻지 않고 안내, 목록 링크는 함", !r.blocked && r.note.includes("3개째") && read(INDEX).includes("(../k3.md)") && ctx.log.length === 0, [r, ctx.log]);
globalThis.__piMode = "plan";
r = await writeDoc(ctx, "planmode.md");
check("계획 모드: 보지 않음", !r.note && !read(INDEX).includes("planmode"));
globalThis.__piMode = "auto";

// jupyter 모드 (노트북 파일은 jupyter.ts 가 여는 기능으로)
const files = new Map();
globalThis.__piRemoteFs = {
	stat: async (p) => {
		if (!files.has(p)) throw Object.assign(new Error("없음"), { code: "ENOENT" });
		return { kind: "file" };
	},
	read: async (p) => {
		if (!files.has(p)) throw Object.assign(new Error("없음"), { code: "ENOENT" });
		return files.get(p);
	},
	write: async (p, text) => void files.set(p, text),
};
globalThis.__piWorkDir = nb;
await request();
ctx = fakeCtx([true]);
r = await tool(ctx, "write", { path: "docs/r.md", content: "# 노트북 문서\n" }, () => files.set("/home/jovyan/proj/docs/r.md", "# 노트북 문서\n"));
check("jupyter 모드: 노트북의 docs/INDEX.md 를 만들어 링크", (files.get("/home/jovyan/proj/docs/INDEX.md") || "").includes("- [노트북 문서](r.md)") && ctx.log.join() === "문서 목록", [ctx.log, [...files.keys()]]);
globalThis.__piRemoteFs = { stat: async () => { throw new Error("중계 서버 연결 안 됨"); }, read: async () => null, write: async () => {} };
r = await tool(ctx, "write", { path: "docs/s.md", content: "# s" });
check("노트북에 닿지 않으면 보지 않음 (막지 않음)", !r.blocked && !r.note);
globalThis.__piWorkDir = local;

// 자리 표시 파일: 막지 않고 결과에 안내 (문서가 아닌 .py 도)
await request();
ctx = fakeCtx();
r = await tool(ctx, "write", { path: "train_v2.py", content: "# placeholder\n# train_v2.py will contain the training code.\n" }, () => writeFileSync(join(W, "train_v2.py"), "# placeholder\n"));
check("자리 표시 내용만 쓰면 결과에 안내 (막지 않음)", !r.blocked && r.note === h.PLACEHOLDER_NOTE, r);
r = await tool(ctx, "write", { path: "train_v2.py", content: "import pandas as pd\nprint(pd.__version__)\n" }, () => writeFileSync(join(W, "train_v2.py"), "import pandas as pd\n"));
check("실제 내용이면 안내 없음", !r.blocked && !r.note, r);
// 아무것도 찍지 않고 기다리는 코드: 막지 않고 결과에 안내, 세션마다 파일마다 한 번
const KFP = "run = client.create_run_from_pipeline_func(p)\ncompleted = client.wait_for_run_completion(run.run_id, timeout=600)\n";
r = await tool(ctx, "write", { path: "kfp_two_step_test.py", content: KFP }, () => writeFileSync(join(W, "kfp_two_step_test.py"), KFP));
check("기다리는 코드를 쓰면 결과에 안내 (막지 않음, 30초마다 상태를 찍게)", !r.blocked && r.note === h.waitNote("wait_for_run_completion") && r.note.includes("30초마다"), r);
r = await tool(ctx, "edit", { path: "kfp_two_step_test.py", edits: [{ oldText: "600", newText: "wait_for_run_completion(run.run_id, timeout=300)" }] });
check("같은 파일은 다시 알리지 않음", !r.blocked && !r.note, r);
r = await tool(ctx, "bash", { command: "python -u - <<'EOF'\nclient.wait_for_run_completion(rid, timeout=600)\nEOF" });
check("bash 의 heredoc 도 한 번 알림", r.note === h.waitNote("wait_for_run_completion"), r);
r = await tool(ctx, "write", { path: "other.py", content: "import time\nprint(1, flush=True)\n" });
check("기다리는 코드가 없으면 안내 없음", !r.note, r);
const DBSTEP = "@dsl.component\ndef load(out: Output[Dataset]):\n    e = create_engine('postgresql+psycopg2:///stock_analytics')\n";
r = await tool(ctx, "write", { path: "kfp_kr_lgbm_pipeline.py", content: DBSTEP + KFP });
check("단계 안에서 DB 에 접속하는 파이프라인 파일: 사용자에게 먼저 알리라는 안내 (기다리는 코드 안내와 함께, 막지 않음)",
	!r.blocked && r.note === `${h.waitNote("wait_for_run_completion")}\n${h.STEP_DB_NOTE}` && r.note.includes("사용자에게 알리고"), r);
r = await tool(ctx, "edit", { path: "kfp_kr_lgbm_pipeline.py", edits: [{ oldText: "x", newText: DBSTEP }] });
check("같은 파일은 DB 안내도 다시 하지 않음", !r.note, r);
await F.emit("session_start", { reason: "new" }, fakeCtx());
r = await tool(fakeCtx(), "write", { path: "kfp_two_step_test.py", content: KFP });
check("새 세션에서는 다시 알림", r.note === h.waitNote("wait_for_run_completion"), r);

// 끄기, 지침
writeFileSync(join(AGENT, "bridge.json"), JSON.stringify({ doc_rules: false }));
await request();
ctx = fakeCtx();
r = await writeDoc(ctx, "off.md");
const g1 = { systemPromptOptions: { promptGuidelines: [] } };
await F.emit("before_agent_start", g1, ctx);
check("doc_rules false: 링크·지침 없음", !r.note && !read(INDEX).includes("off.md") && g1.systemPromptOptions.promptGuidelines.length === 0);
writeFileSync(join(AGENT, "bridge.json"), "{}");
const g2 = { systemPromptOptions: { promptGuidelines: ["기존"] } };
await F.emit("before_agent_start", g2, ctx);
await F.emit("before_agent_start", g2, ctx);
check("지침: 문서 규칙 한 줄 (두 번 넣지 않음, 늘 같은 글)", JSON.stringify(g2.systemPromptOptions.promptGuidelines) === JSON.stringify(["기존", h.DOC_GUIDE]) && h.DOC_GUIDE.length <= 300);
check("대화창 [문서] 항목", F.entries.some((e) => e.lines.some((l) => l.includes("→ docs/INDEX.md 에 링크"))) && F.entries.some((e) => e.lines.some((l) => l.includes("대신 docs/HISTORY.md"))), F.entries.slice(0, 3));

// 계획 모드에서 쓰는 계획서(modes.ts 가 계획서만 쓰기를 엶)도 목록에 링크. 계획서가 아닌 문서는 계획 모드가 막으므로 보지 않음
globalThis.__piMode = "plan";
await request();
ctx = fakeCtx([]);
r = await writeDoc(ctx, "docs/plans/계획모드-정리.md", "# 정리 계획\n1. a\n2. b\n");
const nIdx = read(INDEX);
const r2 = await tool(ctx, "write", { path: "notes/memo-plan-mode.md", content: "# 메모" });
globalThis.__piMode = "auto";
check("계획 모드: 계획서는 목록에 링크, 계획서가 아닌 문서는 보지 않음 (계획 모드가 막음)",
	nIdx.includes("](plans/%EA%B3%84%ED%9A%8D%EB%AA%A8%EB%93%9C-%EC%A0%95%EB%A6%AC.md)") || nIdx.includes("](plans/계획모드-정리.md)"), [r, nIdx.slice(-300)]);
check("계획 모드: 계획서가 아닌 문서는 규칙·링크 없음", !r2.note && !read(INDEX).includes("memo-plan-mode"), r2);

// ── 완료 점검 (.pi/checks.json) ─────────────────────────────────────────────
// 2026-10 모델 운영 시험: 표준 스킬을 읽고도 5단계 시험을 끝내지 않고 끝나지 않은 실행 기록을 남긴 채 마침
const pc = h.parseChecks;
check("점검 목록: 객체·배열 형식, when 은 글 하나도, 이름이 없으면 명령, timeout 은 5~600 (기본 120)",
	JSON.stringify(pc('﻿{"checks":[{"name":"표준","when":["models/**"],"run":"python t.py","timeout":9999}]}')) === JSON.stringify([{ name: "표준", when: ["models/**"], run: "python t.py", timeout: 600 }])
	&& JSON.stringify(pc('[{"when":"src/","run":"make check"}]')) === JSON.stringify([{ name: "make check", when: ["src/"], run: "make check", timeout: 120 }]), pc('[{"when":"src/","run":"make check"}]'));
check("점검 목록: run·when 이 없는 항목, 틀린 JSON, 빈 글은 뺌",
	pc('{"checks":[{"when":["a"]},{"run":"x"},{"run":" ","when":["a"]},{"run":"y","when":[]}]}').length === 0 && pc("{틀림").length === 0 && pc(null).length === 0 && pc('{"x":1}').length === 0);
const m = h.matchesAny;
check("glob: ** 는 여러 폴더, * 는 한 폴더 안, 와일드카드가 없으면 그 파일·폴더 아래",
	m("models/kr/steps.py", ["models/**"]) && !m("modelsx/a.py", ["models/**"]) && m("common/dates.py", ["common/*.py"]) && !m("common/sub/x.py", ["common/*.py"])
	&& m("a.py", ["**/*.py"]) && m("x/y/z.py", ["**/*.py"]) && !m("x/y/z.txt", ["**/*.py"]) && m("docs/a.md", ["docs"]) && m("docs", ["docs"]) && !m("docsx", ["docs"])
	&& m("tools/x.py", ["tools/"]) && m("./models/a", ["models/**"].map((g) => g)) === false && m("models/a?b", ["models/a?b"]) && m("models/k/a.py", ["models/*/a.py"]));
check("바뀐 파일을 찾을 폴더: glob 앞쪽의 폴더 (처음부터 와일드카드면 작업 폴더 전체, 안쪽 폴더는 합침)",
	JSON.stringify(h.globRoots(["models/**", "common/*.py"])) === JSON.stringify(["common", "models"]) && JSON.stringify(h.globRoots(["**/*.py", "models/**"])) === JSON.stringify(["."])
	&& JSON.stringify(h.globRoots(["models/**", "models/kr/*.py", "setup.cfg"])) === JSON.stringify(["models", "setup.cfg"]) && JSON.stringify(h.globRoots(["../x/**"])) === JSON.stringify(["."]));
const fc = h.findChangedCmd(["common", "models"], 60);
check("노트북에서 찾는 명령: 노트북 시계로 '요청이 시작된 뒤' (2초 여유), .git·__pycache__ 는 건너뜀",
	fc.includes("find 'common' 'models'") && fc.includes('-newermt "@$t"') && fc.includes("$(date +%s) - 62") && fc.includes("-name .git -o") && fc.includes("-name __pycache__"), fc);
const CW = join(tmp, "chk");
mkdirSync(join(CW, "src", "node_modules"), { recursive: true });
mkdirSync(join(CW, "other"), { recursive: true });
for (const f of ["src/old.py", "src/new.py", "src/node_modules/x.js", "other/new.txt"]) writeFileSync(join(CW, f), "x");
const { utimesSync } = await import("node:fs");
const old = new Date(Date.now() - 3600 * 1000);
utimesSync(join(CW, "src/old.py"), old, old);
check("PC 에서 찾기: 그 뒤에 고친 파일만 (node_modules 는 건너뜀)", JSON.stringify(h.localChanged(CW, ["src"], Date.now() - 60000)) === JSON.stringify(["src/new.py"]), h.localChanged(CW, ["src"], Date.now() - 60000));
const fu = h.followUpText([{ check: { name: "표준", when: ["a"], run: "python t.py", timeout: 9 }, code: 1, out: `${"앞".repeat(3000)}\nFAIL kr_brk20\n  - 끝나지 않은 실행` }]);
check("pi 에게 보내는 요청: 점검 이름·명령·종료 코드, 출력 끝부분, 관계된 것만 고치고 승인이 필요한 것은 묻기",
	fu.startsWith("[완료 점검]") && fu.includes("## 표준 (python t.py → 종료 코드 1)") && fu.includes("FAIL kr_brk20") && fu.includes("…") && fu.length < 3200
	&& fu.includes("같은 점검 명령으로 다시 확인") && fu.includes("사용자 승인이 필요한 것") && fu.includes("관계없는 항목은 고치지 말고")
	&& fu.includes("고친 뒤 다시 실행해 결과를 보세요") && fu.includes("고치기 전에 돌린 결과로 확인했다고 쓰지 마세요")
	&& fu.includes("이번 요청에서 만든 임시 파일·기록을 정리하는 것은 고칠 일"), fu.slice(-400));

// 가짜 pi 로: 요청 끝 -> (처음이면 묻고) 점검 -> 실패면 pi 에게 한 번 -> 그 요청이 끝나면 다시 점검해 알림
const sent = [];
F.pi.sendUserMessage = (t) => sent.push(t);
globalThis.__piWorkDir = { remote: false, cwd: CW };
mkdirSync(join(CW, ".pi"), { recursive: true });
writeFileSync(join(CW, ".pi", "checks.json"), JSON.stringify({ checks: [{ name: "점검A", when: ["src/**"], run: 'echo "flag=$(cat flag.txt)"; test "$(cat flag.txt)" = ok', timeout: 30 }] }));
const waitFor = async (cond, ms = 15000) => {
	const end = Date.now() + ms;
	while (!cond() && Date.now() < end) await new Promise((ok) => setTimeout(ok, 50));
	return cond();
};
const idleWait = () => new Promise((ok) => setTimeout(ok, 300));
/** 요청 하나: 시작 -> 도구(쓰기) -> 끝(stopReason) -> 다 끝남. 점검이 따로 돌므로 그 결과(알림·보낸 요청)를 기다림 (none: 아무 일도 없어야 할 때는 잠깐만) */
async function doneReq(ctx, { write, flag, stop = "stop", tool = "write", none = false, bash = false } = {}) {
	await F.emit("agent_start", {}, ctx);
	if (bash) await F.emit("tool_call", { toolName: "bash", toolCallId: `c${++n}`, input: { command: "python run.py" } }, ctx); // 파일은 바꾸지 않는 명령
	if (write) {
		await F.emit("tool_call", { toolName: tool, toolCallId: `c${++n}`, input: { path: write, content: "x" } }, ctx);
		mkdirSync(dirname(join(CW, write)), { recursive: true });
		writeFileSync(join(CW, write), `x${n}`);
	}
	if (flag !== undefined) writeFileSync(join(CW, "flag.txt"), flag);
	await F.emit("agent_end", { messages: [{ role: "user" }, { role: "assistant", stopReason: stop }] }, ctx);
	const before = ctx.log.length + sent.length;
	await F.emit("agent_settled", {}, ctx);
	await waitFor(() => ctx.log.length + sent.length > before, none ? 1200 : 15000);
	await idleWait();
}
ctx = fakeCtx([true]);
await doneReq(ctx, { write: "src/a.py", flag: "bad" });
const st1 = JSON.parse(read(join(AGENT, "doc-rules.json"))).checks;
check("처음: 프로젝트·명령마다 한 번 묻고(바뀐 파일 보여 줌), 예면 남김",
	ctx.log[0] === "완료 점검" && Object.keys(st1).length === 1 && Object.values(Object.values(st1)[0])[0] === "yes", [ctx.log, st1]);
check("실패: pi 에게 한 번 보냄 (점검 이름·출력), 사용자에게도 알림",
	sent.length === 1 && sent[0].includes("[완료 점검]") && sent[0].includes("점검A") && sent[0].includes("flag=bad") && ctx.log.some((x) => x.startsWith("알림:완료 점검 실패: 점검A → pi 에게")), [sent, ctx.log]);
ctx = fakeCtx([]);
await doneReq(ctx, { flag: "ok" }); // pi 가 고친 요청 (파일을 바꾸지 않아도 다시 점검)
check("보낸 요청이 끝나면 다시 점검: 통과를 알리고 더 보내지 않음 (다시 묻지 않음)",
	ctx.log.includes("알림:완료 점검 통과: 점검A (고친 뒤 다시 확인)") && !ctx.log.includes("완료 점검") && sent.length === 1, [ctx.log, sent.length]);
await new Promise((ok) => setTimeout(ok, 1200)); // 앞 요청이 쓴 파일이 이 요청의 시작(1초 여유)보다 앞서게
ctx = fakeCtx([]);
await doneReq(ctx, { write: "other/x.txt", flag: "bad", none: true });
check("when 에 맞는 파일을 바꾸지 않은 요청: 점검하지 않음", ctx.log.length === 0 && sent.length === 1, ctx.log);
ctx = fakeCtx([]);
await doneReq(ctx, { write: "src/b.py", flag: "bad" });
check("다시 실패하면 pi 에게 한 번", sent.length === 2, sent.length);
ctx = fakeCtx([]);
await doneReq(ctx, { flag: "bad" });
check("고친 뒤에도 실패: 사용자에게만 알리고 더 되풀이하지 않음",
	ctx.log.some((x) => x.startsWith("알림:완료 점검이 아직 실패합니다: 점검A") && x.includes("flag=bad") && x.includes("/hooks off checks")) && sent.length === 2, [ctx.log, sent.length]);
// 고친 뒤에도 실패한 점검: 뒤 요청에서 파일이 바뀌지 않았어도 다시 돌려 알리기만 (같은 결과는 알리지 않음, pi 에게 보내지 않음)
ctx = fakeCtx([]);
await doneReq(ctx, { flag: "bad", bash: true, none: true });
check("남은 점검: 결과가 같으면 다시 알리지 않음", ctx.log.length === 0 && sent.length === 2, ctx.log);
ctx = fakeCtx([]);
await doneReq(ctx, { flag: "ok", bash: true });
check("남은 점검: 사용자의 다음 요청(파일은 그대로)으로 해결되면 통과를 알림",
	ctx.log.includes("알림:완료 점검 통과: 점검A (앞 요청에서 실패했던 점검)") && sent.length === 2, [ctx.log, sent.length]);
ctx = fakeCtx([]);
await doneReq(ctx, { flag: "bad", bash: true, none: true });
check("통과한 뒤에는 남은 점검이 없어 파일을 바꾸지 않은 요청은 점검하지 않음", ctx.log.length === 0 && sent.length === 2, ctx.log);
ctx = fakeCtx([]);
await doneReq(ctx, { write: "src/c.py", flag: "bad", stop: "aborted", none: true });
check("Esc·오류·거부로 멈춘 요청은 점검하지 않음", ctx.log.length === 0 && sent.length === 2, ctx.log);
globalThis.__piMode = "plan";
ctx = fakeCtx([]);
await doneReq(ctx, { write: "src/d.py", flag: "bad", none: true });
globalThis.__piMode = "auto";
check("계획 모드에서는 하지 않음", ctx.log.length === 0 && sent.length === 2, ctx.log);
for (const r of ["running", "done"]) {
	globalThis.__piReview = r; // /review 의 요청 (읽기만 하는 bash 를 써도): 고칠지는 리뷰 뒤에 물으므로 점검하지 않음
	ctx = fakeCtx([]);
	await doneReq(ctx, { write: "src/d.py", flag: "bad", tool: "bash", none: true });
	globalThis.__piReview = undefined;
	check(`리뷰(${r}) 요청 뒤에는 하지 않음`, ctx.log.length === 0 && sent.length === 2, ctx.log);
}
ctx = fakeCtx([], { hasUI: false });
await doneReq(ctx, { write: "src/e.py", flag: "bad", none: true });
check("화면이 없는 실행(pi -p)에서는 하지 않음", ctx.log.length === 0 && sent.length === 2, ctx.log);
writeFileSync(join(AGENT, "bridge.json"), JSON.stringify({ done_checks: false }));
ctx = fakeCtx([]);
await doneReq(ctx, { write: "src/f.py", flag: "bad", none: true });
check('"done_checks": false 면 하지 않음', ctx.log.length === 0 && sent.length === 2, ctx.log);
writeFileSync(join(AGENT, "bridge.json"), "{}");
ctx = fakeCtx([]);
await doneReq(ctx, { write: "src/g.py", flag: "ok", tool: "bash" });
check("bash 로 바꾼 파일도 (고친 시각으로 찾음), 통과면 알림만", ctx.log.includes("알림:완료 점검 통과: 점검A") && sent.length === 2, ctx.log);
// 명령이 바뀌면 다시 묻고, 아니요면 돌리지 않고 남김 (다음에는 묻지도 돌리지도 않음)
writeFileSync(join(CW, ".pi", "checks.json"), JSON.stringify([{ name: "점검B", when: "src/", run: "exit 3" }]));
ctx = fakeCtx([false]);
await doneReq(ctx, { write: "src/h.py" });
const st2 = Object.values(JSON.parse(read(join(AGENT, "doc-rules.json"))).checks)[0];
check("명령이 바뀌면 다시 묻고, 아니요면 돌리지 않음", ctx.log.length === 1 && ctx.log[0] === "완료 점검" && sent.length === 2 && Object.values(st2).includes("no"), [ctx.log, st2]);
ctx = fakeCtx([]);
await F.emit("agent_start", {}, ctx);
await F.emit("tool_call", { toolName: "write", toolCallId: `c${++n}`, input: { path: "src/i.py" } }, ctx);
writeFileSync(join(CW, "src/i.py"), "x");
await F.emit("agent_end", { messages: [{ role: "assistant", stopReason: "stop" }] }, ctx);
await F.emit("agent_settled", {}, ctx);
await new Promise((ok) => setTimeout(ok, 1500));
check("아니요라고 답한 명령은 다시 묻지도 돌리지도 않음", ctx.log.length === 0 && sent.length === 2, ctx.log);
// /hooks on checks: 이 프로젝트에서 '아니요' 로 남긴 동의를 지워 다시 묻게 (릴리스 전 검토: Esc 한 번에 영원히 꺼졌음)
ctx = fakeCtx([]);
await F.commands.hooks.handler("on checks", ctx);
check("/hooks on checks: 이 프로젝트의 '아니요' 를 지우고 알림", ctx.log.some((x) => x.includes("다음에 다시 묻습니다")) && !Object.values(Object.values(JSON.parse(read(join(AGENT, "doc-rules.json"))).checks)[0]).includes("no"), ctx.log);
for (const [ans, what] of [["esc", "닫기(Esc)"], ["skip", "이번만 건너뛰기"]]) {
	ctx = fakeCtx([ans]);
	await doneReq(ctx, { write: `src/k-${ans}.py`, none: true });
	const { createHash } = await import("node:crypto");
	const kept = Object.values(JSON.parse(read(join(AGENT, "doc-rules.json"))).checks)[0];
	const idB = createHash("sha256").update("exit 3").digest("hex").slice(0, 16);
	check(`동의 창을 ${what}: 돌리지 않고 남기지도 않음 (다음에 다시 물음)`, ctx.log[0] === "완료 점검" && sent.length === 2 && !(idB in kept), [ctx.log, kept]);
}
// 점검이 도는 동안 다른 요청이 시작하고 끝나면: 앞 요청의 결과는 pi 에게 보내지 않고, 그 요청의 점검은 버리지 않고 이어서 (릴리스 전 검토)
writeFileSync(join(CW, ".pi", "checks.json"), JSON.stringify({ checks: [{ name: "느린점검", when: ["src/**"], run: "sleep 2; echo FAIL; exit 1", timeout: 30 }] }));
{
	let idle = true;
	ctx = fakeCtx([true, true]);
	ctx.isIdle = () => idle;
	const before = sent.length;
	const req = async (file) => {
		idle = false;
		await F.emit("agent_start", {}, ctx);
		await F.emit("tool_call", { toolName: "write", toolCallId: `c${++n}`, input: { path: file } }, ctx);
		writeFileSync(join(CW, file), `x${n}`);
		await F.emit("agent_end", { messages: [{ role: "assistant", stopReason: "stop" }] }, ctx);
		idle = true;
		await F.emit("agent_settled", {}, ctx);
	};
	await req("src/r1.py");
	await new Promise((ok) => setTimeout(ok, 400)); // 첫 점검이 도는 중
	await req("src/r2.py");
	await waitFor(() => sent.length > before, 15000);
	await new Promise((ok) => setTimeout(ok, 500));
	check("점검 중에 다른 요청이 끝남: 앞 요청 결과는 알리기만, 뒤 요청의 점검을 이어서 해 pi 에게 한 번만",
		sent.length === before + 1 && ctx.log.some((x) => x.includes("새 요청 중이라 pi 에게 보내지 않았습니다")), [sent.length - before, ctx.log]);
}
rmSync(join(CW, ".pi", "checks.json"));
ctx = fakeCtx([]);
const sentNow = sent.length;
await doneReq(ctx, { write: "src/j.py", none: true });
check(".pi/checks.json 이 없으면 아무것도 하지 않음", ctx.log.length === 0 && sent.length === sentNow, ctx.log);
globalThis.__piWorkDir = local;

// ── /hooks, 위험 명령 확인 경고 ───────────────────────────────────────────────
for (const f of ["guard.ts", "kit.ts", "hooks.ts", "my-plan.ts", "foo.js", "old.ts.off"]) writeFileSync(join(EXT, f), "");
mkdirSync(join(EXT, "lib"));
writeFileSync(join(EXT, "lib", "shell.ts"), "");
mkdirSync(join(EXT, "bar"));
writeFileSync(join(EXT, "bar", "index.ts"), "");
const mine = () => h.myHooks().map((x) => `${x.name}:${x.on ? "on" : "off"}`).join(",");
check("내 훅: 키트 확장·lib 은 빼고, 끈 것(.off)도 보임", mine() === "bar:on,foo.js:on,my-plan.ts:on,old.ts:off", mine());
const cmd = F.commands.hooks.handler;
ctx = fakeCtx();
await cmd("off mine", ctx);
check("/hooks off mine: 내 훅만 끔 (guard.ts 등 키트는 그대로), 다시 불러옴",
	mine() === "bar:off,foo.js:off,my-plan.ts:off,old.ts:off" && existsSync(join(EXT, "guard.ts")) && existsSync(join(EXT, "bar", "index.ts.off")) && ctx.log.includes("reload"), [mine(), ctx.log]);
await cmd("on my-plan", ctx);
check("/hooks on <이름>: 그 훅만 켬", mine() === "bar:off,foo.js:off,my-plan.ts:on,old.ts:off", mine());
ctx = fakeCtx();
await cmd("off wiki", ctx);
check("키트 확장 이름은 여기서 끄지 않고 안내", ctx.log.some((x) => x.includes("키트 확장이라")) && !ctx.log.includes("reload"), ctx.log);
check("위험 명령 확인: guard.ts 가 있고 guard false 가 아니면 켜짐", h.guardState().on);
ctx = fakeCtx([true]);
await cmd("off guard", ctx);
check("/hooks off guard: 경고하고 묻고, 예면 내 설정 파일에 guard false + 상태 줄", JSON.parse(read(join(AGENT, "bridge.json"))).guard === false && ctx.log[0].startsWith("위험 명령 확인을 끌까요") && !!ctx.status.hooks && !h.guardState().on, [ctx.log, ctx.status]);
await cmd("on guard", ctx);
check("/hooks on guard: guard false 를 지움", !("guard" in JSON.parse(read(join(AGENT, "bridge.json")))) && h.guardState().on && ctx.status.hooks === undefined, ctx.status);
rmSync(join(EXT, "guard.ts"));
writeFileSync(join(EXT, "guard.ts.off"), "");
ctx = fakeCtx();
globalThis.__piDocRules.warned = false;
await F.emit("session_start", { reason: "startup" }, ctx);
check("guard.ts.off 면 시작할 때 상태 줄과 한 번 알림", h.guardState().why === "guard.ts.off" && !!ctx.status.hooks && ctx.log.filter((x) => x.startsWith("알림:위험 명령 확인이 꺼져")).length === 1, [ctx.log, ctx.status]);
await cmd("on guard", ctx);
check("/hooks on guard: guard.ts.off 를 되돌리고 다시 불러옴", existsSync(join(EXT, "guard.ts")) && !existsSync(join(EXT, "guard.ts.off")) && ctx.log.includes("reload"), ctx.log);
await cmd("off docs", ctx);
check("/hooks off docs: doc_rules false", JSON.parse(read(join(AGENT, "bridge.json"))).doc_rules === false);
await cmd("on docs", ctx);
ctx = fakeCtx();
await cmd("", ctx);
check("/hooks: 목록 (guard·docs 켜짐, 내 훅)", ctx.log[0].includes("guard  켜짐") && ctx.log[0].includes("docs   켜짐") && ctx.log[0].includes("my-plan.ts 켜짐") && ctx.log[0].includes("/hooks off mine"), ctx.log[0]);
check("/hooks: 팀 규칙·문법 확인도 목록에", ctx.log[0].includes("rules  켜짐") && ctx.log[0].includes("syntax 켜짐"), ctx.log[0]);
await cmd("off rules", ctx);
await cmd("off syntax", ctx);
let cfgNow = JSON.parse(read(join(AGENT, "bridge.json")));
check("/hooks off rules·syntax: 내 설정 파일에 team_rules·syntax_check false", cfgNow.team_rules === false && cfgNow.syntax_check === false, cfgNow);
await cmd("on rules", ctx);
await cmd("on syntax", ctx);
cfgNow = JSON.parse(read(join(AGENT, "bridge.json")));
check("/hooks on rules·syntax: 지움", !("team_rules" in cfgNow) && !("syntax_check" in cfgNow), cfgNow);

// ── 문법 확인 ────────────────────────────────────────────────────────────
check("문법 확인할 파일: .py·.json·.ipynb·.yaml·.yml (틀 폴더 {{ }} 는 뺌)",
	h.syntaxKind("a/b.py") === "py" && h.syntaxKind("X.JSON") === "json" && h.syntaxKind("n.ipynb") === "json" && h.syntaxKind("c.yml") === "yaml" && h.syntaxKind("d.yaml") === "yaml"
	&& h.syntaxKind("{{cookiecutter.name}}/a.py") === null && h.syntaxKind("a.txt") === null && h.syntaxKind("Makefile") === null);
const jp = h.jsonProblem('{\n  "a": 1\n  "b": 2\n}');
check("JSON: 깨졌으면 줄·칸과 까닭", jp?.line === 3 && jp.col >= 1 && jp.msg.length > 0 && !/position/.test(jp.msg), jp);
check("JSON: 맞으면, 빈 파일, 주석·끝 쉼표만 있는 JSONC(tsconfig·VS Code 설정), {{ }} 틀은 문제 아님",
	h.jsonProblem('{"a": [1, 2]}') === null && h.jsonProblem("  \n") === null && h.jsonProblem('{\n  // 주석\n  "a": 1, /* 끝 */\n  "b": [1, 2,],\n}') === null
	&& h.jsonProblem('{"replicas": {{ .Values.n }}}') === null && h.jsonProblem('\uFEFF{"a": "http://x//y"}') === null);
check("JSONC 지우기: 글 안의 // 와 \\\" 는 그대로", h.stripJsonc('{"u": "a//b \\" /* c */", // x\n"v": 1,}') === '{"u": "a//b \\" /* c */", \n"v": 1}', h.stripJsonc('{"u": "a//b \\" /* c */", // x\n"v": 1,}'));
check("확인 결과 읽기: 문제만 (통과·건너뜀·이상한 출력은 null)",
	JSON.stringify(h.parseSyntaxOut('잡음\n@@SYNTAX {"line": 2, "col": 5, "msg": "invalid syntax", "text": "x = (", "by": "3.11.4"}\n')) === JSON.stringify({ line: 2, col: 5, msg: "invalid syntax", text: "x = (", by: "3.11.4" })
	&& h.parseSyntaxOut('@@SYNTAX {"ok": 1}') === null && h.parseSyntaxOut('@@SYNTAX {"skip": 1}') === null && h.parseSyntaxOut("Traceback") === null && h.parseSyntaxOut('@@SYNTAX {"line": null, "msg": "x"}')?.line === undefined);
check("붙일 글", h.syntaxNote("src/a.py", "py", { line: 2, col: 5, msg: "invalid syntax", text: "x = (", by: "3.11.4" })
	=== "(문법 확인: src/a.py 2번째 줄 5번째 글자 — Python 문법 오류 (Python 3.11.4 기준): invalid syntax · x = (. 이대로는 실행되지 않으니 고치세요)"
	&& h.syntaxNote("k.yaml", "yaml", { msg: "x" }).includes("YAML 형식 오류: x. 이대로는 읽히지"));
// 실제 Python 으로 (PI_TEST_PYTHON 이나 PI_PYTHON, 없으면 PATH 의 python3·python. 없으면 이 부분은 건너뜀)
const runsPy = (c) => {
	try {
		return spawnSync(c, ["-c", "import sys"], { encoding: "utf8" }).status === 0;
	} catch {
		return false;
	}
};
const realPy = [process.env.PI_TEST_PYTHON, process.env.PI_PYTHON, "python3", "python"].find((c) => c && runsPy(c));
if (!realPy) console.log("SKIP 문법 확인의 Python 부분 (돌아가는 Python 이 없음)");
else {
	const W3 = join(tmp, "work3");
	mkdirSync(W3, { recursive: true });
	const pyOut = (file, kind) => spawnSync(realPy, ["-c", h.SYNTAX_PY, join(W3, file), kind], { encoding: "utf8" }).stdout;
	writeFileSync(join(W3, "ok.py"), "def f(x):\n    return x + 1\n");
	writeFileSync(join(W3, "bad.py"), "def f(x):\n    return (x + 1\n\nprint('a')\n");
	writeFileSync(join(W3, "tab.py"), "if True:\n\tx = 1\n        y = 2\n");
	const bad = h.parseSyntaxOut(pyOut("bad.py", "py"));
	check("Python: 맞으면 통과, 깨졌으면 줄·까닭·버전 (실제 Python)", h.parseSyntaxOut(pyOut("ok.py", "py")) === null && bad?.line >= 2 && /never closed|invalid syntax|was not closed/.test(bad.msg) && /^\d+\.\d+/.test(bad.by), bad);
	check("Python: 들여쓰기 오류도", /indent/i.test(h.parseSyntaxOut(pyOut("tab.py", "py"))?.msg || ""), pyOut("tab.py", "py"));
	check("파일을 못 읽으면 건너뜀", h.parseSyntaxOut(pyOut("없음.py", "py")) === null);
	writeFileSync(join(W3, "k.yaml"), "a: 1\n  b: [2\n");
	writeFileSync(join(W3, "helm.yaml"), "{{- if .Values.on }}\nkind: x\n{{- end }}\n");
	const hasYaml = spawnSync(realPy, ["-c", "import yaml"]).status === 0;
	const ky = h.parseSyntaxOut(pyOut("k.yaml", "yaml"));
	check(`YAML: PyYAML 이 ${hasYaml ? "있어 깨진 것을 알림" : "없어 건너뜀"}, {{ }} 틀은 건너뜀`, (hasYaml ? ky?.line >= 1 : ky === null) && h.parseSyntaxOut(pyOut("helm.yaml", "yaml")) === null, ky);
	// 노트북에서 돌리는 명령 (실제 bash: Python 은 NB_FIND_PY 가 PI_PYTHON_EXE 로 찾음)
	const nbOut = spawnSync("bash", ["-c", h.notebookSyntaxCmd(join(W3, "bad.py").split("\\").join("/"), "py")], { cwd: W3, env: { ...process.env, PI_PYTHON_EXE: realPy }, encoding: "utf8" });
	check("노트북 명령 (실제 bash): 같은 결과", h.parseSyntaxOut(nbOut.stdout)?.line === bad?.line, { out: nbOut.stdout, err: nbOut.stderr });
	const noPy = spawnSync("bash", ["-c", h.notebookSyntaxCmd("/x.py", "py")], { cwd: W3, env: { ...process.env, PATH: "/nonexistent", PI_PYTHON_EXE: "" }, encoding: "utf8" });
	check("노트북에 Python 이 없으면 건너뜀", /@@SYNTAX \{"skip": 1\}/.test(noPy.stdout) || noPy.status !== 0, noPy.stdout);
	// 확장 그대로 (write 는 쓴 글로, edit 는 고친 파일을 읽어서)
	process.env.PI_PYTHON_EXE = realPy;
	globalThis.__piWorkDir = { remote: false, cwd: W3 };
	ctx = fakeCtx();
	await request();
	const synt = async (toolName, input) => {
		const res = await F.emit("tool_result", { toolName, toolCallId: `s${++n}`, input, content: [{ type: "text", text: "ok" }], isError: false }, ctx);
		return (res?.content || []).slice(1).map((c) => c.text).join("\n");
	};
	let sn = await synt("write", { path: "cfg.json", content: '{\n  "a": 1,\n  "b" 2\n}' });
	check("확장: 깨진 JSON 을 쓰면 결과에 알림 (쓴 글로 봄)", sn.startsWith("(문법 확인: cfg.json 3번째 줄") && sn.includes("JSON 형식 오류"), sn);
	check("확장: 맞는 JSON 이면 붙이지 않음", (await synt("write", { path: "ok.json", content: '{"a": 1}' })) === "");
	sn = await synt("edit", { path: "bad.py", edits: [{ oldText: "x", newText: "y" }] });
	check("확장: 고친 .py 가 깨졌으면 알림 (파일을 읽어 실제 Python 으로)", sn.startsWith("(문법 확인: bad.py") && sn.includes("Python 문법 오류"), sn);
	check("확장: 맞는 .py, 다른 파일, 오류 결과는 보지 않음", (await synt("edit", { path: "ok.py", edits: [] })) === "" && (await synt("write", { path: "a.txt", content: "{" })) === ""
		&& (await F.emit("tool_result", { toolName: "write", toolCallId: "e1", input: { path: "x.json", content: "{" }, content: [], isError: true }, ctx)) === undefined);
	// bash 로 쓴 파일 (cat > … <<EOF): 쓴 파일을 읽어 보고, 뒤 명령이 실패한 결과(오류)여도 봄
	mkdirSync(join(W3, "sub"), { recursive: true });
	writeFileSync(join(W3, "sub", "made.py"), "def f(:\n    pass\n");
	writeFileSync(join(W3, "made.json"), '{"a": 1,, }');
	sn = await synt("bash", { command: "cd sub && cat > made.py <<'PY'\ndef f(:\n    pass\nPY\npython made.py" });
	check("확장: bash 로 쓴 .py 도 (cd 를 따라 sub/made.py)", sn.startsWith("(문법 확인: sub/made.py 1번째 줄") && sn.includes("Python 문법 오류"), sn);
	const errRes = await F.emit("tool_result", { toolName: "bash", toolCallId: "e2", input: { command: "echo '{\"a\": 1,, }' > made.json && python made.json" }, content: [{ type: "text", text: "오류" }], isError: true }, ctx);
	check("확장: bash 결과가 오류여도 쓴 파일은 봄 (JSON)", (errRes?.content || []).slice(1).map((c) => c.text).join("").includes("(문법 확인: made.json"), errRes);
	writeFileSync(join(W3, "big.ipynb"), `{"cells": [${'"x",'.repeat(h.SYNTAX_JSON_MAX / 4)}`);
	check(`확장: ${h.SYNTAX_JSON_MAX / 1e6}MB 가 넘는 JSON(그림이 든 노트북 등)은 다시 읽지 않음`, (await synt("edit", { path: "big.ipynb", edits: [] })) === "");
	h.saveSetting("syntax_check", false, join(AGENT, "bridge.json"));
	check("확장: 끄면 (syntax_check false) 보지 않음", (await synt("write", { path: "cfg2.json", content: "{" })) === "");
	h.saveSetting("syntax_check", undefined, join(AGENT, "bridge.json"));
	globalThis.__piWorkDir = local;
	delete process.env.PI_PYTHON_EXE;
}

rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `RESULT: FAIL (${fails})` : "RESULT: PASS");
process.exit(fails ? 1 : 0);
