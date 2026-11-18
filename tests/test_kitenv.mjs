// /kit env (profiles/common/agent-template/extensions/kit.ts) 단위 테스트: 조사 결과 읽기, 지침의 '실행 환경' 부분 쓰기 + /doctor 도구 진단
// 사용법: node tests/test_kitenv.mjs   (저장소의 runtime/node_modules/jiti 로 .ts 를 불러옴)
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createJiti } from "../runtime/node_modules/jiti/lib/jiti.mjs";
import { join, resolve } from "node:path";
import { readFileSync, writeFileSync, rmSync, mkdtempSync, symlinkSync, existsSync, mkdirSync } from "node:fs";
import { createServer } from "node:http";
import { startLeakProxy } from "./stubs/leak-proxy.mjs";

// typebox 는 pi 처럼 runtime 의 것으로 (kit.ts 의 docs_lookup 도구)
const jiti = createJiti(import.meta.url, { alias: { typebox: fileURLToPath(new URL("../runtime/node_modules/typebox/build/index.mjs", import.meta.url)) } });

const testAgentDir = mkdtempSync(join(process.cwd(), "tmp-test-kitenv-"));
process.env.PI_KIT_HOME = process.cwd();
process.env.PI_CODING_AGENT_DIR = testAgentDir;

const kitMod = await jiti.import("../profiles/common/agent-template/extensions/kit.ts");
const {
	parseEnv, putEnv, DONE_GUIDE, CODE_FILE_GUIDE, READ_DOCS_GUIDE, WAIT_GUIDE, CAUSE_GUIDE, RERUN_GUIDE, REFUSE_GUIDE,
	KIT_GUIDES, addKitGuides, ROLE_GUIDES, getRole, roleGuide, promptSections, contextReport, diagnoseToolCalling, summarizeToolUsage,
	smallModel, extractToolCalls, stripThinking, recoverAssistantMessage, isTaskRequest, isVerbalAnswer, shouldBounceTextOnly, isBridge,
	checkVersionChange, doctorVersionSummary, doctorCompactThinkingSummary, getLoadedVersion,
	isFullscreenTui, shouldNotifyCopyHint, notifyCopyHint, COPY_HINT_MESSAGE
} = kitMod;
const kitDefault = kitMod.default;
let fails = 0;
const check = (name, cond, detail = "") => {
	console.log((cond ? "OK   " : "FAIL ") + name + (cond ? "" : "  -> " + JSON.stringify(detail)));
	if (!cond) fails++;
};

const out = "pibridge$ 명령 줄\n@@ OS: Ubuntu 22.04.3 LTS\n@@ Python: 3.10.12\n@@ 패키지: kfp 2.7.0, torch 2.1.0\n@@ nvcc: \n잡음\n@@ GPU: 2× NVIDIA A100, 81920 MiB\n";
const items = parseEnv(out);
check("조사 결과: '@@ 이름: 값' 줄만, 값이 빈 줄은 뺌", JSON.stringify(items) === JSON.stringify([
	["OS", "Ubuntu 22.04.3 LTS"], ["Python", "3.10.12"], ["패키지", "kfp 2.7.0, torch 2.1.0"], ["GPU", "2× NVIDIA A100, 81920 MiB"],
]), items);

const one = putEnv("# 지침\n\n- 규칙 A\n", "notebook", "Kubeflow 노트북 (jupyter 모드)", items, "2026-10-17");
check("처음: 끝에 빈 줄 하나 두고 표시와 함께 더함 (기존 글 그대로)", one.startsWith("# 지침\n\n- 규칙 A\n\n<!-- kit env: notebook -->\n## 실행 환경: Kubeflow 노트북 (jupyter 모드) (/kit env 로 조사, 2026-10-17)\n- OS: Ubuntu 22.04.3 LTS\n")
	&& one.endsWith("<!-- /kit env: notebook -->\n"), one);
const two = putEnv(one + "\n## 다른 부분\n내용\n", "notebook", "Kubeflow 노트북 (jupyter 모드)", [["Python", "3.11.9"]], "2026-10-18");
check("다시 조사: 그 부분만 바꾸고 뒤의 글은 그대로", two.includes("- Python: 3.11.9") && !two.includes("3.10.12") && two.includes("(/kit env 로 조사, 2026-10-18)")
	&& two.endsWith("\n## 다른 부분\n내용\n") && (two.match(/<!-- kit env: notebook -->/g) || []).length === 1, two);
const three = putEnv(two, "pc", "이 PC (Git Bash)", [["OS", "MINGW64_NT-10.0"]], "2026-10-18");
check("다른 곳(pc)은 따로 하나 더", (three.match(/<!-- kit env: /g) || []).length === 2 && three.includes("## 실행 환경: 이 PC (Git Bash)"), three);
const crlf = putEnv("# 지침\r\n- A\r\n", "notebook", "이 노트북", [["OS", "x"]], "2026-10-17");
check("CRLF 파일은 CRLF 로", crlf.includes("\r\n<!-- kit env: notebook -->\r\n") && !/[^\r]\n/.test(crlf), crlf);
check("빈 파일이면 그 부분만", putEnv("", "notebook", "이 노트북", [["OS", "x"]], "2026-10-17").startsWith("<!-- kit env: notebook -->\n"));

// 끝났다고 하기 전의 확인: 지침에 늘 더하는 줄 (짧게: 사내AI 는 입력 한 번에 만 자라 지침·도구 설명과 나눠 씀)
const g = ["기존 줄"];
addKitGuides(g);
addKitGuides(g);
check("지침에 늘 더하는 줄: 한 번씩만 더함 (기존 줄은 그대로, 끝내기 전 확인·코드 파일·문서 먼저·기다리기·원인 근거·다시 실행·거절할 때 차례)",
	JSON.stringify(g) === JSON.stringify(["기존 줄", DONE_GUIDE, CODE_FILE_GUIDE, READ_DOCS_GUIDE, WAIT_GUIDE, CAUSE_GUIDE, RERUN_GUIDE, REFUSE_GUIDE]) && KIT_GUIDES.length === 7, g);
check("비교 시험에서 더한 줄: 원인은 코드·기록을 읽어 파일·줄과 함께, 도구는 기본 인자로 실행·고친 뒤 다시, 거절할 때 안전한 일은 해 두고 승인 묻기 (각 220자 안)",
	CAUSE_GUIDE.includes("함수 정의와 호출부") && CAUSE_GUIDE.includes("파일·줄") && RERUN_GUIDE.includes("기본 인자") && RERUN_GUIDE.includes("고친 뒤에는 다시 실행")
	&& REFUSE_GUIDE.includes("거절만 하고 끝내지 말고") && REFUSE_GUIDE.includes("승인") && [CAUSE_GUIDE, RERUN_GUIDE, REFUSE_GUIDE].every((s) => s.length <= 220),
	[CAUSE_GUIDE.length, RERUN_GUIDE.length, REFUSE_GUIDE.length]);
check("끝내기 전 확인: 요구사항을 다시 보고 실행·테스트로 확인, 못 한 것은 적기, 코드를 비운 채 끝내지 않기, 못 한다고 하기 전에 해 보기 (300자 안)",
	DONE_GUIDE.length <= 300 && ["요구사항", "실행", "확인하지 못한 것", "임시 코드", "이미 써 본 방법"].every((w) => DONE_GUIDE.includes(w)), DONE_GUIDE.length);
check("작업 습관 줄: 코드는 파일로·자리 표시 없이, 지침이 가리킨 문서 먼저, 기다릴 때는 한도와 상태 출력 (각 200자 안)",
	CODE_FILE_GUIDE.includes(".py 파일") && CODE_FILE_GUIDE.includes("placeholder") && READ_DOCS_GUIDE.includes("AGENTS.md") && READ_DOCS_GUIDE.includes("먼저 물을 것")
	&& WAIT_GUIDE.includes("30초마다") && WAIT_GUIDE.includes("-u") && [CODE_FILE_GUIDE, READ_DOCS_GUIDE, WAIT_GUIDE].every((s) => s.length <= 220) && WAIT_GUIDE.includes("wait_for_run_completion"),
	[CODE_FILE_GUIDE.length, READ_DOCS_GUIDE.length, WAIT_GUIDE.length]);
addKitGuides(undefined); // 지침 목록이 없는 pi 이면 그냥 넘어감

