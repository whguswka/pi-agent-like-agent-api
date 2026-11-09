// /planauto (profiles/common/agent-template/extensions/modes.ts) 단위 테스트: 대기 계획 고르기, 갈림길마다 묻는 창과 고른 뒤의 동작 (가짜 pi)
// 사용법: node tests/test_planauto.mjs   (저장소의 runtime/node_modules/jiti 로 .ts 를 불러옴)
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "../runtime/node_modules/jiti/lib/jiti.mjs";

const jiti = createJiti(import.meta.url, { alias: { typebox: fileURLToPath(new URL("../runtime/node_modules/typebox/build/index.mjs", import.meta.url)) } });
const AGENT = mkdtempSync(join(tmpdir(), "planauto-agent-"));
process.env.PI_CODING_AGENT_DIR = AGENT;
process.env.PI_TODO_OPEN = "0";
const m = await jiti.import("../profiles/common/agent-template/extensions/modes.ts");
let fails = 0;
const check = (name, cond, detail = "") => {
	console.log((cond ? "OK   " : "FAIL ") + name + (cond ? "" : "  -> " + JSON.stringify(detail)));
	if (!cond) fails++;
};

// ── 대기 계획 고르기, 창의 글 (순수 함수) ──
const task = (no, over = {}) => ({
	id: `t${no}`, no, state: "paused", source: "plan", request: `요청 ${no}`, cwd: "/w", remote: false, updated: no, closed: null, stopped: null,
	items: [{ level: 0, text: "가", status: "done" }, { level: 0, text: "나", status: "todo" }], ...over,
});
const isHere = (t) => t.cwd === "/w";
const all = [
	task(1), task(2, { updated: 9 }), task(3, { source: "todo" }), task(4, { state: "doing" }), task(5, { state: "done" }), task(6, { cwd: "/다른곳" }),
	task(7, { items: [{ level: 0, text: "가", status: "done" }] }), task(8, { items: [] }),
];
check("대기 계획: 이 폴더의 쉬는 끝나지 않은 승인 계획만, 최근 것부터 (할 일 목록·하는 중·끝남·다른 폴더·빈 것은 아님)", m.waitingPlans(all, isHere).map((t) => t.no).join() === "2,1", m.waitingPlans(all, isHere));
const labels = (x) => x.picks.map((p) => p.label);
const acts = (x) => x.picks.map((p) => p.act).join();
const none = m.planAutoMenu("start", null, []);
check("켤 때, 계획 없음: 계획 모드로 바꿀지 묻기", none.title.includes("계획 모드로 바꿔") && acts(none) === "new,off", none);
const w2 = [task(2), task(1)];
const wm = m.planAutoMenu("start", null, w2);
check("켤 때, 대기 있음: 대기 계획이 맨 위 (최근 것부터), 새 계획, 끄기", acts(wm) === "switch,switch,new,off" && wm.picks[0].task.no === 2 && labels(wm)[0].includes("#2 요청 2 (1/2)"), wm);
const am = m.planAutoMenu("start", task(9), w2);
check("켤 때, 진행 중 있음: 이어서가 맨 위, 대기 계획, 쉬게 하고 새 계획, 끄기", acts(am) === "continue,switch,switch,new,off" && labels(am)[3].includes("#9 은 쉬는 중으로") && am.title.includes("#9"), am);
const rm0 = m.planAutoMenu("start", task(9), w2, "새 일");
check("요청을 주고 켬: 그 요청으로 새 계획이 맨 위", rm0.picks[0].act === "new" && labels(rm0)[0].startsWith("이 요청으로") && labels(rm0)[1].includes("덧붙임"), rm0);
const fw = m.planAutoMenu("finished", task(9), w2);
check("계획 끝남, 대기 있음: 다음 계획을 묻기", fw.title.includes("#9 이 끝났습니다") && fw.title.includes("다음 계획") && acts(fw) === "switch,switch,new,off", fw);
const fn = m.planAutoMenu("finished", task(9), []);
check("계획 끝남, 대기 없음: 새 계획을 묻기", fn.title.includes("새 계획을 세울까요") && acts(fn) === "new,off", fn);
check("할 일 목록이 끝남: '작업' 으로 적음", m.planAutoMenu("finished", task(9, { source: "todo" }), w2).title.startsWith("작업 #9"));
const st = m.planAutoMenu("stopped", task(9), w2);
check("남은 단계가 있는데 멈춤: 이어서·쉬게 두기·완료로 처리·계획 다듬기, 모델에게 답하는 길 안내", acts(st) === "continue,pause,done,refine" && st.title.includes("Esc") && labels(st)[1].includes("/todo 이어서 9"), st);
const rq = m.planAutoMenu("request", null, w2, "새 일");
check("새 요청 + 대기 있음: 새 계획이 맨 위, 대기 계획에 덧붙이기, 계획 없이", acts(rq) === "new,switch,switch,plain" && labels(rq)[1].includes("덧붙여"), rq);
const many = m.planAutoMenu("start", null, Array.from({ length: 9 }, (_, i) => task(i + 1)));
check("대기 계획이 많으면 6개까지 + 나머지는 /todo 안내", many.picks.filter((p) => p.act === "switch").length === 6 && many.title.includes("대기 중인 계획이 9개") && many.title.includes("/todo"), many);
check("창의 글이 모두 다름 (고른 글로 찾음)", [wm, am, rm0, fw, st, rq, many].every((x) => new Set(labels(x)).size === x.picks.length));

