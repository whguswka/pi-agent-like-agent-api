// bin/merge-config.mjs 시험: 새 템플릿 항목 넣기 + 기본 명령·스킬 복사 (고친 것·지운 것은 그대로)
// 사용법: node tests/test_merge_config.mjs
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, "..", "bin", "merge-config.mjs");
let fails = 0;
const check = (name, cond, detail = "") => {
	console.log((cond ? "OK   " : "FAIL ") + name + (cond ? "" : "  -> " + JSON.stringify(detail)));
	if (!cond) fails++;
};
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "merge-test-"));
const tpl = path.join(tmp, "tpl");
const agent = path.join(tmp, "agent");
const kit = path.join(tmp, "kit");
const put = (f, text) => {
	fs.mkdirSync(path.dirname(f), { recursive: true });
	fs.writeFileSync(f, text);
};
const writeJson = (f, o) => put(f, JSON.stringify(o, null, 2));
const read = (f) => fs.readFileSync(f, "utf8");
const readJson = (f) => JSON.parse(read(f));
writeJson(path.join(tpl, "settings.json"), { defaultModel: "m1", retry: { provider: { timeoutMs: 1 } } });
writeJson(path.join(agent, "settings.json"), { defaultModel: "내가 고른 모델", skills: ["D:/team/skills"] });
put(path.join(kit, "prompts", "review.md"), "review v1");
put(path.join(kit, "prompts", "test.md"), "test v1");
put(path.join(kit, "skills", "debugging", "SKILL.md"), "debugging v1");
put(path.join(kit, "skills", "korean-report", "SKILL.md"), "report v1");
put(path.join(kit, "skills", "korean-report", "weekly.md"), "weekly v1");
put(path.join(kit, "skills", "not-a-skill", "notes.txt"), "x");
const run = (k = kit) => execFileSync(process.execPath, [script, tpl, agent, ...(k ? [k] : [])], { encoding: "utf8" });
const A = (rel) => path.join(agent, rel);

let out = run();
check("새 항목 추가, 고친 값 유지", readJson(A("settings.json")).retry && readJson(A("settings.json")).defaultModel === "내가 고른 모델");
check("기본 명령·스킬 복사 (스킬은 폴더째)", read(A("prompts/review.md")) === "review v1" && read(A("skills/korean-report/weekly.md")) === "weekly v1"
	&& !fs.existsSync(A("skills/not-a-skill")), out);
check("settings.json 의 skills 목록은 건드리지 않음", JSON.stringify(readJson(A("settings.json")).skills) === JSON.stringify(["D:/team/skills"]));
out = run();
check("다시 설치해도 바뀌지 않음", !/추가|새 버전|그대로/.test(out), out);

// 새 버전: review·test·debugging·weekly 가 바뀜. 사용자는 review 를 고쳤고 debugging 은 지웠음
put(A("prompts/review.md"), "내가 고친 review");
fs.rmSync(A("skills/debugging"), { recursive: true });
put(path.join(kit, "prompts", "review.md"), "review v2");
put(path.join(kit, "prompts", "test.md"), "test v2");
put(path.join(kit, "skills", "debugging", "SKILL.md"), "debugging v2");
put(path.join(kit, "skills", "korean-report", "weekly.md"), "weekly v2");
put(path.join(kit, "skills", "new-skill", "SKILL.md"), "new v1");
out = run();
check("고치지 않은 것은 새 버전으로 (명령, 스킬 폴더 안 파일)", read(A("prompts/test.md")) === "test v2" && read(A("skills/korean-report/weekly.md")) === "weekly v2", out);
check("고친 것은 그대로 두고 알림", read(A("prompts/review.md")) === "내가 고친 review" && out.includes("직접 고친 것은 그대로 둠") && out.includes("/review"), out);
check("지운 것은 다시 넣지 않음", !fs.existsSync(A("skills/debugging")), out);
check("새 버전에 생긴 스킬은 추가", read(A("skills/new-skill/SKILL.md")) === "new v1" && out.includes("new-skill"), out);
out = run();
check("고친 것은 다음에도 그대로 (알림만)", read(A("prompts/review.md")) === "내가 고친 review" && !/추가|새 버전으로/.test(out), out);

