// ask_user 도구 (profiles/common/agent-template/extensions/kit.ts) 단위 시험: 고르기 창으로 묻기, 직접 입력, 여러 개 고르기, Esc, 한 요청에 두 번까지
// 사용법: node tests/test_ask.mjs   (저장소의 runtime/node_modules/jiti 로 .ts 를 불러옴)
import { fileURLToPath } from "node:url";
import { createJiti } from "../runtime/node_modules/jiti/lib/jiti.mjs";

const jiti = createJiti(import.meta.url, { alias: { typebox: fileURLToPath(new URL("../runtime/node_modules/typebox/build/index.mjs", import.meta.url)) } });
const k = await jiti.import("../profiles/common/agent-template/extensions/kit.ts");
let fails = 0;
const check = (name, cond, detail = "") => {
	console.log((cond ? "OK   " : "FAIL ") + name + (cond ? "" : `  -> ${JSON.stringify(detail)}`.slice(0, 900)));
	if (!cond) fails++;
};

// ── 순수 함수 ─────────────────────────────────────────────────────────────
const q = { question: "어느 방식으로 할까요?", options: ["A안 — 빠름", " ", "B안 — 안전", "A안 — 빠름"], recommended: 2 };
check("고를 것: 빈 것은 빼고, 번호를 붙여 같은 글도 가르고, 추천 표시",
	JSON.stringify(k.askLabels(q)) === JSON.stringify(["1. A안 — 빠름", "2. B안 — 안전 (추천)", "3. A안 — 빠름"]) && k.askChoices(q).length === 3, k.askLabels(q));
check("고를 것은 9개까지", k.askChoices({ question: "x", options: Array.from({ length: 12 }, (_, i) => `o${i}`) }).length === 9);
check("돌려줄 글: 질문과 답", k.askResult([q, { question: "이름?" }], ["B안 — 안전", "abc (직접 입력)"], false) === "사용자의 답:\n1. 어느 방식으로 할까요?\n   → B안 — 안전\n2. 이름?\n   → abc (직접 입력)");
check("Esc: 받은 답과 '다시 묻지 말고 정리' (처음부터 닫았으면 그 말만)",
	k.askResult([q, q], ["A안"], true).includes("질문 2부터는 사용자가 답하지 않고 창을 닫았습니다. 다시 묻지 말고, 받은 답으로") && k.askResult([q], [], true).startsWith("(사용자가 답하지 않고 창을 닫았습니다. 다시 묻지 말고, 정할 것을"));
check("질문이 많으면 앞의 것만 물었다고", k.askResult([q], ["A"], false, 2).includes(`앞의 1개만 물었습니다`));
check("지침 줄: 사용자만 정할 수 있을 때만, 코드로 알 수 있는 것은 묻지 않기, 모아 묻기, 다른 도구와 함께 넣지 않기 (300자 안)",
	["ask_user", "파일·코드·명령으로 알 수 있는 것은 묻지 않는다", "한 번에 모아", "다른 도구를 함께 넣지 않는다"].every((w) => k.ASK_GUIDE.includes(w)) && k.ASK_GUIDE.length <= 300, k.ASK_GUIDE.length);

// ── 확장 그대로: 가짜 pi 와 고르기 창 ─────────────────────────────────────────
const handlers = {};
const tools = {};
k.default({ on: (e, f) => (handlers[e] ||= []).push(f), registerCommand() {}, registerTool: (t) => (tools[t.name] = t), sendUserMessage() {} });
const ask = tools.ask_user;
check("도구가 있음 (이름 ask_user, 설명에 두 번까지·다른 도구 함께 넣지 않기)", !!ask && ask.description.includes(`${k.ASK_MAX}번까지`) && ask.description.includes("다른 도구를 함께 넣지 않는다") && ask.promptGuidelines?.[0] === k.ASK_GUIDE);
const start = async () => {
	for (const f of handlers.agent_start || []) await f({}, {});
};
/** answers: 고르기 창·입력 창에 차례로 줄 답 (문자열: 그 글을 고름/입력, 숫자: 그 번째 항목, null: Esc) */
function ui(answers) {
	const log = [];
	return {
		log,
		ctx: {
			hasUI: true,
			ui: {
				select: async (title, options) => {
					log.push(["select", title, options]);
					const a = answers.shift();
					return a === null || a === undefined ? undefined : typeof a === "number" ? options[a] : a;
				},
				input: async (title, placeholder) => {
					log.push(["input", title, placeholder]);
					const a = answers.shift();
					return a === null ? undefined : a;
				},
			},
		},
	};
}
const run = async (params, u) => (await ask.execute("id", params, undefined, undefined, u.ctx)).content[0].text;