// /context (2026-11-05): 다음 요청에 들어가는 것의 글자 수 (pi 0.87 의 시스템 프롬프트: 앞 글 + <이름>…</이름> 덩어리)
const AGI = "공통 지침 ".repeat(300);
const SYS = [
	"You are pi. 기본 안내 글입니다.", "",
	"<tools>\n- read: 파일 읽기\n</tools>", "",
	`<project_context>\nProject-specific instructions and guidelines:\n\n<project_instructions path="/home/u/.pi/agent/AGENTS.md">\n${AGI}\n</project_instructions>\n\n<project_instructions path="/w/p/CLAUDE.md">\n짧은 지침\n</project_instructions>\n</project_context>`, "",
	"<skills>\n<available_skills>\n<skill>\n<name>a</name>\n</skill>\n<skill>\n<name>b</name>\n</skill>\n</available_skills>\n</skills>", "",
	"<recent_work>\n지난 요청 1\n</recent_work>",
].join("\n");
const secs = promptSections(SYS);
const sec = (n) => secs.find((s) => s.name === n);
check("/context 지침 나누기: 앞 글·<도구>·지침 파일(파일마다)·스킬(수)·작업 기록, 나눈 합이 거의 전체",
	sec("preamble")?.chars > 10 && sec("tools") && sec("project_context")?.parts?.length === 2 && sec("project_context").parts[0].chars > 1500 && sec("skills")?.count === 2 && sec("recent_work")?.label.includes("작업 기록")
	&& Math.abs(secs.reduce((a, s) => a + s.chars, 0) - SYS.length) < 20, secs);