// 그 설정에만 있는 스킬 (profiles/<설정>/skills: 템플릿 폴더 옆의 skills). 스크립트가 든 하위 폴더째, 고치지 않았으면 새 버전으로
put(path.join(tmp, "skills", "pc-screen", "SKILL.md"), "screen v1");
put(path.join(tmp, "skills", "pc-screen", "scripts", "shot.ps1"), "﻿shot v1");
out = run();
check("설정의 스킬도 복사 (하위 폴더째)", read(A("skills/pc-screen/SKILL.md")) === "screen v1" && read(A("skills/pc-screen/scripts/shot.ps1")) === "﻿shot v1"
	&& out.includes("pc-screen"), out);
put(path.join(tmp, "skills", "pc-screen", "scripts", "shot.ps1"), "﻿shot v2");
out = run();
check("설정의 스킬: 고치지 않았으면 새 버전으로", read(A("skills/pc-screen/scripts/shot.ps1")) === "﻿shot v2" && out.includes("새 버전으로: pc-screen"), out);
const agent3 = path.join(tmp, "agent3");
writeJson(path.join(agent3, "settings.json"), {});
fs.mkdirSync(path.join(tmp, "other", "agent-template"), { recursive: true });
execFileSync(process.execPath, [script, path.join(tmp, "other", "agent-template"), agent3, kit], { encoding: "utf8" });
check("다른 설정(템플릿 옆에 skills 가 없음)에는 들어가지 않음", !fs.existsSync(path.join(agent3, "skills", "pc-screen")) && fs.existsSync(path.join(agent3, "skills", "new-skill")));

// 원래 사용자가 만든 같은 이름의 명령은 덮어쓰지 않음
const agent2 = path.join(tmp, "agent2");
writeJson(path.join(agent2, "settings.json"), {});
put(path.join(agent2, "prompts", "test.md"), "내 test 명령");
execFileSync(process.execPath, [script, tpl, agent2, kit], { encoding: "utf8" });
check("원래 있던 같은 이름의 내 명령은 덮어쓰지 않음", read(path.join(agent2, "prompts", "test.md")) === "내 test 명령");

// 예전 버전(설정에 저장소 폴더를 등록하던 방식)에서 넣은 경로는 뺌
const state = readJson(A(".pi-agent-kit-template.json"));
state.kitPaths = { prompts: "C:/old/kit/prompts", skills: "C:/old/kit/skills" };
put(A(".pi-agent-kit-template.json"), JSON.stringify(state));
const st = readJson(A("settings.json"));
st.prompts = ["C:/old/kit/prompts"];
st.skills = ["D:/team/skills", "C:/old/kit/skills"];
writeJson(A("settings.json"), st);
out = run();
const s2 = readJson(A("settings.json"));
check("예전 버전의 등록 경로는 빼고, 사용자가 넣은 경로는 남김", !("prompts" in s2) && JSON.stringify(s2.skills) === JSON.stringify(["D:/team/skills"]), s2);
out = run(null);
check("저장소 폴더를 주지 않으면 복사하지 않음", !/추가|새 버전/.test(out), out);

// models.json: pi 처럼 주석과 끝의 쉼표를 받아들이고 새 모델을 넣음
writeJson(path.join(tpl, "models.json"), { providers: { copilot: { baseUrl: "u", models: [{ id: "m1" }] } } });
put(A("models.json"), '{\n  // 내 메모\n  "providers": { "copilot": { "baseUrl": "u", "models": [ { "id": "m1", "name": "a,b // 문자열" }, ] } },\n}\n');
out = run(null);
writeJson(path.join(tpl, "models.json"), { providers: { copilot: { baseUrl: "u", models: [{ id: "m1" }, { id: "m2" }] } } });
out = run(null);
let mj = readJson(A("models.json"));
check("models.json 의 주석·끝 쉼표: 읽고 새 모델 추가 (문자열 안은 그대로)", mj.providers.copilot.models.map((m) => m.id).join() === "m1,m2"
	&& mj.providers.copilot.models[0].name === "a,b // 문자열" && fs.existsSync(A("models.json.bak")), out);