// ── 흐름 (가짜 pi) ──
const on = {};
const cmds = {};
const sent = [];
const notes = [];
const asked = [];
const answers = [];
const status = {};
let idle = true;
let editor = "";
const fakePi = {
	on: (e, f) => (on[e] ||= []).push(f), registerCommand: (n, d) => (cmds[n] = d), registerTool: () => {}, setModel: async () => true,
	sendUserMessage: (text, opts) => sent.push({ text, opts }),
};
m.default(fakePi);
const ctx = {
	hasUI: true,
	isIdle: () => idle,
	ui: {
		notify: (t) => notes.push(t), setWidget() {}, setStatus: (k, v) => (status[k] = v), confirm: async () => true, setEditorText: (t) => (editor = t),
		select: async (title, opts) => {
			asked.push({ title, opts });
			if (!answers.length) return undefined; // 기다린 답이 없으면 Esc
			const want = answers.shift();
			return want === null ? undefined : opts.find((o) => o.includes(want));
		},
	},
};
const tick = (ms = 15) => new Promise((r) => setTimeout(r, ms));
const until = async (f) => {
	for (const t0 = Date.now(); !f() && Date.now() - t0 < 4000; ) await tick();
};
const emit = async (name, event = {}) => {
	for (const f of on[name] || []) await f(event, ctx);
};
/** 사용자가 글을 침: pi 의 input 처리와 같이 transform 은 다음 처리로, handled 면 보내지 않음 */
const input = async (text, source = "interactive") => {
	let cur = text;
	for (const f of on.input) {
		const r = await f({ text: cur, source }, ctx);
		if (r?.action === "handled") return { handled: true, text: cur };
		if (r?.action === "transform") cur = r.text;
	}
	return { handled: false, text: cur };
};
/** 모델의 답 하나로 요청이 끝남 (쉬면 계획 승인 창과, hooks.ts 처럼 /planauto) */
const answer = async (text, stopReason = "stop") => {
	await emit("agent_start");
	const msg = { role: "assistant", content: [{ type: "text", text }], stopReason };
	await emit("message_end", { message: msg });
	await emit("agent_end", { messages: [msg] });
	await emit("agent_settled");
	// hooks.ts 도 쉴 때 곧바로 부름: 계획 승인 창은 사람이 답할 때까지 열려 있으므로 그 창보다 앞 (시험의 창은 바로 닫힘)
	globalThis.__piPlanAutoSettled?.(ctx);
	await tick(60);
};
const board = () => JSON.parse(readFileSync(join(AGENT, "todo", "board.json"), "utf8")).tasks;
const byNo = (no) => board().find((t) => t.no === no);
const mode = () => globalThis.__piMode;
const clear = () => {
	asked.length = sent.length = notes.length = answers.length = 0;
	editor = "";
};
const PLAN = "계획입니다.\n1. 첫째 할 일\n2. 둘째 할 일\n3. 셋째 할 일";
await emit("session_start");