const msgs = [
	{ role: "system", content: SYS },
	{ role: "user", content: "README 고쳐 줘" },
	{ role: "assistant", content: [{ type: "thinking", thinking: "x".repeat(5000) }, { type: "text", text: "읽겠습니다" }, { type: "toolCall", name: "read", arguments: { path: "README.md" } }] },
	{ role: "toolResult", toolName: "read", content: [{ type: "text", text: "가".repeat(8000) }, { type: "image", data: "AAAA", mimeType: "image/png" }] },
	{ role: "compactionSummary", summary: "앞 대화 요약", tokensBefore: 1 },
];
const rep = contextReport({ system: SYS, tools: [{ name: "read", description: "파일 읽기", parameters: { type: "object" } }], messages: msgs, usage: { tokens: 12000, contextWindow: 128000, percent: 9.4 }, provider: "inhouse", maxChars: 10000 });
const R = rep.join("\n");
check("/context 화면: 지침·지침 파일(큰 것부터)·스킬 수·도구·대화 기록(요청·답·도구 결과·요약, 생각은 빼고 그림은 따로)·큰 도구 결과·토큰·사내AI 한도와 조각 수",
	R.includes(`지침 (시스템 프롬프트) ${SYS.length.toLocaleString("en-US")}자`) && R.indexOf("/home/u/.pi/agent/AGENTS.md") > 0 && R.indexOf("/home/u/.pi/agent/AGENTS.md") < R.indexOf("/w/p/CLAUDE.md")
	&& R.includes("(스킬 2개)") && R.includes("도구 설명 1개") && R.includes("메시지 4개, 그림 1개는 글자 수에서 뺌") && R.includes("도구 결과 1개 8,000자") && !R.includes("5,0")
	&& R.includes("큰 도구 결과: read 8,000자") && R.includes("약 12,000 토큰 / 128,000 (9%)") && R.includes("사내AI: 같은 대화에서는 새로 생긴 메시지만") && R.includes("한 번에 보내는 한도 10,000자")
	&& /약 2조각 \(넘는 만큼/.test(R) && R.includes("지침 파일이 지침의 절반이 넘습니다"), rep);
const rep2 = contextReport({ system: "짧은 지침", tools: [], messages: [], usage: { tokens: null, contextWindow: 100, percent: null }, provider: "vllm" }).join("\n");
check("/context: 다른 제공자는 중계 서버 줄 없음, 토큰을 모르면 그렇다고", !rep2.includes("한 번에 보내는 한도") && rep2.includes("아직 모름") && !rep2.includes("줄이려면"), rep2);

const rep3 = contextReport({ system: SYS, tools: [], messages: [], sent: true, pending: ["안 보여야 함"] }).join("\n");
const rep4 = contextReport({ system: SYS, tools: [], messages: [], pending: ["노트북 지침 파일 /home/jovyan/p/AGENTS.md 56자", "노트북 실행 환경 안내", "키트 안내"] }).join("\n");
check("/context: 지난 요청 때 보낸 지침이면 그렇다고, 첫 요청 전이면 요청 때 더하는 것(노트북 지침 파일 경로·글자 수)이 아직 빠졌다고",
	rep3.includes("(지난 요청 때 실제로 보낸 지침") && !rep3.includes("안 보여야 함") && !rep3.includes("첫 요청 전")
	&& rep4.includes("첫 요청 전이라 요청 때 더하는 것은 아직 빠짐: 노트북 지침 파일 /home/jovyan/p/AGENTS.md 56자 · 노트북 실행 환경 안내 · 키트 안내") && !rep4.includes("지난 요청 때"), [rep3, rep4]);

// ── /doctor 도구 진단 시험 ───────────────────────────────────────────────────

function writeModels(baseUrl, { reasoning, thinkingFormat } = {}) {
	const model = { id: "Qwen/Qwen3-8B", name: "Qwen3 8B", contextWindow: 32768, maxTokens: 4096 };
	if (reasoning !== undefined) model.reasoning = reasoning;
	const compat = { supportsDeveloperRole: false };
	if (thinkingFormat !== undefined) compat.thinkingFormat = thinkingFormat;
	const cfg = { providers: { vllm: { baseUrl, api: "openai-completions", apiKey: "EMPTY", compat, models: [model] } } };
	writeFileSync(join(testAgentDir, "models.json"), JSON.stringify(cfg));
}

function fakeCtx(messages = []) {
	return { model: { provider: "vllm", id: "Qwen/Qwen3-8B" }, sessionManager: { buildSessionProjection: () => ({ messages }) } };
}

async function startServer(handler) {
	const server = createServer((req, res) => {
		let body = "";
		req.on("data", (d) => (body += d));
		req.on("end", () => {
			const json = body ? JSON.parse(body) : {};
			const r = handler(json);
			const status = r.status ?? 200;
			const payload = r.body ? JSON.stringify(r.body) : "{}";
			res.writeHead(status, { "Content-Type": "application/json" });
			res.end(payload);
		});
	});
	await new Promise((resolve, reject) => server.listen(0, "127.0.0.1", (err) => (err ? reject(err) : resolve())));
	const addr = server.address();
	const port = typeof addr === "object" ? addr.port : 0;
	return { server, url: `http://127.0.0.1:${port}/v1`, stop: () => new Promise((resolve) => server.close(() => resolve())) };
}

let serverOk = true;
try {
	// 정상 tool_calls
	{
		const { url, stop } = await startServer(() => ({
			body: { choices: [{ message: { tool_calls: [{ id: "1", type: "function", function: { name: "get_time", arguments: '{"tz":"Asia/Seoul"}' } }] } }] },
		}));
		writeModels(url);
		const lines = await diagnoseToolCalling(fakeCtx());
		await stop();
		check("/doctor 도구: 정상 tool_calls → 도구 호출 정상", lines.some((l) => l.includes("도구 호출 정상")), lines);
	}

	// 글로 샘
	{
		const { url, stop } = await startServer(() => ({
			body: { choices: [{ message: { content: '<tool_call>\n<name>get_time</name>\n<arguments>{"tz":"Asia/Seoul"}</arguments>\n</tool_call>' } }] },
		}));
		writeModels(url);
		const lines = await diagnoseToolCalling(fakeCtx());
		await stop();
		check("/doctor 도구: content 에 도구 호출 글 → 도구 호출이 글로 샘", lines.some((l) => l.includes("도구 호출이 글로 샘")), lines);
	}

	// 글만 → required 로 부름
	{
		const { url, stop } = await startServer((body) => ({
			body: body.tool_choice === "required"
				? { choices: [{ message: { tool_calls: [{ id: "2", type: "function", function: { name: "get_time", arguments: '{"tz":"Asia/Seoul"}' } }] } }] }
				: { choices: [{ message: { content: "지금 시각은 오전 10시입니다." } }] },
		}));
		writeModels(url);
		const lines = await diagnoseToolCalling(fakeCtx());
		await stop();
		check("/doctor 도구: auto 는 글만, required 는 부름 → 강제하면 부름", lines.some((l) => l.includes("강제하면 부름")), lines);
	}

	// 글만 → required 도 안 부름
	{
		const { url, stop } = await startServer(() => ({
			body: { choices: [{ message: { content: "지금 시각은 오전 10시입니다." } }] },
		}));
		writeModels(url);
		const lines = await diagnoseToolCalling(fakeCtx());
		await stop();
		check("/doctor 도구: auto/required 모두 글만 → 강제해도 안 부름", lines.some((l) => l.includes("강제해도 안 부름")), lines);
	}

	// 깨진 인자
	{
		const { url, stop } = await startServer(() => ({
			body: { choices: [{ message: { tool_calls: [{ id: "3", type: "function", function: { name: "get_time", arguments: "{invalid" } }] } }] },
		}));
		writeModels(url);
		const lines = await diagnoseToolCalling(fakeCtx());
		await stop();
		check("/doctor 도구: arguments JSON 깨짐 → 인자 JSON 이 깨짐", lines.some((l) => l.includes("인자 JSON 이 깨짐")), lines);
	}

	// 생각 글 따로
	{
		const { url, stop } = await startServer(() => ({
			body: { choices: [{ message: { reasoning_content: "시간을 알아봐야겠다", tool_calls: [{ id: "4", type: "function", function: { name: "get_time", arguments: "{}" } }] } }] },
		}));
		writeModels(url);
		const lines = await diagnoseToolCalling(fakeCtx());
		await stop();
		check("/doctor 도구: reasoning_content 따로 옴", lines.some((l) => l.includes("생각 글 따로 옴")), lines);
	}

	// 생각 글이 답에 섞임
	{
		const { url, stop } = await startServer((body) => ({
			body: body.tool_choice === "required"
				? { choices: [{ message: { content: "<thinking>time</thinking> 지금 시각은 오전 10시입니다." } }] }
				: { choices: [{ message: { content: "<thinking>time</thinking> 지금 시각은 오전 10시입니다." } }] },
		}));
		writeModels(url);
		const lines = await diagnoseToolCalling(fakeCtx());
		await stop();
		check("/doctor 도구: content 에 thinking 이 섞임", lines.some((l) => l.includes("생각 글이 답에 섞임")), lines);
	}

	// HTTP 500
	{
		const { url, stop } = await startServer(() => ({ status: 500, body: { error: "internal error" } }));
		writeModels(url);
		const lines = await diagnoseToolCalling(fakeCtx());
		await stop();
		check("/doctor 도구: HTTP 500 → 상태와 응답 앞부분", lines.some((l) => l.includes("HTTP 500")), lines);
	}

	// models.json reasoning / thinkingFormat 표시
	{
		const { url, stop } = await startServer(() => ({
			body: { choices: [{ message: { tool_calls: [{ id: "5", type: "function", function: { name: "get_time", arguments: "{}" } }] } }] },
		}));
		writeModels(url, { reasoning: true, thinkingFormat: "parsed" });
		const lines = await diagnoseToolCalling(fakeCtx());
		await stop();
		check("/doctor 도구: models.json reasoning·thinkingFormat 표시", lines.some((l) => l.includes("reasoning=true")) && lines.some((l) => l.includes("thinkingFormat=parsed")), lines);
	}
} catch (e) {
	serverOk = false;
	check("가짜 서버 진단 시험: 로컬 서버를 못 띄우면 미확인", false, e.message);
}

// 브리지(models.json 이 127.0.0.1:8765)면 해당 없음
try {
	writeFileSync(join(testAgentDir, "models.json"), JSON.stringify({ providers: { copilot: { baseUrl: "http://127.0.0.1:8765/v1", apiKey: "copilot-relay", models: [{ id: "copilot" }] } } }));
	const lines = await diagnoseToolCalling({ model: { provider: "copilot", id: "copilot" } });
	check("/doctor 도구: 브리지(127.0.0.1:8765)면 해당 없음", lines.some((l) => l.includes("해당 없음")), lines);
} catch (e) {
	check("/doctor 도구: 브리지 판정 시험", false, e.message);
}

// 세션 집계 시험
{
	const sessionMsgs = [
		{ role: "assistant", content: [{ type: "toolCall", name: "read", arguments: { path: "a.txt" } }] },
		{ role: "toolResult", toolName: "read", isError: true, content: [{ type: "text", text: "찾지 못함: a.txt" }] },
		{ role: "assistant", content: [{ type: "toolCall", name: "read", arguments: { path: "b.txt" } }] },
		{ role: "assistant", content: [{ type: "toolCall", name: "todo", arguments: { text: "- [ ] 할 일" } }] },
		{ role: "assistant", content: [{ type: "text", text: "[1단계 완료]" }] },
		{ role: "assistant", content: [{ type: "toolCall", name: "edit", arguments: { path: "c.txt" } }] },
		{ role: "toolResult", toolName: "edit", isError: true, content: [{ type: "text", text: "같은 글입니다" }] },
		{ role: "assistant", content: [{ type: "text", text: "<tool_call>get_time</tool_call>" }] },
		{ role: "assistant", content: [{ type: "toolCall", name: "bash", arguments: { command: "ls" } }] },
		{ role: "toolResult", toolName: "bash", isError: true, content: [{ type: "text", text: "리뷰 대기 중이라 실행하지 않았습니다" }] },
	];
	const sum = summarizeToolUsage(sessionMsgs).join("\n");
	check("세션 집계: 도구 호출 수와 이름별 상위", /도구 호출: 5회.*read 2회/.test(sum) && sum.includes("todo 1회"), sum);
	check("세션 집계: 실패 종류 (edit 찾지못함/같은글 1, 키트막음 1, 그밖 1)", sum.includes("edit 찾지못함/같은글 1") && sum.includes("키트막음 1") && sum.includes("그밖 1"), sum);
	check("세션 집계: 도구처럼 보이는 글 답 1개, todo 호출 1회, [N단계 완료] 1회", sum.includes("도구처럼 보이는 글 답: 1개") && sum.includes("todo 호출: 1회") && sum.includes("[N단계 완료]: 1회"), sum);
}

// 같은 도구·같은 인자 3회 초과 반복 시험
{
	const repeatMsgs = [];
	for (let i = 0; i < 5; i++) repeatMsgs.push({ role: "assistant", content: [{ type: "toolCall", name: "read", arguments: { path: "x.txt" } }] });
	const sum = summarizeToolUsage(repeatMsgs).join("\n");
	check("세션 집계: 같은 도구·같은 인자 3회 초과 반복 1개", sum.includes("같은 도구·인자 3회 초과 반복: 1개"), sum);
}

// ── 작은 모델 방어 순수 함수 시험 ──
// 0) smallModel() 조건 판정
{
	check("smallModel: model_profile small 이면 켬", smallModel({ model_profile: "small" }) === true);
	check("smallModel: model_profile off 면 끔", smallModel({ model_profile: "off" }) === false);
	check("smallModel: model_profile default 면 끔", smallModel({ model_profile: "default" }) === false);
	const origKit = process.env.PI_API_KIT;
	const origNb = process.env.NB_PREFIX;
	try {
		delete process.env.PI_API_KIT;
		delete process.env.NB_PREFIX;
		check("smallModel: 설정 없고 PC 설치면 끔", smallModel({}) === false);
		process.env.PI_API_KIT = "1";
		check("smallModel: 설정 없고 API 키트 + 브리지면 끔", smallModel({}) === false);
		writeFileSync(join(testAgentDir, "models.json"), JSON.stringify({ providers: { vllm: { baseUrl: "http://localhost:8000/v1" } } }));
		check("smallModel: 설정 없고 API 키트 + 브리지 아님 켬", smallModel({}) === true);
	} finally {
		if (origKit !== undefined) process.env.PI_API_KIT = origKit; else delete process.env.PI_API_KIT;
		if (origNb !== undefined) process.env.NB_PREFIX = origNb; else delete process.env.NB_PREFIX;
	}
}

// 1) 세 꼴 해석 (extractToolCalls)
{
	const tools = new Set(["bash", "read", "edit", "write"]);

	// 꼴 (a): <tool_call>{"name":…,"arguments":{…}}</tool_call>
	const aText = '결과입니다.\n<tool_call>{"name":"bash","arguments":{"command":"ls -la"}}</tool_call>\n끝.';
	const aRes = extractToolCalls(aText, tools);
	check("세 꼴 해석 (a): tool_call JSON", aRes.toolCalls.length === 1 && aRes.toolCalls[0].name === "bash" && aRes.toolCalls[0].arguments.command === "ls -la");
	check("세 꼴 해석 (a): 호출 글 답 글에서 뺌", !aRes.remainingText.includes("<tool_call>") && aRes.remainingText.includes("결과입니다.") && aRes.remainingText.includes("끝."));

	// 꼴 (b): <function=이름><parameter=키>값</parameter></function>
	const bText = '<function=read><parameter=path>foo/bar.txt</parameter></function>';
	const bRes = extractToolCalls(bText, tools);
	check("세 꼴 해석 (b): function XML", bRes.toolCalls.length === 1 && bRes.toolCalls[0].name === "read" && bRes.toolCalls[0].arguments.path === "foo/bar.txt");

	// 꼴 (b)가 <tool_call>로 감싸인 경우
	const bWrapped = '<tool_call>\n<function=write><parameter=path>out.txt</parameter><parameter=content>hello</parameter></function>\n</tool_call>';
	const bWRes = extractToolCalls(bWrapped, tools);
	check("세 꼴 해석 (b): tool_call 로 감싸인 function XML", bWRes.toolCalls.length === 1 && bWRes.toolCalls[0].name === "write" && bWRes.toolCalls[0].arguments.content === "hello");
	check("세 꼴 해석 (b): 감싼 태그 전부 제거", bWRes.remainingText.trim() === "");

	// 꼴 (c): 코드 블록 (그 밖의 글 <= 200자)
	const cCodeText = '다음 명령을 실행합니다:\n```json\n{"name":"bash","arguments":{"command":"pwd"}}\n```';
	const cCodeRes = extractToolCalls(cCodeText, tools);
	check("세 꼴 해석 (c): 코드 블록 JSON", cCodeRes.toolCalls.length === 1 && cCodeRes.toolCalls[0].name === "bash" && cCodeRes.toolCalls[0].arguments.command === "pwd");

	// 꼴 (c): 맨 JSON (그 밖의 글 <= 200자)
	const cRawText = '{"name":"read","arguments":{"path":"config.json"}}';
	const cRawRes = extractToolCalls(cRawText, tools);
	check("세 꼴 해석 (c): 맨 JSON", cRawRes.toolCalls.length === 1 && cRawRes.toolCalls[0].name === "read" && cRawRes.toolCalls[0].arguments.path === "config.json");

	// 여러 개 호출 (a, b 혼합 및 순서 유지)
	const multiText = '<tool_call>{"name":"read","arguments":{"path":"1.txt"}}</tool_call>\n중간 글\n<function=write><parameter=path>2.txt</parameter><parameter=content>ok</parameter></function>';
	const multiRes = extractToolCalls(multiText, tools);
	check("여러 개 호출 순서대로", multiRes.toolCalls.length === 2 && multiRes.toolCalls[0].name === "read" && multiRes.toolCalls[1].name === "write");
	check("여러 개 호출 글 제거", !multiRes.remainingText.includes("<tool_call>") && !multiRes.remainingText.includes("<function=") && multiRes.remainingText.includes("중간 글"));
}

// 2) 알 수 없는 도구, 객체가 아닌 인자, (c)의 긴 글 속 JSON
{
	const tools = new Set(["bash", "read", "edit", "write"]);

	// 알 수 없는 도구는 바꾸지 않음
	const unkText = '<tool_call>{"name":"unknown_tool","arguments":{"x":1}}</tool_call>';
	const unkRes = extractToolCalls(unkText, tools);
	check("알 수 없는 도구: 바꾸지 않음", unkRes.toolCalls.length === 0 && unkRes.remainingText === unkText);

	// 인자가 객체가 아니면 바꾸지 않음
	const nonObjText = '<tool_call>{"name":"bash","arguments":"echo 1"}</tool_call>';
	const nonObjRes = extractToolCalls(nonObjText, tools);
	check("객체가 아닌 인자: 바꾸지 않음", nonObjRes.toolCalls.length === 0 && nonObjRes.remainingText === nonObjText);

	// (c) 긴 글 속 JSON (200자 초과)은 바꾸지 않음
	const longOutside = "가".repeat(250) + '\n{"name":"bash","arguments":{"command":"ls"}}\n';
	const longRes = extractToolCalls(longOutside, tools);
	check("(c) 긴 글 속 JSON: 바꾸지 않음", longRes.toolCalls.length === 0);
}

// 3) 생각 글 걷어내기 (stripThinking)
{
	// 일반 <think>...</think>
	const th1 = stripThinking("<think>여기서 생각을 정리합니다.</think>실제 답변입니다.");
	check("생각 글 걷어내기: think 태그", th1.thinking === "여기서 생각을 정리합니다." && th1.text === "실제 답변입니다.");

	// 여는 태그 없이 </think> 만 있는 경우
	const th2 = stripThinking("여는 태그 없이 생각한 내용입니다.\n</think>\n다음 작업을 수행합니다.");
	check("생각 글 걷어내기: 여는 태그 없는 </think>", th2.thinking === "여는 태그 없이 생각한 내용입니다." && th2.text === "다음 작업을 수행합니다.");

	// 생각 글 없는 일반 텍스트
	const th3 = stripThinking("그냥 텍스트입니다.");
	check("생각 글 걷어내기: 생각 글 없음", th3.thinking === "" && th3.text === "그냥 텍스트입니다.");
}

// 4) 생각 글 안의 호출 (recoverAssistantMessage)
{
	const tools = new Set(["bash", "read", "edit", "write"]);
	const msg = {
		role: "assistant",
		content: [
			{
				type: "text",
				text: '<think>파일을 먼저 봐야겠다.\n<tool_call>{"name":"read","arguments":{"path":"a.txt"}}</tool_call>\n</think>파일을 확인하겠습니다.',
			},
		],
		stopReason: "stop",
	};
	const rec = recoverAssistantMessage(msg, tools);
	check("생각 글 안의 호출: 수정됨", rec.modified === true && rec.recoveredCount === 1);
	check("생각 글 안의 호출: stopReason 도구 호출로", rec.message.stopReason === "toolUse");
	const tc = rec.message.content.find((c) => c.type === "toolCall");
	const th = rec.message.content.find((c) => c.type === "thinking");
	const tx = rec.message.content.find((c) => c.type === "text");
	check("생각 글 안의 호출: toolCall 생성", tc && tc.name === "read" && tc.arguments.path === "a.txt");
	check("생각 글 안의 호출: thinking 에서 toolCall 글 빠짐", th && !th.thinking.includes("<tool_call>") && th.thinking.includes("파일을 먼저 봐야겠다."));
	check("생각 글 안의 호출: text 에 think 없음", tx && !tx.text.includes("<think>") && tx.text === "파일을 확인하겠습니다.");
}

// 5) 되돌리기 판정 (shouldBounceTextOnly)
{
	check("isTaskRequest: 만들어", isTaskRequest("테스트 파일 하나 만들어 줘"));
	check("isTaskRequest: 고쳐", isTaskRequest("이 버그 좀 고쳐"));
	check("isTaskRequest: 실행", isTaskRequest("스크립트 실행해"));
	check("isTaskRequest: 일반 대화는 아님", !isTaskRequest("오늘 날씨 어때?"));

	check("isVerbalAnswer: 하겠습니다", isVerbalAnswer("다음과 같이 구현하겠습니다."));
	check("isVerbalAnswer: 명령 코드 블록", isVerbalAnswer("```bash\ncat file.txt\n```"));
	check("isVerbalAnswer: 질문으로 끝나면 아님", !isVerbalAnswer("다음과 같이 하겠습니다. 진행할까요?"));
	check("isVerbalAnswer: 단순 설명은 아님", !isVerbalAnswer("이 함수는 합계를 계산합니다."));

	const baseOpts = {
		userText: "hello.py 파일 만들어 줘",
		assistantText: "네, hello.py 파일을 다음과 같이 작성하겠습니다.",
		toolCallCount: 0,
		hasUI: true,
		mode: "auto",
		isReview: false,
		alreadyBounced: false,
		isSmallModel: true,
	};
	check("shouldBounceTextOnly: 작업 요청 + 말로만 답 + 도구 0회 -> 되돌림", shouldBounceTextOnly(baseOpts) === true);
	check("shouldBounceTextOnly: 이미 도구 씀 -> 안 함", shouldBounceTextOnly({ ...baseOpts, toolCallCount: 1 }) === false);
	check("shouldBounceTextOnly: 계획 모드 -> 안 함", shouldBounceTextOnly({ ...baseOpts, mode: "plan" }) === false);
	check("shouldBounceTextOnly: 묻기 모드 -> 안 함", shouldBounceTextOnly({ ...baseOpts, mode: "ask" }) === false);
	check("shouldBounceTextOnly: 리뷰 중 -> 안 함", shouldBounceTextOnly({ ...baseOpts, isReview: true }) === false);
	check("shouldBounceTextOnly: 화면 없음(-p) -> 안 함", shouldBounceTextOnly({ ...baseOpts, hasUI: false }) === false);
	check("shouldBounceTextOnly: 이미 한 번 되돌림 -> 안 함", shouldBounceTextOnly({ ...baseOpts, alreadyBounced: true }) === false);
}

// ── leak-proxy 중계 시험 (4 의 중계를 가짜 위쪽 서버 앞에 두고 세 방식이 맞게 바뀌는지) ──
{
	let upstreamResponse = {
		id: "chatcmpl-test",
		object: "chat.completion",
		created: 12345,
		model: "test-model",
		choices: [
			{
				index: 0,
				message: {
					role: "assistant",
					content: "결과 안내",
					reasoning_content: "이것은 추론입니다",
					tool_calls: [
						{
							id: "call_1",
							type: "function",
							function: {
								name: "bash",
								arguments: JSON.stringify({ command: "ls -la" }),
							},
						},
					],
				},
				finish_reason: "stop",
			},
		],
	};

	const upstreamServer = createServer((req, res) => {
		if (req.url.endsWith("/models")) {
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ data: [{ id: "test-model" }] }));
			return;
		}
		if (req.url.endsWith("/chat/completions")) {
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify(upstreamResponse));
			return;
		}
		res.writeHead(404);
		res.end();
	});

	await new Promise((resolve) => upstreamServer.listen(0, "127.0.0.1", resolve));
	const upPort = upstreamServer.address().port;

	const proxy = await startLeakProxy({ upstream: `http://127.0.0.1:${upPort}`, mode: "tools" });

	async function callProxy(mode, isStream = true) {
		const res = await fetch(`${proxy.url}/v1/chat/completions`, {
			method: "POST",
			headers: { "Content-Type": "application/json", "x-leak-mode": mode },
			body: JSON.stringify({ model: "test-model", messages: [{ role: "user", content: "hi" }], stream: isStream }),
		});
		if (!isStream) return await res.json();
		const text = await res.text();
		let combinedContent = "";
		for (const line of text.split("\n")) {
			if (line.startsWith("data: ") && !line.includes("[DONE]")) {
				try {
					const chunk = JSON.parse(line.slice(6));
					combinedContent += chunk.choices?.[0]?.delta?.content || "";
				} catch {}
			}
		}
		return { content: combinedContent, raw: text };
	}

	// 1) /v1/models pass-through
	const modelsRes = await fetch(`${proxy.url}/v1/models`);
	const modelsData = await modelsRes.json();
	check("leak-proxy: /v1/models 그대로 넘김", modelsData.data?.[0]?.id === "test-model");

	// 2) tools 모드
	const toolsOut = await callProxy("tools");
	check("leak-proxy: tools 모드 (tool_call 글 생성)", toolsOut.content.includes('<tool_call>{"name":"bash","arguments":{"command":"ls -la"}}</tool_call>'));
	check("leak-proxy: tools 모드 (SSE [DONE] 포함)", toolsOut.raw.includes("data: [DONE]"));

	// 3) xml 모드
	const xmlOut = await callProxy("xml");
	check("leak-proxy: xml 모드 (function XML 글 생성)", xmlOut.content.includes('<function=bash><parameter=command>ls -la</parameter></function>'));

	// 4) think 모드
	const thinkOut = await callProxy("think");
	check("leak-proxy: think 모드 (think 글 생성)", thinkOut.content.includes("<think>이것은 추론입니다</think>"));

	// 5) mix 모드
	const mixOut = await callProxy("mix");
	check("leak-proxy: mix 모드 (think 와 tool_call 둘 다 포함)", mixOut.content.includes("<think>이것은 추론입니다</think>") && mixOut.content.includes("<tool_call>"));

	await proxy.close();
	await new Promise((resolve) => upstreamServer.close(resolve));
}

