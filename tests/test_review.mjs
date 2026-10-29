// /review (profiles/common/agent-template/extensions/modes.ts) 단위 시험: 리뷰 모델 고르기, 바뀐 내용 모으기(실제 git·bash),
//  리뷰 요청 글, 리뷰하는 동안 읽기만, 끝나면 원래 모델로 (Esc·오류여도), 중계 서버가 리뷰 모델을 못 골랐을 때 알림, 고칠지 묻기, 계획 모드와 섞이지 않음
// 사용법: node tests/test_review.mjs   (저장소의 runtime/node_modules/jiti 로 .ts 를 불러옴)
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "../runtime/node_modules/jiti/lib/jiti.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const T = mkdtempSync(join(tmpdir(), "review-test-"));
process.env.PI_CODING_AGENT_DIR = join(T, "agent");
process.env.PI_COPILOT_USER_CONFIG = join(T, "agent", "bridge.json");
mkdirSync(join(T, "agent"), { recursive: true });
const jiti = createJiti(import.meta.url, { alias: { "@earendil-works/pi-coding-agent": join(ROOT, "tests/stubs/pi-coding-agent.mjs") } });
const m = await jiti.import("../profiles/common/agent-template/extensions/modes.ts");
let fails = 0;
const check = (name, cond, detail = "") => {
	console.log((cond ? "OK   " : "FAIL ") + name + (cond ? "" : `  -> ${typeof detail === "string" ? detail : JSON.stringify(detail)}`.slice(0, 900)));
	if (!cond) fails++;
};
const cfg = (v) => writeFileSync(process.env.PI_COPILOT_USER_CONFIG, JSON.stringify(v));

// ── 리뷰 모델 고르기 ──────────────────────────────────────────────────────
const copilot = { provider: "copilot", id: "gpt-5.6-sol-think" };
check("기본: Copilot 이면 GPT-6", JSON.stringify(m.reviewModel(copilot, {})) === JSON.stringify({ provider: "copilot", id: m.DEFAULT_REVIEW_MODEL, explicit: false }) && m.DEFAULT_REVIEW_MODEL === "gpt-6");
check("기본: Copilot 이 아니면(사내AI·vLLM) 지금 모델 (null)", m.reviewModel({ provider: "inhouse", id: "inhouse-sonnet" }, {}) === null && m.reviewModel({ provider: "vllm", id: "qwen" }, {}) === null);
check("review_model: id 는 같은 제공자, provider/id 는 그대로, same 은 지금 모델",
	JSON.stringify(m.reviewModel(copilot, { review_model: "claude-opus-5.5" })) === JSON.stringify({ provider: "copilot", id: "claude-opus-5.5", explicit: false })
	&& JSON.stringify(m.reviewModel({ provider: "inhouse", id: "x" }, { review_model: "copilot/gpt-6.1-sol" })) === JSON.stringify({ provider: "copilot", id: "gpt-6.1-sol", explicit: true })
	&& m.reviewModel(copilot, { review_model: "same" }) === null && m.reviewModel(undefined, {}) === null);

// ── 바뀐 내용 모으기 (실제 git·bash) ─────────────────────────────────────────
const git = (cwd, ...a) => spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...a], { cwd, encoding: "utf8" });
const R = join(T, "repo");
mkdirSync(R);
git(R, "init", "-q");
writeFileSync(join(R, "a.py"), "def f(x):\n    return x\n");
git(R, "add", "a.py");
git(R, "commit", "-qm", "c1");
writeFileSync(join(R, "a.py"), "def f(x):\n    return x + 1\n");
writeFileSync(join(R, "new.txt"), "새 파일 내용\n");
const scanIn = (cwd) => m.parseReviewScan(spawnSync("bash", ["-c", m.REVIEW_SCAN], { cwd, encoding: "utf8" }).stdout || "");
let s = scanIn(R);
check("모으기: status·stat·diff·새 파일 (실제 git)", !s.nogit && s.status.includes(" M a.py") && s.status.includes("?? new.txt") && s.stat.includes("a.py")
	&& s.diff.includes("+    return x + 1") && s.fresh.includes("=== new.txt") && s.fresh.includes("새 파일 내용"), s);