// 1) 계획이 없을 때: 켜면 묻고 계획 모드로, 승인하면 진행 (승인 창은 그대로)
answers.push("계획 모드로 바꾸기");
await cmds.planauto.handler("", ctx);
check("켜기: 상태 줄, 계획 없음을 묻고 고르면 계획 모드 (요청은 사용자가 침)", String(status["plan-auto"]).includes("계획 자동") && asked[0].title.includes("계획 모드로 바꿔") && mode() === "plan" && notes.at(-1).includes("요청을 적어"), { status, asked, notes });
const r1 = await input("로그인 로그 남기기");
check("계획 모드 안내가 붙음", r1.text.startsWith("[계획 모드]") && r1.text.endsWith("로그인 로그 남기기"), r1);
clear();
answers.push("진행 (자동");
await answer(PLAN);
await until(() => sent.length);
check("계획이 오면 지금의 승인 창이 묻고, 고르면 진행 + 자동 모드 + 작업판에 계획", asked.length === 1 && asked[0].title.startsWith("이 계획대로 진행할까요?") && mode() === "auto" && sent[0].text.includes("대로 진행해 주세요") && byNo(1).source === "plan", { asked, sent });

// 2) 남은 단계가 있는데 답이 멈춤: 묻고, 이어서
clear();
answers.push("이어서 진행");
await answer("[1단계 완료] 고쳤습니다. 다시 실행해 보세요.");
await until(() => sent.length);
check("남은 단계가 있는데 멈춤: 묻고, 이어서를 고르면 그 계획을 이어서 보냄", asked.length === 1 && asked[0].title.includes("멈췄습니다") && sent[0].text.includes("작업 #1") && sent[0].text.includes("이어서") && byNo(1).state === "doing", { asked, sent });

// 3) 계획이 모두 끝남 (대기 없음): 묻고, Esc 면 그대로 + 다시 묻지 않음
clear();
answers.push(null);
await answer("[2단계 완료] [3단계 완료] 모두 끝났습니다.");
check("계획이 끝남 (대기 없음): 새 계획을 물음", asked.length === 1 && asked[0].title.includes("#1 이 끝났습니다") && asked[0].title.includes("새 계획을 세울까요") && byNo(1).state === "done", asked);
check("Esc: 그대로, 켜 둔 채", mode() === "auto" && status["plan-auto"] && notes.at(-1).includes("그대로 둡니다"), notes);
clear();
globalThis.__piPlanAutoSettled(ctx);
await tick(30);
check("같은 작업이 끝났다고 두 번 묻지 않음", asked.length === 0, asked);

// 4) 진행 중인 계획이 없는데 새 요청: 대기도 없으면 묻지 않고 계획부터
clear();
const r2 = await input("결제 로그 남기기");
check("새 요청, 계획·대기 없음: 묻지 않고 계획 모드로, 안내가 붙음", asked.length === 0 && mode() === "plan" && r2.text.startsWith("[계획 모드]") && notes.at(-1).includes("계획부터"), { asked, r2, notes });
answers.push("진행 (자동");
await answer(PLAN);
await until(() => sent.length);
check("둘째 계획 #2 진행", byNo(2)?.source === "plan" && byNo(2).state === "doing" && mode() === "auto", board());

// 5) 멈춤 -> 쉬는 중으로 두기
clear();
answers.push("쉬는 중으로");
await answer("[1단계 완료] 여기까지 했습니다.");
await tick(30);
check("쉬는 중으로 두기: 작업판 쉬는 중, 보내는 글 없음, 다시 하는 법 안내", byNo(2).state === "paused" && sent.length === 0 && notes.at(-1).includes("/todo 이어서 2"), { n: notes, b: byNo(2) });

// 6) 새 요청 + 대기 있음: 묻기
clear();
answers.push(null);
const r3 = await input("다른 일");
check("새 요청 + 대기 있음, Esc: 보내지 않고 입력창에 돌려줌, 모드 그대로", r3.handled && editor === "다른 일" && mode() === "auto" && asked[0].title.includes("이 요청을") && sent.length === 0, { r3, editor, asked });
clear();
answers.push("계획 없이");
const r4 = await input("오타 하나 고쳐 줘");
check("새 요청 + 대기 있음, 계획 없이: 그대로 보냄 (계획 모드 아님)", !r4.handled && r4.text === "오타 하나 고쳐 줘" && mode() === "auto", r4);
clear();
answers.push("이 요청을 덧붙여");
const r5 = await input("먼저 로그 위치부터 봐 줘");
await until(() => sent.length);
check("새 요청 + 대기 있음, 대기 계획 고름: 그 계획을 이어서 + 요청을 덧붙임, 원래 글은 보내지 않음", r5.handled && byNo(2).state === "doing" && sent[0].text.includes("작업 #2") && sent[0].text.includes("먼저 로그 위치부터 봐 줘"), { r5, sent });