// ── 실제 pi 실행 시험 (bin/pi, runtime) ──
{
	const cliJs = resolve(process.cwd(), "runtime/dist/bundle/cli.js");
	const extSourceDir = resolve(process.cwd(), "profiles/common/agent-template/extensions");

	async function runPiScenario({ modelProfile, isBridge = false, targetFileName = "created.txt" }) {
		const tmpRealDir = mkdtempSync(join(process.cwd(), "tmp-realpi-"));
		const aDir = join(tmpRealDir, "agent");
		const wDir = join(tmpRealDir, "work");
		mkdirSync(join(aDir, "sessions"), { recursive: true });
		mkdirSync(wDir, { recursive: true });
		symlinkSync(extSourceDir, join(aDir, "extensions"), process.platform === "win32" ? "junction" : "dir"); // Windows: 관리자 권한 없이 되는 정션

		let calls = 0;
		const mockServer = createServer((req, res) => {
			if (req.url.endsWith("/models")) {
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ data: [{ id: "mock-model" }] }));
				return;
			}
			if (req.url.endsWith("/chat/completions")) {
				calls++;
				let body = "";
				req.on("data", (d) => { body += d; });
				req.on("end", () => {
					res.writeHead(200, {
						"Content-Type": "text/event-stream; charset=utf-8",
						"Cache-Control": "no-cache",
						Connection: "keep-alive",
					});
					if (calls === 1) {
						const content = `<think>파일을 만듭니다.</think>\n<tool_call>{"name":"bash","arguments":{"command":"touch ${targetFileName}"}}</tool_call>`;
						const chunk1 = { id: "1", object: "chat.completion.chunk", created: Date.now(), model: "mock-model", choices: [{ index: 0, delta: { role: "assistant", content }, finish_reason: null }] };
						const chunk2 = { id: "1", object: "chat.completion.chunk", created: Date.now(), model: "mock-model", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] };
						res.write(`data: ${JSON.stringify(chunk1)}\n\n`);
						res.write(`data: ${JSON.stringify(chunk2)}\n\n`);
						res.write("data: [DONE]\n\n");
						res.end();
					} else {
						const content = "<think>완료했습니다.</think>\n파일이 생성되었습니다.";
						const chunk1 = { id: "2", object: "chat.completion.chunk", created: Date.now(), model: "mock-model", choices: [{ index: 0, delta: { role: "assistant", content }, finish_reason: null }] };
						const chunk2 = { id: "2", object: "chat.completion.chunk", created: Date.now(), model: "mock-model", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] };
						res.write(`data: ${JSON.stringify(chunk1)}\n\n`);
						res.write(`data: ${JSON.stringify(chunk2)}\n\n`);
						res.write("data: [DONE]\n\n");
						res.end();
					}
				});
				return;
			}
			res.writeHead(404);
			res.end();
		});

		try {
			await new Promise((r) => mockServer.listen(0, "127.0.0.1", r));
			const port = mockServer.address().port;

			const baseUrl = `http://127.0.0.1:${port}/v1`;
			writeFileSync(
				join(aDir, "models.json"),
				JSON.stringify({
					providers: {
						copilot: isBridge ? { baseUrl: "http://127.0.0.1:8765/v1" } : undefined,
						vllm: {
							baseUrl,
							api: "openai-completions",
							apiKey: "EMPTY",
							models: [{ id: "mock-model", contextWindow: 32768, maxTokens: 4096 }],
						},
					},
				})
			);
			writeFileSync(join(aDir, "settings.json"), JSON.stringify({ defaultProvider: "vllm", defaultModel: "mock-model" }));
			if (modelProfile !== undefined) {
				writeFileSync(join(aDir, "bridge.json"), JSON.stringify({ model_profile: modelProfile }));
			}

			const proc = spawn(process.execPath, [cliJs, "-p", "--mode", "json", "파일 만들어줘"], {
				cwd: wDir,
				stdio: ["ignore", "pipe", "pipe"],
				env: {
					...process.env,
					PI_CODING_AGENT_DIR: aDir,
					PI_KIT_HOME: process.cwd(),
					PI_API_KIT: "1",
				},
			});

			let stdout = "";
			proc.stdout.on("data", (d) => { stdout += d; });
			await new Promise((r) => proc.on("close", r));

			const fileCreated = existsSync(join(wDir, targetFileName));

			const assistantMsgs = [];
			for (const line of stdout.split("\n")) {
				if (!line.trim()) continue;
				try {
					const obj = JSON.parse(line);
					if (obj.type === "message_end" && obj.message?.role === "assistant") {
						assistantMsgs.push(obj.message);
					}
				} catch {}
			}

			let hasThinkInText = false;
			for (const m of assistantMsgs) {
				for (const c of m.content || []) {
					if (c.type === "text" && c.text && /<\/?think>/i.test(c.text)) {
						hasThinkInText = true;
					}
				}
			}

			return { fileCreated, calls, hasThinkInText, assistantMsgs };
		} finally {
			await new Promise((r) => mockServer.close(r));
			rmSync(tmpRealDir, { recursive: true, force: true });
		}
	}

	try {
		// 1) 정상 smallModel (model_profile: small)
		const res1 = await runPiScenario({ modelProfile: "small", targetFileName: "created_pi.txt" });
		check("실제 pi: <tool_call> 글로 파일 생성됨", res1.fileCreated === true);
		check("실제 pi: 도구 결과 받고 두 번째 답까지 호출 (callCount 2)", res1.calls === 2);
		check("실제 pi: 답 text 블록에 <think> 없음", res1.hasThinkInText === false);

		// 2) model_profile: "off"
		const res2 = await runPiScenario({ modelProfile: "off", targetFileName: "not_created_off.txt" });
		check("실제 pi: model_profile off 면 바꾸지 않음 (파일 미생성)", res2.fileCreated === false);
		check("실제 pi: model_profile off 면 도구 미실행 (callCount 1)", res2.calls === 1);

		// 3) 브리지 (models.json 에 127.0.0.1:8765)
		const res3 = await runPiScenario({ isBridge: true, targetFileName: "not_created_bridge.txt" });
		check("실제 pi: 브리지(127.0.0.1:8765)면 바꾸지 않음", res3.fileCreated === false);
	} catch (e) {
		check("실제 pi 실행 시험", false, `미확인: ${e.message}`);
	}
}