// 이미 있는 모델에 새로 생긴 항목(그림 입력 input)은 더하고, 고친 값은 그대로
writeJson(path.join(tpl, "models.json"), { providers: { copilot: { baseUrl: "u", models: [{ id: "m1", name: "새 이름", input: ["text", "image"] }, { id: "m2" }] } } });
out = run(null);
mj = readJson(A("models.json"));
check("있는 모델: 새 항목(input)만 더하고 고친 값(name)은 그대로", JSON.stringify(mj.providers.copilot.models[0].input) === '["text","image"]'
	&& mj.providers.copilot.models[0].name === "a,b // 문자열" && out.includes("모델 m1.input 추가"), [mj.providers.copilot.models, out]);
// 사용자가 그 항목을 지웠으면 다음 설치에서 다시 넣지 않음
delete mj.providers.copilot.models[0].input;
writeJson(A("models.json"), mj);
run(null);
check("있는 모델: 사용자가 지운 항목은 다시 넣지 않음", readJson(A("models.json")).providers.copilot.models[0].input === undefined, readJson(A("models.json")));
// 형식이 틀린 settings.json: 이번 새 항목은 고친 뒤 다시 실행할 때 넣음 ('지운 것'으로 보지 않음)
writeJson(path.join(tpl, "settings.json"), { defaultModel: "m1", retry: { provider: { timeoutMs: 1 } }, newKey: 1 });
put(A("settings.json"), '{ "defaultModel": "x", }');
let failedRc = 0;
try {
	run(null);
} catch (e) {
	failedRc = e.status;
	out = String(e.stdout);
}
check("형식이 틀리면 알리고 종료 코드 2", failedRc === 2 && out.includes("확인 필요"), out);
writeJson(A("settings.json"), { defaultModel: "x" });
out = run(null);
check("고친 뒤 다시 실행하면 그때 새 항목 추가", readJson(A("settings.json")).newKey === 1, out);

// 키트 기본 모델이 바뀜 (2026-10: GPT-6.1 Sol 은 회사 계정의 주간 사용량이 반나절 만에 끝나 GPT-5.6 Sol 깊이 생각하기로):
//  직접 고르지 않은 값(지난 템플릿의 값, 예전 키트 기본값)만 새 기본값으로, 직접 고른 값은 그대로
const tpl4 = path.join(tmp, "tpl4");
const agent4 = path.join(tmp, "agent4");
const run4 = () => execFileSync(process.execPath, [script, tpl4, agent4], { encoding: "utf8" });
writeJson(path.join(tpl4, "settings.json"), { defaultProvider: "copilot", defaultModel: "gpt-6.1-sol" });
writeJson(path.join(agent4, "settings.json"), { defaultProvider: "copilot", defaultModel: "gpt-6.1-sol" });
run4();
writeJson(path.join(tpl4, "settings.json"), { defaultProvider: "copilot", defaultModel: "gpt-5.6-sol-think" });
out = run4();
check("키트 기본 모델이 바뀌면 직접 고르지 않은 기본 모델은 새 기본으로 (알림)",
	readJson(path.join(agent4, "settings.json")).defaultModel === "gpt-5.6-sol-think" && out.includes("defaultModel gpt-6.1-sol -> gpt-5.6-sol-think"), out);
writeJson(path.join(agent4, "settings.json"), { defaultProvider: "copilot", defaultModel: "claude-opus-5.5" });
out = run4();
check("직접 고른 기본 모델은 그대로", readJson(path.join(agent4, "settings.json")).defaultModel === "claude-opus-5.5" && !out.includes("defaultModel"), out);
fs.rmSync(path.join(agent4, ".pi-agent-kit-template.json"));
writeJson(path.join(agent4, "settings.json"), { defaultModel: "gpt-6.0-sol" });
out = run4();
check("지난 설치 기록이 없어도 예전 키트 기본값(gpt-6.0-sol)이면 새 기본으로", readJson(path.join(agent4, "settings.json")).defaultModel === "gpt-5.6-sol-think", out);

