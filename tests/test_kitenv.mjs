// /kit env (profiles/common/agent-template/extensions/kit.ts) 단위 테스트: 조사 결과 읽기, 지침의 '실행 환경' 부분 쓰기 + /doctor 도구 진단
// 사용법: node tests/test_kitenv.mjs   (저장소의 runtime/node_modules/jiti 로 .ts 를 불러옴)
import { fileURLToPath } from "node:url";
import { createJiti } from "../runtime/node_modules/jiti/lib/jiti.mjs";
import { join } from "node:path";
import { writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { createServer } from "node:http";

// typebox 는 pi 처럼 runtime 의 것으로 (kit.ts 의 docs_lookup 도구)
const jiti = createJiti(import.meta.url, { alias: { typebox: fileURLToPath(new URL("../runtime/node_modules/typebox/build/index.mjs", import.meta.url)) } });

const testAgentDir = mkdtempSync(join(process.cwd(), "tmp-test-kitenv-"));
process.env.PI_KIT_HOME = process.cwd();
process.env.PI_CODING_AGENT_DIR = testAgentDir;

const kitMod = await jiti.import("../profiles/common/agent-template/extensions/kit.ts");
const { parseEnv, putEnv, DONE_GUIDE, CODE_FILE_GUIDE, READ_DOCS_GUIDE, WAIT_GUIDE, CAUSE_GUIDE, RERUN_GUIDE, REFUSE_GUIDE, KIT_GUIDES, addKitGuides, promptSections, contextReport, diagnoseToolCalling, summarizeToolUsage } = kitMod;
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

try { rmSync(testAgentDir, { recursive: true, force: true }); } catch {}

console.log(fails ? `RESULT: FAIL (${fails})` : "RESULT: PASS");
process.exit(fails ? 1 : 0);