// ── 시험 1: 버전 바뀜 알림 ───────────────────────────────────────────
{
	const origKitHome = process.env.PI_KIT_HOME;
	const tmpKitHome = mkdtempSync(join(process.cwd(), "tmp-test-ver-"));
	try {
		process.env.PI_KIT_HOME = tmpKitHome;
		const createMockPi = () => {
			const handlers = {};
			return {
				on(event, fn) { (handlers[event] ||= []).push(fn); },
				async emit(event, arg1, arg2) {
					for (const fn of handlers[event] || []) await fn(arg1, arg2);
				},
				registerCommand() {},
				registerTool() {},
			};
		};
		const createMockCtx = () => {
			const notifications = [];
			return {
				hasUI: true,
				ui: {
					notify(msg, level) { notifications.push({ msg, level }); },
					setWidget() {},
					confirm() { return true; },
				},
				notifications,
			};
		};

		// 1) 초기화: 디스크 버전 2026-11-17.3
		writeFileSync(join(tmpKitHome, "VERSION"), "2026-11-17.3\n");
		delete globalThis.__piKitLoadedVersion;
		delete globalThis.__piKitWarnedVersions;

		const pi1 = createMockPi();
		kitDefault(pi1);
		check("버전 바뀜: 처음 로드 시 기억한 버전", getLoadedVersion() === "2026-11-17.3", getLoadedVersion());

		// 2) 기억한 버전과 디스크 버전이 같으면 알림 없음
		const ctx1 = createMockCtx();
		await pi1.emit("session_start", {}, ctx1);
		await pi1.emit("input", { source: "user", text: "안녕" }, ctx1);
		check("버전 바뀜: 기억한 버전과 디스크 버전이 같으면 알림 없음", ctx1.notifications.length === 0, ctx1.notifications);

		// extension source 의 input 은 검사하지 않음
		const ctxExt = createMockCtx();
		writeFileSync(join(tmpKitHome, "VERSION"), "2026-11-18.1\n");
		await pi1.emit("input", { source: "extension", text: "확장 메시지" }, ctxExt);
		check("버전 바뀜: source가 extension이면 알리지 않음", ctxExt.notifications.length === 0, ctxExt.notifications);

		// 3) 다르면 한 번 (같은 새 버전으로 다시 요청해도 한 번)
		const ctx2 = createMockCtx();
		await pi1.emit("input", { source: "user", text: "요청" }, ctx2);
		check("버전 바뀜: 다르면 한 번 경고",
			ctx2.notifications.length === 1
			&& ctx2.notifications[0].level === "warning"
			&& ctx2.notifications[0].msg === "새 버전 2026-11-18.1 이 깔렸습니다. 이 pi 는 2026-11-17.3 으로 돌고 있습니다. pi 를 끄고 다시 켜세요.",
			ctx2.notifications
		);

		const ctx3 = createMockCtx();
		await pi1.emit("input", { source: "user", text: "또 다른 요청" }, ctx3);
		await pi1.emit("session_start", {}, ctx3);
		check("버전 바뀜: 같은 새 버전으로 다시 요청해도 한 번만", ctx3.notifications.length === 0, ctx3.notifications);

		// 4) 또 다른 버전이면 다시 한 번
		writeFileSync(join(tmpKitHome, "VERSION"), "2026-11-19.1\n");
		const ctx4 = createMockCtx();
		await pi1.emit("session_start", {}, ctx4);
		check("버전 바뀜: 또 다른 버전이면 다시 한 번",
			ctx4.notifications.length === 1
			&& ctx4.notifications[0].level === "warning"
			&& ctx4.notifications[0].msg === "새 버전 2026-11-19.1 이 깔렸습니다. 이 pi 는 2026-11-17.3 으로 돌고 있습니다. pi 를 끄고 다시 켜세요.",
			ctx4.notifications
		);

		// 5) 확장을 다시 만들어도(두 번째 인스턴스) 기억한 버전 유지
		const pi2 = createMockPi();
		kitDefault(pi2);
		check("버전 바뀜: 확장을 다시 만들어도 기억한 버전 유지", getLoadedVersion() === "2026-11-17.3", getLoadedVersion());
		const ctx5 = createMockCtx();
		await pi2.emit("input", { source: "user", text: "두 번째 인스턴스" }, ctx5);
		check("버전 바뀜: 두 번째 인스턴스에서도 이미 알린 2026-11-19.1 은 다시 알리지 않음", ctx5.notifications.length === 0, ctx5.notifications);

		// 6) '?' 이면 없음
		delete globalThis.__piKitWarnedVersions;
		writeFileSync(join(tmpKitHome, "VERSION"), ""); // 빈 파일 -> version() === "?"
		const ctxQ1 = createMockCtx();
		await pi2.emit("input", { source: "user", text: "물음표 테스트" }, ctxQ1);
		check("버전 바뀜: 디스크가 '?' 이면 없음", ctxQ1.notifications.length === 0, ctxQ1.notifications);

		globalThis.__piKitLoadedVersion = "?";
		writeFileSync(join(tmpKitHome, "VERSION"), "2026-11-20.1\n");
		const ctxQ2 = createMockCtx();
		await pi2.emit("input", { source: "user", text: "물음표 테스트2" }, ctxQ2);
		check("버전 바뀜: 기억한 버전이 '?' 이면 없음", ctxQ2.notifications.length === 0, ctxQ2.notifications);

		// 7) /doctor 줄
		globalThis.__piKitLoadedVersion = "2026-11-17.3";
		writeFileSync(join(tmpKitHome, "VERSION"), "2026-11-18.1\n");
		const docDiff = doctorVersionSummary();
		check("버전 바뀜: /doctor 버전 줄 (다를 때)", docDiff === "2026-11-18.1 (이 pi 는 2026-11-17.3 으로 도는 중 — 다시 켜세요)", docDiff);

		writeFileSync(join(tmpKitHome, "VERSION"), "2026-11-17.3\n");
		const docSame = doctorVersionSummary();
		check("버전 바뀜: /doctor 버전 줄 (같을 때)", docSame === "2026-11-17.3", docSame);

		globalThis.__piKitLoadedVersion = "?";
		writeFileSync(join(tmpKitHome, "VERSION"), "2026-11-18.1\n");
		const docQ = doctorVersionSummary();
		check("버전 바뀜: /doctor 버전 줄 ('?' 일 때)", docQ === "2026-11-18.1", docQ);

	} finally {
		process.env.PI_KIT_HOME = origKitHome;
		rmSync(tmpKitHome, { recursive: true, force: true });
	}
}