const R2 = join(T, "fresh");
mkdirSync(R2);
git(R2, "init", "-q");
writeFileSync(join(R2, "b.py"), "print(1)\n");
git(R2, "add", "b.py");
s = scanIn(R2);
check("모으기: 커밋이 없는 저장소는 스테이징한 것도", s.diff.includes("+print(1)") && s.status.includes("A  b.py"), s);
const N = join(T, "plain");
mkdirSync(N);
check("모으기: git 저장소가 아니면 nogit", scanIn(N).nogit === true);

// ── 리뷰 요청 글 ──────────────────────────────────────────────────────────
s = scanIn(R);
const p = m.reviewPrompt(s, "GPT-6 (Copilot)", "보안 위주");
check("요청 글: [리뷰] 표시, 고치지 말라는 말, 볼 점, 위치·고칠 방법, 도구 횟수, diff 는 ```diff 안에",
	p.startsWith("[리뷰] 지금까지의 작업을 GPT-6 (Copilot) 로 검토합니다") && p.includes("파일을 바꾸지 말고") && p.includes("사용자가 특히 볼 점: 보안 위주")
	&& p.includes("위치(파일:줄)") && p.includes(`${m.REVIEW_TOOLS_MAX}번까지, 스킬 문서는 읽지 않아도 됨`) && p.includes("```diff\n") && p.includes("+    return x + 1") && p.includes("## 새 파일"), p);
check("요청 글: git 이 아니면 바꾼 파일을 read 로 보라고", m.reviewPrompt({ nogit: true, status: "", stat: "", diff: "", fresh: "" }, "x").includes("git 저장소가 아니라"));
const long = m.reviewPrompt({ nogit: false, status: "M a", stat: "", diff: "x".repeat(m.REVIEW_DIFF_MAX), fresh: "" }, "x");
check("요청 글: 길어서 자른 것을 알림", long.includes(`앞 ${m.REVIEW_DIFF_MAX}바이트만`));
check("문제 없음 판단: '문제 없음' 이고 위치를 적지 않았을 때만",
	m.reviewClean("검토 결과 문제 없음입니다.") && m.reviewClean("고칠 것이 없습니다") && !m.reviewClean("1. a.py:3 빈 값 처리 없음") && !m.reviewClean("문제 없습니다. 다만 src/b.ts:10 은 확인 필요"));

// ── 확장 그대로 (가짜 pi) ──────────────────────────────────────────────────
let st = { model_id: "gpt-6", model: "GPT-6", model_ok: true };
const srv = createServer((req, res) => {
	res.writeHead(200, { "content-type": "application/json" });
	res.end(JSON.stringify({ busy: false, ...st, url: req.url }));
});
await new Promise((ok) => srv.listen(0, "127.0.0.1", ok));
const base = `http://127.0.0.1:${srv.address().port}/v1`;
const on = {};
const cmds = {};
const sent = [];
const notes = [];
const asked = [];
const modelSets = [];
let picks = [];
let idle = true;
m.default({
	on: (e, f) => (on[e] ||= []).push(f), registerCommand: (n, def) => (cmds[n] = def), sendUserMessage: (text, opts) => sent.push({ text, opts }),
	setModel: async (mm) => (modelSets.push(mm.id), true),
});
const models = { "gpt-5.6-sol-think": { provider: "copilot", id: "gpt-5.6-sol-think", name: "GPT-5.6 Sol 깊이 생각하기 (Copilot)", baseUrl: base },
	"gpt-6": { provider: "copilot", id: "gpt-6", name: "GPT-6 (Copilot)", baseUrl: base } };
const ctx = {
	hasUI: true,
	isIdle: () => idle,
	model: models["gpt-5.6-sol-think"],
	modelRegistry: { find: (_p, id) => models[id] },
	ui: { notify: (t, lv) => notes.push([t, lv]), setStatus() {}, setWidget() {}, select: async (t, opts) => (asked.push([t, opts]), picks.shift() ?? opts[0]), confirm: async () => true },
};
const tick = () => new Promise((r) => setTimeout(r, 30));
const fire = async (ev, e = {}) => {
	let last;
	for (const f of on[ev] || []) {
		const r = await f(e, ctx);
		if (r !== undefined) last = r;
	}
	return last;
};
const call = (toolName, input = {}) => fire("tool_call", { toolName, input });
globalThis.__piWorkDir = { remote: false, cwd: R };
cfg({});