// 7) 켜는 순간 진행 중 계획이 있음: 쉬게 하고 새 계획 (다듬기가 되지 않게 지금 목록을 붙이지 않음)
await cmds.planauto.handler("", ctx); // 끔
check("다시 치면 끔: 상태 줄 지움, 모드 그대로", !status["plan-auto"] && mode() === "auto" && notes.at(-1).includes("껐습니다"), { status, notes });
clear();
const r6 = await input("끈 뒤의 요청");
check("끈 뒤에는 묻지도 계획 모드로 가지도 않음", asked.length === 0 && mode() === "auto" && r6.text === "끈 뒤의 요청", r6);
answers.push("새 계획 세우기");
await cmds.planauto.handler("", ctx);
check("켤 때 진행 중 계획: 묻고, 새 계획이면 그 계획은 쉬는 중으로, 계획 모드", asked[0].title.includes("진행 중인 계획 #2") && byNo(2).state === "paused" && mode() === "plan", { asked, b: byNo(2) });
const r7 = await input("세 번째 일");
check("새 계획의 요청에는 앞 계획의 목록을 붙이지 않음", r7.text.startsWith("[계획 모드]") && !r7.text.includes("첫째 할 일"), r7);

// 8) 계획 모드에서 끄면 되돌아감, 다시 켜면 대기 계획을 고를 수 있음 (진행 모드로 돌아와 이어서)
await cmds.planauto.handler("", ctx);
check("끄면 /planauto 가 켠 계획 모드도 끔", mode() === "auto", mode());
clear();
await cmds.plan.handler("", ctx);
check("사용자가 /plan 으로 켠 계획 모드", mode() === "plan");
answers.push("이어서 진행");
await cmds.planauto.handler("", ctx);
await until(() => sent.length);
check("켤 때 대기 있음 (계획 모드 중): 고르면 계획 모드를 나와 그 계획을 이어서", asked[0].title.includes("대기 중인 계획이 1개") && mode() === "auto" && byNo(2).state === "doing" && sent[0].text.includes("작업 #2"), { asked, sent });

// 9) 멈춤 -> 완료로 처리 -> 끝났을 때의 창으로, 계획 다듬기
clear();
answers.push("계획 다듬기");
await answer("여기까지 했습니다.");
check("계획 다듬기: 계획 모드, 지금 작업 그대로, 고칠 점을 물음", mode() === "plan" && byNo(2).state === "doing" && notes.at(-1).includes("고칠 점"), notes);
const r8 = await input("둘째 단계를 나눠 줘");
check("다듬기 요청에는 지금 목록을 붙임", r8.text.includes("첫째 할 일"), r8);
await cmds.plan.handler("", ctx);
check("/plan 으로 끄면 계획 자동이 켜져 있다고 알림", mode() === "auto" && notes.at(-1).includes("계획 자동이 켜져"), notes);
clear();
await answer("이 파일은 설정 파일입니다.");
check("이 계획과 상관없는 요청의 답 (사용자가 다른 것을 물음): 묻지 않음", asked.length === 0, asked);
await cmds.todo.handler("이어서 2", ctx);
await until(() => sent.length);
clear();
answers.push("완료로 처리", "새 계획 세우기");
await answer("더 할 것이 없습니다.");
await until(() => asked.length >= 2);
await tick(30);
check("완료로 처리: 작업판 완료, 이어서 다음을 물음, 새 계획이면 계획 모드", byNo(2).state === "done" && asked[1].title.includes("#2 이 끝났습니다") && mode() === "plan", { asked, b: byNo(2) });
await cmds.plan.handler("", ctx);