// ── 시험 2: 복사하는 법 알림 ───────────────────────────────────────────
{
	const createMockCtx = (hasUI = true) => {
		const notifications = [];
		return {
			hasUI,
			ui: {
				notify(msg, level) { notifications.push({ msg, level }); },
				setWidget() {},
				confirm() { return true; },
			},
			notifications,
		};
	};

	const baseEnv = { TERM_PROGRAM: "vscode" };
	const baseArgv = ["node", "pi", "--tui-mode", "fullscreen"];

	// 1) 기본 조건 만족 시 true
	check("복사 힌트: linux + vscode + no display + fullscreen argv(1) -> true",
		shouldNotifyCopyHint({ platform: "linux", env: baseEnv, argv: baseArgv, hasUI: true }) === true
	);

	// 2) platform 조건: linux 아님 (win32, darwin)
	check("복사 힌트: win32 면 false",
		shouldNotifyCopyHint({ platform: "win32", env: baseEnv, argv: baseArgv }) === false
	);
	check("복사 힌트: darwin 면 false",
		shouldNotifyCopyHint({ platform: "darwin", env: baseEnv, argv: baseArgv }) === false
	);

	// 3) DISPLAY 있음
	check("복사 힌트: DISPLAY 있으면 false",
		shouldNotifyCopyHint({ platform: "linux", env: { ...baseEnv, DISPLAY: ":0" }, argv: baseArgv }) === false
	);

	// 4) WAYLAND_DISPLAY 있음
	check("복사 힌트: WAYLAND_DISPLAY 있으면 false",
		shouldNotifyCopyHint({ platform: "linux", env: { ...baseEnv, WAYLAND_DISPLAY: "wayland-0" }, argv: baseArgv }) === false
	);

	// 5) TERM_PROGRAM !== vscode
	check("복사 힌트: TERM_PROGRAM 없음 false",
		shouldNotifyCopyHint({ platform: "linux", env: {}, argv: baseArgv }) === false
	);
	check("복사 힌트: TERM_PROGRAM xterm false",
		shouldNotifyCopyHint({ platform: "linux", env: { TERM_PROGRAM: "xterm" }, argv: baseArgv }) === false
	);

	// 6) argv 두 꼴
	// a: --tui-mode fullscreen
	check("복사 힌트: argv 꼴 1 (--tui-mode fullscreen)",
		isFullscreenTui(["node", "pi", "--tui-mode", "fullscreen"]) === true
	);
	// b: --tui-mode=fullscreen
	check("복사 힌트: argv 꼴 2 (--tui-mode=fullscreen)",
		isFullscreenTui(["node", "pi", "--tui-mode=fullscreen"]) === true
		&& shouldNotifyCopyHint({ platform: "linux", env: baseEnv, argv: ["node", "pi", "--tui-mode=fullscreen"] }) === true
	);
	// c: settings.json 의 tuiMode 가 fullscreen
	check("복사 힌트: settings tuiMode fullscreen",
		isFullscreenTui(["node", "pi"], { tuiMode: "fullscreen" }) === true
		&& shouldNotifyCopyHint({ platform: "linux", env: baseEnv, argv: ["node", "pi"], settings: { tuiMode: "fullscreen" } }) === true
	);
	// d: fullscreen 아님
	check("복사 힌트: fullscreen 아님 (regular)",
		isFullscreenTui(["node", "pi", "--tui-mode", "regular"], { tuiMode: "regular" }) === false
		&& shouldNotifyCopyHint({ platform: "linux", env: baseEnv, argv: ["node", "pi", "--tui-mode", "regular"], settings: { tuiMode: "regular" } }) === false
	);

	// 7) copy_hint 설정
	check("복사 힌트: copy_hint false 면 false",
		shouldNotifyCopyHint({ platform: "linux", env: baseEnv, argv: baseArgv, bridgeConfig: { copy_hint: false } }) === false
	);
	check("복사 힌트: copy_hint true 면 true",
		shouldNotifyCopyHint({ platform: "linux", env: baseEnv, argv: baseArgv, bridgeConfig: { copy_hint: true } }) === true
	);
	check("복사 힌트: copy_hint 기본값(없음)은 true",
		shouldNotifyCopyHint({ platform: "linux", env: baseEnv, argv: baseArgv, bridgeConfig: {} }) === true
	);

	// 8) hasUI false
	check("복사 힌트: hasUI false 면 false",
		shouldNotifyCopyHint({ platform: "linux", env: baseEnv, argv: baseArgv, hasUI: false }) === false
	);

	// 9) 프로세스마다 한 번 (notifyCopyHint)
	delete globalThis.__piCopyHintNotified;
	const ctxA = createMockCtx(true);
	const notif1 = notifyCopyHint(ctxA, { platform: "linux", env: baseEnv, argv: baseArgv, hasUI: true });
	check("복사 힌트: 첫 notifyCopyHint 실행 시 true 및 알림 1회",
		notif1 === true
		&& ctxA.notifications.length === 1
		&& ctxA.notifications[0].level === "info"
		&& ctxA.notifications[0].msg === COPY_HINT_MESSAGE,
		ctxA.notifications
	);

	const ctxB = createMockCtx(true);
	const notif2 = notifyCopyHint(ctxB, { platform: "linux", env: baseEnv, argv: baseArgv, hasUI: true });
	check("복사 힌트: 두 번째 호출 시 프로세스당 1회이므로 false 및 알림 없음",
		notif2 === false && ctxB.notifications.length === 0,
		ctxB.notifications
	);

	// 10) platform/환경변수/argv 실제 변경 후 되돌리기 + pi session_start 연동
	const origPlatform = process.platform;
	const origEnvDisplay = process.env.DISPLAY;
	const origEnvWayland = process.env.WAYLAND_DISPLAY;
	const origTerm = process.env.TERM_PROGRAM;
	const origArgv = [...process.argv];

	try {
		delete globalThis.__piCopyHintNotified;
		Object.defineProperty(process, "platform", { value: "linux", configurable: true });
		delete process.env.DISPLAY;
		delete process.env.WAYLAND_DISPLAY;
		process.env.TERM_PROGRAM = "vscode";
		process.argv = ["node", "pi", "--tui-mode", "fullscreen"];

		const createMockPi = () => {
			const handlers = {};
			return {
				on(event, fn) { (handlers[event] ||= []).push(fn); },
				async emit(event, arg1, arg2) {
					for (const fn of handlers[event] || []) await fn(arg1, arg2);
				},
				registerCommand() {},
				registerTool() {},
			};
		};

		const pi = createMockPi();
		kitDefault(pi);

		// hasUI = false 일 때 session_start
		const ctxNoUI = createMockCtx(false);
		await pi.emit("session_start", {}, ctxNoUI);
		check("복사 힌트: pi session_start 에서 hasUI false 면 알리지 않음", ctxNoUI.notifications.length === 0);

		// hasUI = true 일 때 session_start
		const ctxWithUI = createMockCtx(true);
		await pi.emit("session_start", {}, ctxWithUI);
		check("복사 힌트: pi session_start 에서 조건 맞으면 알림 1회",
			ctxWithUI.notifications.length === 1
			&& ctxWithUI.notifications[0].level === "info"
			&& ctxWithUI.notifications[0].msg === COPY_HINT_MESSAGE
		);

		// 다시 session_start 호출해도 이미 알렸으므로 없음
		const ctxAgain = createMockCtx(true);
		await pi.emit("session_start", {}, ctxAgain);
		check("복사 힌트: pi session_start 다시 호출해도 프로세스당 1회", ctxAgain.notifications.length === 0);

	} finally {
		Object.defineProperty(process, "platform", { value: origPlatform, configurable: true });
		if (origEnvDisplay !== undefined) process.env.DISPLAY = origEnvDisplay; else delete process.env.DISPLAY;
		if (origEnvWayland !== undefined) process.env.WAYLAND_DISPLAY = origEnvWayland; else delete process.env.WAYLAND_DISPLAY;
		if (origTerm !== undefined) process.env.TERM_PROGRAM = origTerm; else delete process.env.TERM_PROGRAM;
		process.argv = origArgv;
	}
}