await start();
let u = ui([1]);
let out = await run({ questions: [q] }, u);
check("하나 고르기: 번호 뗀 글로 돌려줌, 창 제목에 질문, 끝에 '직접 입력…'",
	out === "사용자의 답:\n1. 어느 방식으로 할까요?\n   → B안 — 안전" && u.log[0][1] === "pi 의 질문: 어느 방식으로 할까요?" && u.log[0][2].at(-1) === k.ASK_OTHER, [out, u.log]);
out = await run({ questions: [{ question: "이름은?", options: ["a", "b"] }, { question: "설명 없이 물음" }] }, (u = ui([k.ASK_OTHER, "C안으로 해 주세요", "둘째 답"])));
check("직접 입력, 고를 것이 없으면 입력 창 (질문 1/2·2/2)",
	out.includes("→ C안으로 해 주세요 (직접 입력)") && out.includes("2. 설명 없이 물음\n   → 둘째 답 (직접 입력)") && u.log[0][1] === "pi 의 질문 1/2: 이름은?" && u.log[2][0] === "input" && u.log[2][1] === "pi 의 질문 2/2: 설명 없이 물음", [out, u.log]);
u = ui([0]);
out = await run({ questions: [{ question: "q", options: ["a", "b"] }] }, u);
check("한도 (한 요청에 두 번): 세 번째는 묻지 않고 '이미 두 번' (창을 열지 않음)", out.includes(`이미 ${k.ASK_MAX}번 물었습니다`) && u.log.length === 0, [out, u.log]);
await start();
u = ui([0, 2, 0, k.ASK_DONE]);
out = await run({ questions: [{ question: "어느 것을 볼까요?", options: ["로그", "지표", "코드"], multi: true }] }, u);
check("여러 개 고르기: 고를 때마다 [x] 가 바뀌고 (두 번 고르면 풀림) '다 골랐습니다' 로 끝", out.endsWith("→ 코드") && u.log[1][2][0] === "[x] 1. 로그" && u.log[3][2][2] === "[x] 3. 코드" && u.log[3][2][0] === "[ ] 1. 로그", [out, u.log.map((l) => l[2])]);
u = ui([1, k.ASK_OTHER, "추가 의견"]);
out = await run({ questions: [{ question: "q", options: ["a", "b"], multi: true }] }, u);
check("새 요청이면 다시 물을 수 있음 · 여러 개 + 직접 입력", out.endsWith("→ b, 추가 의견 (직접 입력)"), out);
await start();
u = ui([0, null]);
out = await run({ questions: [{ question: "첫", options: ["가", "나"] }, { question: "둘", options: ["다"] }] }, u);
check("Esc: 받은 답까지 돌려주고 더 묻지 말라고", out.startsWith("사용자의 답:\n1. 첫\n   → 가\n(질문 2부터는 사용자가 답하지 않고 창을 닫았습니다"), out);
await start();
u = ui([k.ASK_OTHER, "   "]);
out = await run({ questions: [{ question: "빈 입력", options: ["a"] }] }, u);
check("직접 입력에 빈 글이면 닫은 것으로", out.includes("사용자가 답하지 않고 창을 닫았습니다"), out);
out = await run({ questions: Array.from({ length: 6 }, (_, i) => ({ question: `q${i}` })) }, ui(["1", "2", "3", "4"]));
check(`질문은 한 번에 ${k.ASK_QUESTIONS}개까지 (나머지는 답에 적어 물으라고)`, out.includes("4. q3") && !out.includes("q4") && out.includes(`앞의 ${k.ASK_QUESTIONS}개만`), out);
await start();
check("빈 질문이면 안내", (await run({ questions: [{ question: " " }] }, ui([]))).includes("물을 것을 주세요"));
check("화면이 없는 실행(pi -p)이면 묻지 않고 답에 적으라고", (await ask.execute("id", { questions: [q] }, undefined, undefined, { hasUI: false })).content[0].text.includes("물을 수 없습니다"));

// pi 가 인자를 확인하는 방식 그대로 (스키마): questions 만 필수, 질문마다 question 만 필수
const { Value } = await jiti.import(fileURLToPath(new URL("../runtime/node_modules/typebox/build/value/index.mjs", import.meta.url)));
check("인자 스키마: 최소 인자 {questions:[{question}]} 는 통과, question 이 없으면 안 됨",
	Value.Check(ask.parameters, { questions: [{ question: "x" }] }) && Value.Check(ask.parameters, { questions: [{ question: "x", options: ["a"], recommended: 0, multi: true }] })
	&& !Value.Check(ask.parameters, { questions: [{ options: ["a"] }] }) && !Value.Check(ask.parameters, { question: "x" }));

console.log(fails ? `RESULT: FAIL (${fails})` : "RESULT: PASS");
process.exit(fails ? 1 : 0);