// 키트에서 뺀 기본 명령 (2026-10-28: prompts/review.md -> /review 는 modes.ts 의 명령): 설치한 그대로면 prompts.removed/ 로, 고쳤으면 그대로 + 알림
const kit5 = path.join(tmp, "kit5");
put(path.join(kit5, "prompts", "test.md"), "test v1");
const run5 = (ag) => execFileSync(process.execPath, [script, tpl, ag, kit5], { encoding: "utf8" });
// 2026-10-02 부터 내보낸 그대로의 prompts/review.md (LF)
const SHIPPED_REVIEW = [
	"---",
	"description: 바뀐 내용(git diff) 검토 - 버그·빠진 처리·보안·테스트 위주",
	'argument-hint: "[파일이나 볼 점]"',
	"---",
	"작업 폴더의 바뀐 내용을 검토해 주세요. 대상: ${@:-커밋하지 않은 모든 변경 (git diff, git diff --staged)}",
	"- 먼저 `git status` 와 `git diff --stat` 으로 범위를 보고, 필요한 파일의 diff 만 읽습니다.",
	"- 볼 점: 버그 가능성, 예외·빈 값 처리, 보안(비밀번호·키·내부 주소가 코드에 들어갔는지), 성능 문제, 테스트가 필요한 부분, 이름·구조가 어색한 곳.",
	"- 고치지는 말고, 찾은 것을 심각한 순서로 정리합니다: 위치(파일:줄), 문제, 고칠 방법. 문제가 없으면 없다고 말합니다.",
	"",
].join("\n");
const ag5 = path.join(tmp, "agent5a");
put(path.join(ag5, "prompts", "review.md"), SHIPPED_REVIEW);
out = run5(ag5);
check("뺀 명령: 설치 기록이 없어도 내보낸 그대로면 prompts.removed/ 로 옮김", !fs.existsSync(path.join(ag5, "prompts", "review.md"))
	&& read(path.join(ag5, "prompts.removed", "review.md")) === SHIPPED_REVIEW && out.includes("치움:") && out.includes("/review 템플릿"), out);
check("뺀 명령: 상태 파일에 남기지 않음, 다른 기본 명령은 그대로 복사", !("prompts/review.md" in readJson(path.join(ag5, ".pi-agent-kit-template.json")).kitFiles)
	&& read(path.join(ag5, "prompts", "test.md")) === "test v1", readJson(path.join(ag5, ".pi-agent-kit-template.json")).kitFiles);
const ag5b = path.join(tmp, "agent5b");
put(path.join(kit, "prompts", "review.md"), "review v9"); // 앞 시험의 키트: 아직 review.md 가 있는 버전으로 설치
fs.rmSync(path.join(kit, "skills"), { recursive: true, force: true });
execFileSync(process.execPath, [script, tpl, ag5b, kit], { encoding: "utf8" });
out = run5(ag5b);
check("뺀 명령: 지난번에 설치한 그대로(설치 기록의 해시)여도 옮김", !fs.existsSync(path.join(ag5b, "prompts", "review.md")) && read(path.join(ag5b, "prompts.removed", "review.md")) === "review v9", out);
const ag5c = path.join(tmp, "agent5c");
execFileSync(process.execPath, [script, tpl, ag5c, kit], { encoding: "utf8" });
put(path.join(ag5c, "prompts", "review.md"), "내가 고친 리뷰 템플릿");
out = run5(ag5c);
check("뺀 명령: 고쳤으면 그대로 두고, 쓰이지 않으니 이름을 바꾸라고", read(path.join(ag5c, "prompts", "review.md")) === "내가 고친 리뷰 템플릿"
	&& !fs.existsSync(path.join(ag5c, "prompts.removed")) && out.includes("직접 고친 /review 템플릿") && out.includes("my-review.md"), out);
fs.rmSync(tmp, { recursive: true, force: true });
console.log("RESULT:", fails ? `FAIL (${fails})` : "PASS");
process.exit(fails ? 1 : 0);