// ── 시험 3: 대화 요약(compaction) 동안 생각 수준 바꾸기/되돌리기 ───────────────────────────────────────────
{
	function writeBridgeCompact(value) {
		writeFileSync(join(testAgentDir, "bridge.json"), JSON.stringify({ compact_thinking: value }));
	}
	function createThinkingMock(level = "xhigh") {
		let current = level;
		const handlers = {};
		return {
			on(event, fn) { (handlers[event] ||= []).push(fn); },
			async emit(event, arg1, arg2) {
				for (const fn of handlers[event] || []) await fn(arg1, arg2);
			},
			getThinkingLevel: () => current,
			setThinkingLevel: (v) => { current = v; },
			registerCommand() {},
			registerTool() {},
		};
	}
	function resetCompactState() {
		delete globalThis.__piCompactThinking;
	}

	// 1) xhigh → off → xhigh
	{
		resetCompactState();
		writeBridgeCompact("off");
		const pi = createThinkingMock("xhigh");
		kitDefault(pi);
		await pi.emit("session_before_compact", {});
		check("compact_thinking off: 요약 전 xhigh → off", pi.getThinkingLevel() === "off");
		await pi.emit("session_compact", {});
		check("compact_thinking off: 요약 후 원래 수준 xhigh 로 되돌림", pi.getThinkingLevel() === "xhigh");
	}

	// 2) 실패 이벤트에서도 되돌림
	{
		resetCompactState();
		writeBridgeCompact("off");
		const pi = createThinkingMock("high");
		kitDefault(pi);
		await pi.emit("session_before_compact", {});
		check("compact_thinking off (failed): 요약 전 high → off", pi.getThinkingLevel() === "off");
		await pi.emit("session_compact_failed", { aborted: false });
		check("compact_thinking off (failed): 실패 후 원래 수준 high 로 되돌림", pi.getThinkingLevel() === "high");
	}

	// 3) 지금 수준이 off 면 바꾸지 않음
	{
		resetCompactState();
		writeBridgeCompact("off");
		const pi = createThinkingMock("off");
		kitDefault(pi);
		await pi.emit("session_before_compact", {});
		check("compact_thinking off: 지금 off 면 바꾸지 않음", pi.getThinkingLevel() === "off");
		await pi.emit("session_compact", {});
		check("compact_thinking off: 지금 off 면 되돌릴 것 없음", pi.getThinkingLevel() === "off");
	}

	// 4) keep 이면 바꾸지 않음
	{
		resetCompactState();
		writeBridgeCompact("keep");
		const pi = createThinkingMock("xhigh");
		kitDefault(pi);
		await pi.emit("session_before_compact", {});
		check("compact_thinking keep: 바꾸지 않음", pi.getThinkingLevel() === "xhigh");
		await pi.emit("session_compact", {});
		check("compact_thinking keep: 그대로", pi.getThinkingLevel() === "xhigh");
	}

	// 5) low → low → 원래 수준
	{
		resetCompactState();
		writeBridgeCompact("low");
		const pi = createThinkingMock("high");
		kitDefault(pi);
		await pi.emit("session_before_compact", {});
		check("compact_thinking low: 요약 전 high → low", pi.getThinkingLevel() === "low");
		await pi.emit("session_compact", {});
		check("compact_thinking low: 요약 후 high 로 되돌림", pi.getThinkingLevel() === "high");
	}

	// 6) 사용자가 compaction 중에 수준을 직접 바꾸면 되돌리지 않음
	{
		resetCompactState();
		writeBridgeCompact("off");
		const pi = createThinkingMock("xhigh");
		kitDefault(pi);
		await pi.emit("session_before_compact", {});
		check("compact_thinking 사용자 변경: 요약 전 xhigh → off", pi.getThinkingLevel() === "off");
		pi.setThinkingLevel("low");
		await pi.emit("thinking_level_select", { level: "low" });
		await pi.emit("session_compact", {});
		check("compact_thinking 사용자 변경: 사용자가 바꾼 low 를 덮어쓰지 않음", pi.getThinkingLevel() === "low");
	}

	// 6b) 실제 pi 처럼 수준을 바꿀 때마다 thinking_level_select 를 기다리지 않고 늦게 보내도, 키트가 바꾼 것은 되돌림
	{
		resetCompactState();
		writeBridgeCompact("off");
		const pi = createThinkingMock("xhigh");
		const set0 = pi.setThinkingLevel;
		pi.setThinkingLevel = (v) => { set0(v); setTimeout(() => void pi.emit("thinking_level_select", { level: v }), 0); };
		kitDefault(pi);
		await pi.emit("session_before_compact", {});
		await new Promise((r) => setTimeout(r, 10));
		await pi.emit("session_compact", {});
		check("compact_thinking: 수준 바뀜 이벤트가 늦게 와도 키트가 낮춘 것은 되돌림", pi.getThinkingLevel() === "xhigh", pi.getThinkingLevel());
	}

	// 6c) 지금 off 인데 설정이 low 여도 요약에서 생각을 켜지 않음
	{
		resetCompactState();
		writeBridgeCompact("low");
		const pi = createThinkingMock("off");
		kitDefault(pi);
		await pi.emit("session_before_compact", {});
		check("compact_thinking low: 지금 off 면 요약에서 켜지 않음", pi.getThinkingLevel() === "off", pi.getThinkingLevel());
		await pi.emit("session_compact", {});
	}

	// 7) 안전장치: 요약이 끝나지 않아 기억이 남으면 사용자 입력 때 되돌림
	{
		resetCompactState();
		writeBridgeCompact("off");
		const pi = createThinkingMock("xhigh");
		kitDefault(pi);
		await pi.emit("session_before_compact", {});
		check("compact_thinking 안전장치: 요약 전 xhigh → off", pi.getThinkingLevel() === "off");
		await pi.emit("input", { source: "user", text: "안녕" }, {});
		check("compact_thinking 안전장치: 사용자 입력 때 원래 수준으로 되돌림", pi.getThinkingLevel() === "xhigh");
	}

	// 8) /doctor 상태 요약 줄
	{
		resetCompactState();
		writeBridgeCompact("off");
		const pi = createThinkingMock("xhigh");
		const line = doctorCompactThinkingSummary(pi);
		check("compact_thinking /doctor: 기본 off 일 때 줄", line === "요약할 때 생각 수준: off (설정 compact_thinking)", line);

		writeBridgeCompact("keep");
		const keepLine = doctorCompactThinkingSummary({ getThinkingLevel: () => "xhigh" });
		check("compact_thinking /doctor: keep 이면 변경 안 함", keepLine.includes("변경 안 함") && keepLine.includes("compact_thinking: keep"), keepLine);

		writeBridgeCompact("low");
		const lowLine = doctorCompactThinkingSummary({ getThinkingLevel: () => "high" });
		check("compact_thinking /doctor: low 설정이면 low 및 현재 수준", lowLine.includes("low") && lowLine.includes("지금: high"), lowLine);
	}
}