await cmds.review.handler("보안 위주", ctx);
check("/review: 리뷰 모델(GPT-6)로 바꾸고 [리뷰] 요청 (바뀐 내용·볼 점 포함)", modelSets.join() === "gpt-6" && sent.length === 1 && sent[0].text.startsWith("[리뷰]")
	&& sent[0].text.includes("+    return x + 1") && sent[0].text.includes("보안 위주") && notes.some(([t]) => t.includes("GPT-6 (Copilot) 로 리뷰합니다") && t.includes("gpt-5.6-sol-think 로 돌아옵니다")), { modelSets, sent: sent.map((x) => x.text.slice(0, 80)), notes });
await fire("agent_start");
check("리뷰 중: 다른 확장도 알 수 있게 __piReview = running", globalThis.__piReview === "running");
check("리뷰 중: 읽기·읽기만 하는 명령은 됨", (await call("read", { path: "a.py" })) === undefined && (await call("bash", { command: "git log --oneline -3" })) === undefined);
check("리뷰 중: 쓰기·고치기·바꾸는 명령·묻기는 막음", (await call("write", { path: "a.py", content: "" }))?.block && (await call("edit", { path: "a.py" }))?.block
	&& (await call("bash", { command: "rm a.py" }))?.block && (await call("ask_user", { questions: [] }))?.block);
await call("grep", { pattern: "x" });
await call("ls", {});
const fifth = await call("read", { path: "b.py" });
check(`리뷰 중: 도구는 ${m.REVIEW_TOOLS_MAX}번까지 (넘으면 '지금까지 본 것으로')`, fifth?.block && fifth.reason.includes(`${m.REVIEW_TOOLS_MAX}번까지`), fifth);
st = { model_id: "gpt-6", model: "GPT-6", model_ok: false };
await fire("agent_end", { messages: [{ role: "user", content: "x" }, { role: "assistant", content: [{ type: "text", text: "1. a.py:2 빈 값 처리가 없습니다. 고칠 방법: ..." }], stopReason: "stop" }] });
check("리뷰가 끝나면 바로 원래 모델로 (__piReview 는 done: 이 요청의 다른 끝 처리도 리뷰였음을 봄)", modelSets.join() === "gpt-6,gpt-5.6-sol-think" && globalThis.__piReview === "done", [modelSets, globalThis.__piReview]);
check("중계 서버가 리뷰 모델을 못 골랐으면 알림 (그때의 모델로 리뷰했다고)", notes.some(([t, lv]) => lv === "warning" && t.includes("'GPT-6'") && t.includes("고르지 못해")), notes);
ctx.model = models["gpt-5.6-sol-think"];
picks = ["고치기 (gpt-5.6-sol-think 로)"];
await fire("agent_settled");
await tick();
check("쉬면: 고칠지 묻고(못 고른 리뷰 모델이면 '대신 그때의 모델'), 고르면 원래 모델로 고치는 요청", asked.at(-1)?.[0].includes("리뷰(GPT-6 (Copilot) 대신 그때의 모델)에서 찾은 것을 고칠까요?") && sent.at(-1).text.startsWith("[리뷰 뒤 고치기]"), { asked, sent: sent.map((x) => x.text.slice(0, 40)) });
await fire("agent_start");
await fire("tool_call", { toolName: "write", input: { path: "a.py", content: "x" } });
check("고치는 요청에서는 막지 않음 (리뷰는 끝남, __piReview 지움)", (await call("write", { path: "a.py", content: "x" })) === undefined && globalThis.__piReview === undefined);
const nAsk = asked.length;
await fire("agent_end", { messages: [{ role: "assistant", content: "고쳤습니다", stopReason: "stop" }] });
await fire("agent_settled");
await tick();
check("고친 뒤에는 다시 묻지 않음", asked.length === nAsk && modelSets.length === 2, { asked: asked.slice(nAsk), modelSets });