// 10) /planauto <요청>
await cmds.planauto.handler("", ctx); // 끔
clear();
await cmds.planauto.handler("네 번째 일", ctx);
await until(() => sent.length);
check("요청을 주고 켬, 계획·대기 없음: 묻지 않고 계획 모드 + 그 요청을 보냄", asked.length === 0 && mode() === "plan" && sent[0].text === "네 번째 일" && sent[0].opts?.deliverAs === "followUp", { asked, sent });
const r9 = await input("네 번째 일", "extension");
check("보낸 요청에 계획 안내가 붙음", r9.text.startsWith("[계획 모드]"), r9);
await cmds.plan.handler("", ctx);
clear();
await cmds.planauto.handler("/review src", ctx);
check("/ 로 시작하는 요청: 대신 보내지 않고 직접 입력 안내", sent.length === 0 && asked.length === 0 && notes.at(-1).includes("/review src"), { sent, notes });

// 11) 다른 요청 중에 켬: 끝나면 물음
await cmds.planauto.handler("", ctx); // 끔
clear();
idle = false;
await cmds.planauto.handler("", ctx);
check("요청 중에 켬: 지금은 묻지 않음", asked.length === 0 && notes.at(-1).includes("끝나면"), { asked, notes });
globalThis.__piPlanAutoSettled(ctx);
await tick(30);
check("아직 일하는 중이면 묻지 않음", asked.length === 0, asked);
idle = true;
answers.push(null);
globalThis.__piPlanAutoSettled(ctx);
await until(() => asked.length);
check("쉬면 물음", asked.length === 1 && asked[0].title.includes("계획 모드로 바꿔"), asked);
await tick(30);

// 12) 묻지 않는 때: 오류·Esc 로 끝난 요청, 계획 자동이 꺼짐, 리뷰, 화면이 없는 실행, 진행과 상관없는 요청
await input("오류 시험 계획", "interactive"); // 켜 둔 채 새 요청 -> 계획 모드
answers.push("진행 (자동");
sent.length = 0;
await answer(PLAN);
await until(() => sent.length);
check("셋째 계획 진행", mode() === "auto" && board().at(-1).source === "plan" && board().at(-1).state === "doing", board().at(-1));
clear();
await answer("", "error");
check("오류로 끝난 요청: 묻지 않음", asked.length === 0, asked);
await answer("", "aborted");
check("Esc 로 끝난 요청: 묻지 않음", asked.length === 0, asked);
await emit("agent_start"); // 요청이 시작될 때 지워지므로 그 뒤에 (실제로는 /review 가 둠)
globalThis.__piReview = "done";
await emit("agent_end", { messages: [{ role: "assistant", content: [{ type: "text", text: "리뷰 답입니다." }], stopReason: "stop" }] });
globalThis.__piPlanAutoSettled(ctx);
await tick(30);
check("리뷰 뒤: 묻지 않음 (리뷰 창이 따로 물음)", asked.length === 0, asked);
globalThis.__piReview = undefined;
const noUi = { ...ctx, hasUI: false };
globalThis.__piPlanAutoSettled(noUi);
await tick(30);
check("화면이 없는 실행: 묻지 않음", asked.length === 0, asked);
await cmds.planauto.handler("", ctx); // 끔
await answer("끝나지 않았습니다.");
check("끈 뒤: 남은 단계가 있어도 묻지 않음", asked.length === 0, asked);

// 13) 확장을 다시 불러와도 (새 세션 흉내) 켜짐이 유지됨
await cmds.planauto.handler("", ctx);
await tick(30);
const on2 = {};
const cmds2 = {};
m.default({ ...fakePi, on: (e, f) => (on2[e] ||= []).push(f), registerCommand: (n, d) => (cmds2[n] = d) });
delete status["plan-auto"];
for (const f of on2.session_start || []) await f({ reason: "new" }, ctx);
check("새 세션: 계획 자동이 켜진 채 상태 줄을 다시 보임", String(status["plan-auto"]).includes("계획 자동"), status);
await cmds2.planauto.handler("", ctx);
check("새 세션에서 다시 치면 끔", globalThis.__piPlanAuto === false && !status["plan-auto"], status);

rmSync(AGENT, { recursive: true, force: true });
console.log(fails ? `\n실패 ${fails}개` : "\n모두 통과");
process.exit(fails ? 1 : 0);