// ── 역할 (role) 시험 ───────────────────────────────────────────
{
	function writeBridgeRole(role) {
		const base = { compact_thinking: "off" };
		if (role !== undefined) base.role = role;
		writeFileSync(join(testAgentDir, "bridge.json"), JSON.stringify(base));
	}
	function resetRoleGlobal() {
		delete globalThis.__piKitLoadedVersion;
		delete globalThis.__piKitWarnedVersions;
	}
	function createMockPiWithCommands() {
		const handlers = {};
		const cmds = {};
		const pi = {
			on: (e, f) => { (handlers[e] ||= []).push(f); },
			registerCommand: (n, def) => { cmds[n] = def; },
			registerTool: () => {},
			getActiveTools: () => [],
			getAllTools: () => [],
		};
		return { pi, handlers, cmds };
	}

	resetRoleGlobal();
	writeBridgeRole(undefined);
	check("role: 기본값은 off", getRole() === "off");
	check("roleGuide: off 이면 null", roleGuide() === null);

	writeBridgeRole("review");
	check("role: bridge.json role=review", getRole() === "review");
	check("roleGuide: review 이면 리뷰 역할 문구", roleGuide() === ROLE_GUIDES.review);

	writeBridgeRole("develop");
	check("role: bridge.json role=develop", getRole() === "develop");
	check("roleGuide: develop 이면 개발 역할 문구", roleGuide() === ROLE_GUIDES.develop);

	writeBridgeRole("리뷰");
	check("role: 한글 '리뷰' 도 review", getRole() === "review");

	// addKitGuides
	{
		writeBridgeRole("off");
		const g = ["기존"];
		addKitGuides(g);
		check("addKitGuides: role off 면 기존 7개만", g.length === 8 && g.includes("기존") && g.includes(DONE_GUIDE) && !g.includes(ROLE_GUIDES.review) && !g.includes(ROLE_GUIDES.develop), g.length);

		writeBridgeRole("review");
		const gr = [];
		addKitGuides(gr);
		check("addKitGuides: role review 면 역할 가이드 포함", gr.includes(DONE_GUIDE) && gr.includes(ROLE_GUIDES.review) && !gr.includes(ROLE_GUIDES.develop), gr);

		writeBridgeRole("develop");
		const gd = [];
		addKitGuides(gd);
		check("addKitGuides: role develop 면 역할 가이드 포함", gd.includes(DONE_GUIDE) && gd.includes(ROLE_GUIDES.develop) && !gd.includes(ROLE_GUIDES.review), gd);
	}

	// before_agent_start 에서 role-notes.md 도 함께 들어감
	{
		resetRoleGlobal();
		writeBridgeRole("review");
		const { pi, handlers } = createMockPiWithCommands();
		kitDefault(pi);
		const roleNotesFile = join(testAgentDir, "role-notes.md");
		const noteText = "- 이 pi 는 항상 pytest -q 로 테스트한다";
		writeFileSync(roleNotesFile, noteText + "\n");
		const ev = { systemPromptOptions: { promptGuidelines: [] } };
		await handlers.before_agent_start?.[0]?.(ev, {});
		check("before_agent_start: role review + role-notes.md 이면 역할 가이드와 메모 둘 다 들어감",
			ev.systemPromptOptions.promptGuidelines.includes(ROLE_GUIDES.review) && ev.systemPromptOptions.promptGuidelines.some((l) => l.includes(noteText)),
			ev.systemPromptOptions.promptGuidelines);

		writeBridgeRole("off");
		const ev2 = { systemPromptOptions: { promptGuidelines: [] } };
		await handlers.before_agent_start?.[0]?.(ev2, {});
		check("before_agent_start: role off 면 역할 가이드와 메모 모두 없음",
			!ev2.systemPromptOptions.promptGuidelines.includes(ROLE_GUIDES.review) && !ev2.systemPromptOptions.promptGuidelines.some((l) => l.includes(noteText)),
			ev2.systemPromptOptions.promptGuidelines);

		rmSync(roleNotesFile, { force: true });
	}

	// /role 명령
	{
		resetRoleGlobal();
		writeFileSync(join(testAgentDir, "bridge.json"), JSON.stringify({ compact_thinking: "keep", other_key: "x" }));
		const cmds = {};
		kitDefault({ on: () => {}, registerCommand: (n, def) => { cmds[n] = def; }, registerTool: () => {}, getActiveTools: () => [], getAllTools: () => [] });
		const ctx = {
			hasUI: true,
			ui: { notify: (msg, level = "info") => { ctx.notes.push({ msg, level }); }, setWidget: () => {} },
			notes: [],
		};
		await cmds.role.handler("review", ctx);
		const cfg = JSON.parse(readFileSync(join(testAgentDir, "bridge.json"), "utf8"));
		check("/role 리뷰: role 만 바꾸고 다른 키는 그대로", cfg.role === "review" && cfg.compact_thinking === "keep" && cfg.other_key === "x", cfg);
		check("/role 리뷰: 알림에 다음 요청부터 적용", ctx.notes.some((n) => n.level === "info" && n.msg.includes("다음 요청부터 적용")), ctx.notes);

		await cmds.role.handler("모름", ctx);
		check("/role 모름: 알림 경고", ctx.notes.at(-1).level === "warning", ctx.notes.at(-1));
	}

	// /doctor 역할 줄
	{
		async function runDoctor() {
			const cmdsD = {};
			kitDefault({ on: () => {}, registerCommand: (n, def) => { cmdsD[n] = def; }, registerTool: () => {}, getActiveTools: () => [], getAllTools: () => [] });
			const ctxD = {
				hasUI: true,
				ui: { notify: (t, l) => {}, setWidget: (k, v) => { ctxD.widget = v; } },
				model: { provider: "vllm", id: "Qwen/Qwen3-8B" },
				sessionManager: { buildSessionProjection: () => ({ messages: [] }) },
				widget: null,
			};
			await cmdsD.doctor.handler("", ctxD);
			return (ctxD.widget?.[0] || "").split("\n");
		}
		writeBridgeRole("review");
		const lines = await runDoctor();
		check("/doctor: role review 면 '역할: 리뷰' 줄", lines.some((l) => l.includes("역할: 리뷰")), lines);

		writeBridgeRole("off");
		const linesOff = await runDoctor();
		check("/doctor: role off 면 '역할: 없음' 줄", linesOff.some((l) => l.includes("역할: 없음")), linesOff);
	}
}

try { rmSync(testAgentDir, { recursive: true, force: true }); } catch {}

console.log(fails ? `RESULT: FAIL (${fails})` : "RESULT: PASS");
process.exit(fails ? 1 : 0);