// Esc·오류로 끝나도 원래 모델로, 묻지 않음
st = { model_id: "gpt-6", model: "GPT-6", model_ok: true };
const n0 = notes.length;
await cmds.review.handler("", ctx);
await fire("agent_start");
await fire("agent_end", { messages: [{ role: "assistant", content: "", stopReason: "error", errorMessage: "429 Copilot 사용량 제한" }] });
await fire("agent_settled");
await tick();
check("오류(429)로 끝나도 원래 모델로, '끝까지 되지 않았습니다' 알림, 고칠지 묻지 않음", modelSets.slice(-2).join() === "gpt-6,gpt-5.6-sol-think"
	&& notes.slice(n0).some(([t]) => t.includes("끝까지 되지 않았습니다: 429 Copilot 사용량 제한") && t.includes("다시 하려면 /review")) && asked.length === nAsk && !notes.slice(n0).some(([t]) => t.includes("고르지 못해")), { notes: notes.slice(n0), modelSets });

// 문제 없음: 알리기만
await fire("agent_start");
await cmds.review.handler("", ctx);
await fire("agent_start");
await fire("agent_end", { messages: [{ role: "assistant", content: "검토했습니다. 문제 없음입니다.", stopReason: "stop" }] });
await fire("agent_settled");
await tick();
check("문제 없음이면 알리기만 (묻지 않음)", asked.length === nAsk && notes.at(-1)[0].includes("문제 없음"), notes.at(-1));

// 계획 모드: 리뷰 답(번호 목록)을 계획으로 보고 '진행할까요?' 를 묻지 않음
await fire("agent_start");
globalThis.__piMode = "plan";
await cmds.plan.handler("", ctx); // 계획 모드 켜기
await cmds.review.handler("", ctx);
await fire("agent_start");
await fire("message_end", { message: { role: "assistant", content: "1. a.py:2 문제\n2. b.py:3 문제\n3. c.py:4 문제", stopReason: "stop" } });
await fire("agent_end", { messages: [{ role: "assistant", content: "1. a.py:2 문제\n2. b.py:3 문제\n3. c.py:4 문제", stopReason: "stop" }] });
picks = ["그대로 두기 (나중에 직접)"];
await fire("agent_settled");
await tick();
check("계획 모드: 리뷰 답에 '이 계획대로 진행할까요?' 를 묻지 않고 리뷰의 고칠지만", !asked.slice(nAsk).some(([t]) => t.includes("계획대로")) && asked.slice(nAsk).some(([t]) => t.includes("고칠까요")), asked.slice(nAsk));
await cmds.plan.handler("", ctx); // 끄기

// 이미 리뷰 모델이면 바꾸지 않음, 모델 목록에 없으면 알리고 지금 모델로, 일하는 중이면 거절
const nSets = modelSets.length;
ctx.model = models["gpt-6"];
await fire("agent_start");
await cmds.review.handler("", ctx);
check("지금 모델이 리뷰 모델이면 바꾸지 않음 (돌아올 모델도 없음)", modelSets.length === nSets && sent.at(-1).text.startsWith("[리뷰]"));
await fire("agent_end", { messages: [{ role: "assistant", content: "문제 없음", stopReason: "stop" }] });
check("바꾸지 않았으면 끝나도 바꾸지 않음", modelSets.length === nSets);
ctx.model = models["gpt-5.6-sol-think"];
cfg({ review_model: "claude-opus-9" });
await fire("agent_start");
await cmds.review.handler("", ctx);
check("review_model 이 모델 목록에 없으면 알리고 지금 모델로", modelSets.length === nSets && notes.some(([t]) => t.includes("claude-opus-9") && t.includes("찾지 못해")), notes.slice(-3));
await fire("agent_end", { messages: [{ role: "assistant", content: "문제 없음", stopReason: "stop" }] });
cfg({});
idle = false;
const nSent = sent.length;
await fire("agent_start");
await cmds.review.handler("", ctx);
check("pi 가 일하는 중이면 거절 (요청이 끝난 뒤 다시)", sent.length === nSent && notes.at(-1)[0].includes("일하는 중"), notes.at(-1));
idle = true;

srv.close();
rmSync(T, { recursive: true, force: true });
console.log(fails ? `RESULT: FAIL (${fails})` : "RESULT: PASS");
process.exit(fails ? 1 : 0);
