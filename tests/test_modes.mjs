// 작업 모드(profiles/common/agent-template/extensions/modes.ts) 단위 테스트: 읽기 전용 명령 판단, 계획 단계 찾기, 바뀐 줄 보기, /plan·진행 목록(가짜 pi)
// 사용법: node tests/test_modes.mjs   (Node 20.15 이상. 저장소의 runtime/node_modules/jiti 로 .ts 를 불러옴)
import { tmpdir as tmpdir0 } from "node:os";
import { join as join0 } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "../runtime/node_modules/jiti/lib/jiti.mjs";

// typebox: modes.ts 의 todo 도구 (pi 런타임에 들어 있는 것)
const jiti = createJiti(import.meta.url, { alias: { typebox: fileURLToPath(new URL("../runtime/node_modules/typebox/build/index.mjs", import.meta.url)) } });
const m = await jiti.import("../profiles/common/agent-template/extensions/modes.ts");
let fails = 0;
const check = (name, cond, detail = "") => {
	console.log((cond ? "OK   " : "FAIL ") + name + (cond ? "" : "  -> " + JSON.stringify(detail)));
	if (!cond) fails++;
};

// 계획 모드에서 실행해도 되는 명령 (읽기만)
const read = [
	"ls -la", "cat a.txt | head -50", "grep -rn foo src", "rg TODO", "find . -name '*.py'", "find . -name '*.py' -exec grep -l TODO {} +",
	"find . -type f -exec wc -l {} \\;", "git status", "git log --oneline -5", "git diff HEAD~1 --stat", "git -C repo status", "git --no-pager log",
	"git branch", "git branch -a", "git tag", "git tag -l 'v*'", "git stash list", "git remote -v", "git config user.name", "git config --list",
	"git show HEAD:a.py", "sed -n '1,20p' a.py", "sed -n '/^def /p' a.py", "awk '{print $1}' f", "awk -F: '$3 > 100 {print $1}' /etc/passwd",
	"awk 'NR==1 || $2==\"x\"' f", "wc -l $(git ls-files)", "cd src && ls", "ls 2>/dev/null", "ls > /dev/null 2>&1", "echo $HOME",
	"command -v python", "which python", "python --version", "python3 -V", "python -m pip list", "pip show numpy", "pip3 freeze", "conda env list",
	"conda list -n base", "npm ls", "kubectl get pods -A", "kubectl -n kubeflow get notebooks", "kubectl logs pod-x", "kubectl config get-contexts",
	"helm list -A", "docker ps", "docker image ls", "docker compose -f a.yml ps", "nvidia-smi", "nvidia-smi --query-gpu=name --format=csv",
	"jupyter kernelspec list", "tar -tzf a.tgz", "unzip -l a.zip", "du -sh *", "df -h", "ps aux | grep python", "for f in *.py; do wc -l $f; done",
	"if [ -f a ]; then cat a; fi", "test -d x && echo yes", "x=$(cat f); echo $x", "env | grep PATH", "head -c 100 f | xxd", "sort a.txt | uniq -c",
	"diff a b", "stat a", "cat <<'EOF'\nhello\nEOF", "date", "hostname", "hostname 2>/dev/null", "while read l; do echo $l; done < f",
	"timeout 5 cat f", "xargs grep foo < list.txt", "git log --oneline | head -3 && git status --short",
	// sed 는 보기만 하는 스크립트만 (주소 + p d q = l 등, s///g, y///, { }, 이름표)
	"sed 's/a/b/g' f", "sed -n '10,20p;30p' f", "sed -e 's/a/b/' -e 's/c/d/' f", "sed -n '$p' f", "sed '/^#/d' f", "sed -n '/start/,/end/p' f",
	"sed -E 's/(a|b)+/x/g' f", "sed -n '/x/{p;q}' f", "sed ':a;N;$!ba;s/\\n/ /g' f", "sed --quiet --expression='1p' f", "cat f | sed -n 3p",
	"echo $((1+2))", "echo $(( $(wc -l < f) + 1 ))", "ls 2>&1 | head", "go version", "git -c core.quotepath=off status", "git grep -c foo",
	"sort -u a.txt", "sort -t, -k2 a.csv", "helm template x c", "yq -P '.a' f.yaml", "yq -ojson '.a' f.yaml", "fd -H x", "fd -tx", "tar -tvf a.tar",
	"date -Iseconds", "tree -a", "awk -v n=1 '{print n}' f", "awk -F , '{print $1}' f",
];
for (const c of read) check(`읽기 전용: ${c.split("\n")[0]}`, m.readOnlyProblem(c) === null, m.readOnlyProblem(c));

// 계획 모드에서 막을 명령 (파일을 바꾸거나 다른 것을 실행)
const write = [
	"rm a.txt", "rm -rf build", "echo x > a.txt", "echo x >> a.txt", "ls 2>err.log", "cat a | tee b", "mv a b", "cp a b", "mkdir x", "touch x",
	"sed -i 's/a/b/' f", "sed -ni 's/a/b/p' f", "sed -n 'w out.txt' f", "sort -o out a", "python a.py", "python -c 'print(1)'", "python -m pytest",
	"pip install x", "python -m pip install x", "npm install", "npm config set x y", "git commit -m x", "git push", "git checkout main",
	"git branch new", "git branch -D x", "git tag v1", "git stash", "git stash pop", "git config user.name X", "git remote add o u",
	"git diff --output=x", "git fetch", "git pull", "kubectl apply -f x.yaml", "kubectl delete pod x", "kubectl config set-context x",
	"kubectl exec -it p -- bash", "helm install x c", "docker run x", "docker image rm x", "find . -delete", "find . -name '*.pyc' -exec rm {} +",
	"find . -fprint out", "awk '{print $1 > \"out\"}' f", "awk '{system(\"rm x\")}' f", "awk '{print | \"sh\"}' f", "uniq a b", "tar -xzf a.tgz",
	"tar -czf a.tgz d", "unzip a.zip", "nvidia-smi -pm 1", "sudo cat /etc/shadow", "bash -c 'ls'", "sh script.sh", "./run.sh", "make",
	"curl http://x", "wget http://x", "ls; rm x", "ls && touch y", "echo $(rm -rf x)", "cat <<EOF | bash\nls\nEOF", "chmod +x a", "ln -s a b",
	"hostname newname", "date -s '2020-01-01'", "xargs rm < list", "env X=1 python a.py", "jupyter notebook", "yq -i '.a=1' f.yaml",
	"rg --pre=sh foo", "fd -x rm", "tree -o out.txt", "git log > log.txt", "conda install x", "pip3 uninstall -y x", "git grep -Ovim foo",
	// 붙여 쓴 옵션, sed 의 쓰기·실행 (w, e, s///e, s///w, -e·--expression·-f), >&파일, tar·helm·git 의 실행 옵션, 낱말 version
	"sort -uo a.txt a.txt", "sort --output=a a", "sed -n '1,20w out.txt' f", "sed -n '$w out' f", "sed '1e cmd' f", "sed 's/.*/cmd/e' f",
	"sed 's|a|b|w out' f", "sed --expression='w out' f", "sed -e'w out' f", "sed -f script.sed f", "ls >&out.txt", "tar -tf a --checkpoint-action=exec=x",
	"tar -tf a -I cmd", "tar -tf a --use-compress-program=x", "make version", "python version", "node version", "helm template x c --output-dir out",
	"git -c diff.external=cmd diff", "git --config-env=x=y diff", "yq -Pi '.a=1' f", "fd -Hx rm",
	"sed 's/a/b/ w out' f", "sed 's/a/b/' -i f", "sed --i 's/a/b/' f", "sed -n 'b x;w out\n:x' f", "sed -n 'e' f", "ls >& out.txt",
	"echo $(( $(rm -rf x) + 1 ))", "tar -tf a --use=x", "helm template x c --post-renderer ./r.sh", "git -c core.pager=./x.sh log",
	"tree -ao out.txt", "date -us '2020-01-01'", "awk -f prog.awk f", "gawk -o '{print}' f", "awk '@include \"inplace\"; {print}' f",
	"sort --compress-program=sh a", "yq -s '.a' f.yaml",
];
for (const c of write) check(`막음: ${c.split("\n")[0]}`, typeof m.readOnlyProblem(c) === "string", m.readOnlyProblem(c));
check("막은 이유에 문제 부분 (리다이렉트)", /a\.txt/.test(m.readOnlyProblem("echo x > a.txt") || ""), m.readOnlyProblem("echo x > a.txt"));
check("막은 이유에 문제 부분 (명령)", (m.readOnlyProblem("ls && rm -rf build") || "").startsWith("rm -rf build"), m.readOnlyProblem("ls && rm -rf build"));

// 계획 단계 찾기
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
let s = m.planSteps("계획입니다.\n\n1. a.txt 만들기\n2. b.txt 고치기\n3. 확인\n\n승인해 주세요.");
check("번호 목록 -> 단계", eq(s, ["a.txt 만들기", "b.txt 고치기", "확인"]), s);
s = m.planSteps("1단계: 준비\n2단계: 실행");
check("1단계: 형식", eq(s, ["준비", "실행"]), s);
s = m.planSteps("### 1. 준비\n내용\n### 2. 실행\n내용");
check("제목(###) 형식", eq(s, ["준비", "실행"]), s);
s = m.planSteps("**1. 준비**: 폴더 확인\n**2. 실행**");
check("굵은 글씨 형식", eq(s, ["준비: 폴더 확인", "실행"]), s);
s = m.planSteps("1. a\n   1. 세부\n   2. 세부\n2. b\n\n질문:\n1. 어느 쪽?\n2. 언제?");
check("안쪽 목록·뒤의 질문 목록은 단계가 아님", eq(s, ["a", "b"]), s);
// 2026-10 시험(깊이 생각하기): 답이 '1. 확인된 내용: 2. 계획:' 절로 되어 있고 실제 단계는 '2. 계획:' 안에 있음 -> 2단계로 셈
s = m.planSteps("1. 확인된 내용:\n   - put_df 는 fmt 를 이름으로만 받음\n2. 계획:\n   1. storage.py 확인\n      - 시그니처\n   2. us_spike 고치기\n   3. 시험\n\n승인해 주세요.");
check("번호 붙인 절 안의 계획: '계획' 절 안의 목록이 단계", eq(s, ["storage.py 확인", "us_spike 고치기", "시험"]), s);
check("번호가 없으면 계획 아님", m.planSteps("설명만 있는 답입니다.").length === 0);
check("단계 하나는 계획 아님 (2개 이상부터)", m.planSteps("1. 하나만").length === 1);

// 바뀐 줄 보기 (확인 모드)
let d = m.lineDiff("a\nb\nc\n", "a\nB\nc\n");
check("바뀐 줄만 (- 지움, + 넣음)", d === "(2번째 줄부터)\n- b\n+ B", d);
check("같으면 (내용 같음)", m.lineDiff("x\n", "x\n") === "(내용 같음)");
d = m.lineDiff("", Array.from({ length: 30 }, (_, i) => "l" + i).join("\n"), 5);
check("길면 줄여서 (… n줄 더)", d.includes("+ l4") && !d.includes("+ l5") && d.includes("25줄 더"), d);

// 확장 동작 (가짜 pi. session_start 는 내 설정 파일을 읽으므로 부르지 않음): /plan <요청>, 진행 목록
//  할 일 목록 파일은 임시 폴더에 (진짜 ~/.pi/agent/todo 에 쓰지 않게), 브라우저는 열지 않음
const { mkdtempSync: mkTmp } = await import("node:fs");
const AGENT0 = mkTmp(join0(tmpdir0(), "modes-agent0-"));
process.env.PI_CODING_AGENT_DIR = AGENT0;
process.env.PI_TODO_OPEN = "0";
const on = {};
const cmds = {};
const tools = {};
const sent = [];
const notes = [];
const widgets = [];
let idle = true;
let setModelResult = true; // pi.setModel 은 인증이 없으면 false
const modelSets = [];
m.default({
	on: (e, f) => (on[e] ||= []).push(f), registerCommand: (n, def) => (cmds[n] = def), sendUserMessage: (text, opts) => sent.push({ text, opts, at: modelSets.length }),
	setModel: async (mm) => (modelSets.push(mm), setModelResult), registerTool: (t) => (tools[t.name] = t),
});
const ctx = {
	hasUI: true,
	isIdle: () => idle,
	ui: { notify: (t) => notes.push(t), setStatus() {}, setWidget: (k, v) => widgets.push({ k, v }), select: async (_t, opts) => opts[0], confirm: async () => true },
};
const tick = () => new Promise((r) => setTimeout(r, 20));
// 확장이 setTimeout 으로 따로 하는 일(보내기, 계획서·설정 읽기, 모델 바꾸기)은 보낸 글이 늘 때까지 기다림 (5초까지).
//  20 ms 만 기다리던 때는 가끔 실패함 (2026-10-29 API 키트에서 2개)
const sentAfter = async (n0) => {
	for (const t0 = Date.now(); sent.length <= n0 && Date.now() - t0 < 5000; ) await tick();
};
await cmds.plan.handler("/review src", ctx);
await tick();
check("/plan /명령: 보내지 않고 직접 입력하라고 알림", sent.length === 0 && notes.at(-1).includes("/review src"), { sent, notes });
check("/plan /명령: 계획 모드로는 바뀜", globalThis.__piMode === "plan");
idle = false;
await cmds.plan.handler("a.py 정리 계획", ctx);
await sentAfter(0);
check("/plan <요청>: 다른 작업 중이면 끝난 뒤 보냄 (followUp)", sent.length === 1 && sent[0].text === "a.py 정리 계획" && sent[0].opts?.deliverAs === "followUp" && notes.at(-1).includes("끝나면"), { sent, notes });
idle = true;
const nNotes = notes.length;
await cmds.plan.handler("b.py 도", ctx);
await sentAfter(1);
check("/plan <요청>: 쉬고 있으면 바로 보냄 (알림 없음)", sent.length === 2 && sent[1].text === "b.py 도" && notes.length === nNotes, { sent, notes });
const tr = await on.input[0]({ text: "a.py 정리 계획", source: "extension" }, ctx);
check("보낸 요청에 계획 모드 안내가 붙음", tr?.action === "transform" && tr.text.startsWith("[계획 모드]") && tr.text.endsWith("a.py 정리 계획"), tr);
const { rawInput } = await jiti.import("../profiles/common/agent-template/extensions/lib/relay.ts");
check("안내를 붙인 글에서 사용자가 친 그대로를 되찾음 (나중에 불리는 확장: /wiki save·작업 기록)", rawInput(tr.text) === "a.py 정리 계획" && rawInput("다른 글") === "다른 글");
const blocked = async (toolName, input = {}) => (await on.tool_call[0]({ toolName, input }, ctx))?.block === true;
check("계획 모드: 위키 찾기·읽기와 문서 찾기는 쓸 수 있고, 위키 쓰기는 막음",
	!(await blocked("wiki_search", { query: "x" })) && !(await blocked("wiki_read", { path: "index.md" })) && !(await blocked("docs_lookup", { name: "numpy" }))
	&& (await blocked("wiki_write", { text: "=== pages/a/B.md" })) && (await blocked("write", { path: "a.py", content: "" })));
const plan = Array.from({ length: 11 }, (_, i) => `${i + 1}. 단계${i + 1}`).join("\n");
await on.agent_start[0]({}, ctx);
await on.message_end[0]({ message: { role: "assistant", content: plan } }, ctx);
const nPlan = sent.length;
await on.agent_settled[0]({}, ctx);
await sentAfter(nPlan);
let w = widgets.at(-1);
check("진행 목록은 글 하나로 (pi 화면은 항목 10개까지만 보여 줌)", w?.k === "pi-kit-plan" && w.v.length === 1 && w.v[0].split("\n").length === 12 && w.v[0].includes("11. 단계11"), w);
check("진행을 고르면 자동 모드로 바꾸고 진행 요청", globalThis.__piMode === "auto" && sent.at(-1).text.includes("모두 11단계"), sent.at(-1));
await on.message_end[0]({ message: { role: "assistant", content: "[1단계 완료]" } }, ctx);
w = widgets.at(-1);
check("단계 완료 체크", w.v.length === 1 && w.v[0].includes("[x] 1. 단계1") && w.v[0].includes("1/11"), w);

// 계획서: 계획 모드에서도 계획서(docs/plans 아래 .md, 이름에 계획·plan 이 든 .md)는 쓸 수 있음
// (2026-10: 계획서를 남겨 달라고 해도 '쓰기가 막혀 못 쓴다' 고 답함). 답에 단계가 없으면 계획서의 단계로 진행할지 물음
const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import("node:fs");
const { tmpdir } = await import("node:os");
const { join } = await import("node:path");
const P = await jiti.import("../profiles/common/agent-template/extensions/lib/paths.ts");
check("계획서인지: 계획서 폴더 아래 .md, 이름에 계획·plan·todo 가 든 .md (코드·다른 문서는 아님)",
	P.isPlanDoc("docs/plans/정리.md") && P.isPlanDoc("작업계획.md") && P.isPlanDoc("docs/release-plan.md") && P.isPlanDoc("TODO.md")
	&& !P.isPlanDoc("docs/plans/a.py") && !P.isPlanDoc("README.md") && !P.isPlanDoc("docs/planner-notes.md") && !P.isPlanDoc(null) && P.isPlanDoc("plans/a.md", "plans"));
const W = mkdtempSync(join(tmpdir(), "modes-plan-"));
mkdirSync(join(W, "docs", "plans"), { recursive: true });
globalThis.__piWorkDir = { remote: false, cwd: W };
await cmds.plan.handler("", ctx);
check("계획 모드 안내: 계획서는 지금 쓰라고 (승인을 기다리지 말고, 단계로 넣지 말고) 쓸 수 있는 곳과 함께", globalThis.__piMode === "plan" && m.planNote("docs/plans").includes("지금 write 로 docs/plans/<이름>.md") && m.planNote("x").includes("승인을 기다리지 말고") && m.planNote("x").includes("단계로 넣지는 마세요"));
const reasonOf = async (toolName, input) => (await on.tool_call[0]({ toolName, input }, ctx))?.reason || "";
check("계획 모드: 계획서는 쓰고 고칠 수 있음",
	!(await blocked("write", { path: "docs/plans/정리.md", content: "1. a" })) && !(await blocked("edit", { path: "작업계획.md", edits: [] }))
	&& !(await blocked("write", { path: join(W, "docs/plans/abs.md"), content: "" })));
check("계획 모드: 계획서가 아닌 파일·작업 폴더 밖은 막고, 막을 때 계획서를 쓸 수 있는 곳을 알림",
	(await blocked("write", { path: "src/a.py", content: "" })) && (await blocked("edit", { path: "README.md", edits: [] })) && (await blocked("write", { path: "../plan.md", content: "" }))
	&& (await reasonOf("write", { path: "src/a.py", content: "" })).includes("docs/plans/ 아래의 .md"));
writeFileSync(join(W, "docs/plans/정리.md"), "# a.py 정리 계획\n\n1. 함수 나누기\n2. 시험 더하기\n3. 문서 고치기\n");
await on.agent_start[0]({}, ctx);
await on.tool_call[0]({ toolName: "write", input: { path: "docs/plans/정리.md", content: "..." } }, ctx);
await on.message_end[0]({ message: { role: "assistant", content: "계획서를 docs/plans/정리.md 에 썼습니다. 확인해 주세요." } }, ctx);
const nSent = sent.length;
await on.agent_settled[0]({}, ctx);
await sentAfter(nSent);
check("답에 단계가 없으면 계획서의 단계로 진행할지 묻고, 진행 요청에 계획서를 적음",
	sent.length === nSent + 1 && sent.at(-1).text.includes("계획서 docs/plans/정리.md") && sent.at(-1).text.includes("모두 3단계") && globalThis.__piMode === "auto", sent.at(-1));
// 승인한 계획은 기본 모델로 진행 (2026-10: 고급 모델은 사용량이 적어 계획에만 쓰고 진행은 GPT-5.6 Sol 깊이 생각하기로)
const ST = { defaultProvider: "copilot", defaultModel: "gpt-5.6-sol-think" };
check("진행할 모델: 설정이 없으면 pi 의 기본 모델, provider/id·id 만, 'same' 이면 바꾸지 않음",
	JSON.stringify(m.executeModel({}, ST)) === JSON.stringify({ provider: "copilot", id: "gpt-5.6-sol-think", explicit: false })
	&& JSON.stringify(m.executeModel({ plan_execute_model: "copilot/claude-sonnet-5.5" }, ST)) === JSON.stringify({ provider: "copilot", id: "claude-sonnet-5.5", explicit: true })
	&& JSON.stringify(m.executeModel({ plan_execute_model: "gpt-5.6-sol-fast" }, ST)) === JSON.stringify({ provider: "copilot", id: "gpt-5.6-sol-fast", explicit: false })
	&& m.executeModel({ plan_execute_model: "same" }, ST) === null && m.executeModel({}, {}) === null);
const AG = mkdtempSync(join(tmpdir(), "modes-agent-"));
writeFileSync(join(AG, "settings.json"), JSON.stringify(ST));
writeFileSync(join(AG, "bridge.json"), "{}");
const envBefore = [process.env.PI_CODING_AGENT_DIR, process.env.PI_COPILOT_USER_CONFIG];
process.env.PI_CODING_AGENT_DIR = AG;
process.env.PI_COPILOT_USER_CONFIG = join(AG, "bridge.json");
ctx.model = { provider: "copilot", id: "claude-opus-5.5" };
ctx.modelRegistry = { find: (p, id) => ({ provider: p, id }) };
const approve = async () => {
	await cmds.plan.handler("", ctx);
	await on.agent_start[0]({}, ctx);
	await on.message_end[0]({ message: { role: "assistant", content: "1. 나누기\n2. 시험" } }, ctx);
	const n0 = sent.length;
	await on.agent_settled[0]({}, ctx);
	await sentAfter(n0);
};
let nSet = modelSets.length;
await approve();
check("고급 모델로 세운 계획을 승인하면 기본 모델로 바꾼 뒤 진행 요청 (알림)",
	modelSets.length === nSet + 1 && modelSets.at(-1).id === "gpt-5.6-sol-think" && sent.at(-1).at === modelSets.length && notes.at(-1).includes("진행은 gpt-5.6-sol-think"), [modelSets.slice(nSet), notes.at(-1)]);
ctx.model = { provider: "copilot", id: "gpt-5.6-sol-think" };
nSet = modelSets.length;
await approve();
check("이미 기본 모델이면 바꾸지 않음", modelSets.length === nSet);
writeFileSync(join(AG, "bridge.json"), JSON.stringify({ plan_execute_model: "same" }));
ctx.model = { provider: "copilot", id: "claude-opus-5.5" };
nSet = modelSets.length;
await approve();
check('"plan_execute_model": "same" 이면 고급 모델 그대로 진행', modelSets.length === nSet);
// 릴리스 전 검토: 다른 제공자로 넘어가지 않게, setModel 이 false 면 바꿨다고 알리지 않게
writeFileSync(join(AG, "bridge.json"), "{}");
ctx.model = { provider: "inhouse", id: "inhouse-sonnet" };
nSet = modelSets.length;
await approve();
check("사내AI 로 세운 계획: 기본 모델이 Copilot 이어도 바꾸지 않음 (대화가 다른 중계 서버로 넘어감)", modelSets.length === nSet, modelSets.slice(nSet));
writeFileSync(join(AG, "bridge.json"), JSON.stringify({ plan_execute_model: "copilot/gpt-5.6-sol-think" }));
nSet = modelSets.length;
await approve();
check("plan_execute_model 을 provider/id 로 적었으면 다른 제공자로도 바꿈", modelSets.length === nSet + 1 && modelSets.at(-1).provider === "copilot", modelSets.slice(nSet));
writeFileSync(join(AG, "bridge.json"), "{}");
ctx.model = { provider: "copilot", id: "claude-opus-5.5" };
setModelResult = false;
const nNotesSet = notes.length;
await approve();
setModelResult = true;
check("setModel 이 false 면 '바꾸지 못해 지금 모델로' 를 알리고 '진행은 … 로' 는 알리지 않음",
	notes.slice(nNotesSet).some((x) => x.includes("바꾸지 못해")) && !notes.slice(nNotesSet).some((x) => x.includes("진행은 gpt-5.6-sol-think")), notes.slice(nNotesSet));
[process.env.PI_CODING_AGENT_DIR, process.env.PI_COPILOT_USER_CONFIG] = envBefore;
if (envBefore[0] === undefined) delete process.env.PI_CODING_AGENT_DIR;
if (envBefore[1] === undefined) delete process.env.PI_COPILOT_USER_CONFIG;
rmSync(AG, { recursive: true, force: true });
rmSync(W, { recursive: true, force: true });

// ── 할 일 목록 (todo 도구, /todo, 2026-11-02): 브라우저로 보는 HTML 파일, 단계별 시작·끝 시각, 전체 진행 ──
const PT = (t) => m.parseTodo(t).map((x) => `${x.level}${x.status[0]}:${x.text}`).join("|");
check("목록 읽기: [ ] 할 일·[~] 하는 중·[x] 끝남, 두 칸 들여쓰기가 하위 단계, 목록이 아닌 줄은 건너뜀",
	PT("할 일:\n- [x] 데이터 확인\n- [~] 모델 학습\n  - [x] 피처 만들기\n  - [ ] 학습 돌리기\n    - [ ] 로그 보기\n- [ ] 보고\n\n끝") === "0d:데이터 확인|0d:모델 학습|1d:피처 만들기|1t:학습 돌리기|2t:로그 보기|0t:보고", PT("할 일:\n- [x] 데이터 확인\n- [~] 모델 학습\n  - [x] 피처 만들기\n  - [ ] 학습 돌리기\n    - [ ] 로그 보기\n- [ ] 보고"));
check("목록 읽기: 번호(1. 1.1), 탭, * 와 X·> 표시, 첫 줄이 들여 쓰였거나 두 단계를 건너뛰어도 한 단계씩",
	PT("1. [X] 가\n1.1 [>] 나\n2. 다") === "0d:가|1d:나|0t:다" && PT("\t* [ ] 가\n\t\t\t\t* [~] 나") === "0t:가|1d:나" && PT("  - 가\n- 나") === "0t:가|0t:나"
	&& m.parseTodo("").length === 0 && m.parseTodo("그냥 글").length === 0 && m.parseTodo("- [ ]").length === 0, [PT("1. [X] 가\n1.1 [>] 나\n2. 다"), PT("\t* [ ] 가\n\t\t\t\t* [~] 나")]);
check(`목록 읽기: ${m.TODO_MAX}개까지, 글은 120자까지`, m.parseTodo(Array.from({ length: 80 }, (_, i) => `- [ ] ${i}`).join("\n")).length === m.TODO_MAX && m.parseTodo(`- ${"가".repeat(300)}`)[0].text.length <= 121);
check("번호: 1, 1.1, 1.2, 1.2.1, 2", JSON.stringify(m.todoNumbers([{ level: 0 }, { level: 1 }, { level: 1 }, { level: 2 }, { level: 0 }])) === JSON.stringify(["1", "1.1", "1.2", "1.2.1", "2"]));
const meta = { project: "lab", cwd: "C:/w/lab", remote: false, request: "학습 파이프라인 만들기" };
let t1 = m.mergeTodo(null, m.parseTodo("- [~] 가\n- [ ] 나\n  - [ ] 나1\n  - [ ] 나2\n- [ ] 다"), 1000, meta);
check("처음 목록: 하는 중이면 시작 시각, 상위 단계는 하위 단계로, 새 작업이면 만든 때·요청",
	t1.items[0].started === 1000 && t1.items[1].status === "todo" && t1.items[1].started === null && t1.created === 1000 && t1.updates === 1 && t1.request === "학습 파이프라인 만들기", t1);
let t2 = m.mergeTodo(t1, m.parseTodo("- [x] 가\n- [~] 나\n  - [~] 나1\n  - [ ] 나2\n- [ ] 다"), 2000, { ...meta, request: "다음 요청" });
check("고친 목록: 끝나면 끝 시각, 하위 단계가 시작하면 상위 단계도 하는 중 (시작 = 하위 단계의 시작), 같은 작업이면 처음 요청·만든 때 그대로",
	t2.items[0].ended === 2000 && t2.items[0].started === 1000 && !t2.items[0].approx && t2.items[1].status === "doing" && t2.items[1].started === 2000 && t2.items[2].started === 2000
	&& t2.created === 1000 && t2.updates === 2 && t2.request === "학습 파이프라인 만들기", t2.items);
let t3 = m.mergeTodo(t2, m.parseTodo("- [x] 가\n- [~] 나\n  - [x] 나1 (고침)\n  - [x] 나2\n- [x] 다"), 3000, meta);
check("하위 단계가 모두 끝나면 상위 단계도 끝남 (끝 = 마지막 하위 단계), 시작을 알리지 않고 끝난 단계는 앞 목록을 받은 때부터 (어림), 글만 조금 고친 단계는 시각을 이어 감",
	t3.items[1].status === "done" && t3.items[1].ended === 3000 && t3.items[2].started === 2000 && !t3.items[2].approx && t3.items[3].started === 2000 && t3.items[3].approx === true
	&& t3.items[4].approx === true, t3.items);
const s3 = m.todoSummary(t3);
check("전체: 맨 아래 단계로 셈 (끝남 4/4, 100%), 시작·끝 시각, 모두 끝남", s3.total === 4 && s3.done === 4 && s3.pct === 100 && s3.all && s3.started === 1000 && s3.ended === 3000, s3);
const t4 = m.mergeTodo(t3, m.parseTodo("- [x] 가\n- [x] 나\n  - [x] 나1 (고침)\n  - [ ] 나2\n- [ ] 다"), 4000, meta);
check("다시 연 단계(끝남 -> 할 일)는 시각을 지우고, 상위 단계를 끝났다고 하면 체크하지 않은 하위 단계도 끝남",
	t4.items[4].status === "todo" && t4.items[4].ended === null && t4.items[4].started === null && t4.items[3].status === "done" && t4.items[3].ended === 4000 && t4.items[3].approx === true, t4.items);
const t5 = m.mergeTodo(t4, m.parseTodo("- [~] 전혀 다른 일\n- [ ] 둘째"), 5000, { ...meta, request: "새 요청" });
check("겹치는 단계가 없으면 새 작업 (만든 때·요청·갱신 수 새로)", t5.created === 5000 && t5.updates === 1 && t5.request === "새 요청");
const pl = m.planTodo(["준비", "실행", "정리"], 1000, meta);
check("승인한 계획: 단계 목록, 첫 단계는 하는 중", pl.source === "plan" && pl.items.length === 3 && pl.items[0].status === "doing" && pl.items[0].started === 1000);
check("[N단계 완료]: 그 단계를 끝내고 다음 단계를 하는 중으로, 이미 끝났거나 없는 단계는 그대로",
	m.stepDone(pl, 1, 2000) && pl.items[0].ended === 2000 && pl.items[1].status === "doing" && pl.items[1].started === 2000 && !m.stepDone(pl, 1, 2500) && !m.stepDone(pl, 9, 2500)
	&& m.stepDone(pl, 3, 3000) && pl.items[2].approx === true && pl.items[2].started === 2000, pl.items);
// 계획을 다듬어 다시 승인 (2026-11-04 사용자: 8단계 계획을 진행하다 계획 모드에서 다듬었더니 1~2단계만 남고 3개로 줄어듦)
check("계획 단계: 끝난 단계 표시 ((끝남)·(완료)·✅) 는 글 끝의 (끝남) 하나로, 70자로 자르기 전에 봄",
	JSON.stringify(m.planSteps("1. 가 (끝남)\n2. ✅ 나:\n3. **다** (완료)\n4. 라")) === JSON.stringify(["가 (끝남)", "나 (끝남)", "다 (끝남)", "라"])
	&& m.planSteps(`1. ${"가".repeat(90)} (끝남)\n2. 나`)[0].endsWith("… (끝남)"), [m.planSteps("1. 가 (끝남)\n2. ✅ 나:\n3. **다** (완료)\n4. 라"), m.planSteps(`1. ${"가".repeat(90)} (끝남)\n2. 나`)[0]]);
// 계획의 하위 작업 -> 할 일 목록의 하위 단계 (2026-11-05 사용자: 하위 작업까지 세운 계획인데 목록에는 맨 위 5단계만)
const KX = (kids) => kids.map((k) => k.map((x) => `${x.level}${x.status[0]}:${x.text}`).join("|"));
const P1 = "계획입니다.\n1. 준비\n   - 파일 읽기\n   - 바꿀 파일: a.py\n2. **고치기**\n   1. 함수 a 고치기\n   2. 함수 b 고치기\n      - b 의 시험\n3. 시험 (끝남)\n   - 할 일: 전체 시험 실행\n\n질문:\n1. 이대로 할까요?";
const P2 = "### 1단계: 준비\n- 파일 읽기\n- [x] 구조 확인\n### 2단계: 고치기\n- 함수 고치기\n\n## 질문\n- 이대로?";
const P3 = "1. 준비\n1.1 파일 읽기\n1.2 구조 확인\n2. 고치기\n2.1 함수 a\n2.1.1 a 의 시험";
check("계획의 하위 작업: 들여 쓴 목록(- · 1.), 제목 단계 아래의 목록, 'N.1' 번호 -> 하위 단계 (깊이대로), '바꿀 파일:' 은 빼고 '할 일:' 은 뗌, 질문 절은 넣지 않음",
	JSON.stringify(m.planSteps(P1)) === JSON.stringify(["준비", "고치기", "시험 (끝남)"])
	&& JSON.stringify(KX(m.planKids(P1, m.planSteps(P1)))) === JSON.stringify(["1t:파일 읽기", "1t:함수 a 고치기|1t:함수 b 고치기|2t:b 의 시험", "1t:전체 시험 실행"])
	&& JSON.stringify(KX(m.planKids(P2, m.planSteps(P2)))) === JSON.stringify(["1t:파일 읽기|1d:구조 확인", "1t:함수 고치기"])
	&& JSON.stringify(KX(m.planKids(P3, m.planSteps(P3)))) === JSON.stringify(["1t:파일 읽기|1t:구조 확인", "1t:함수 a|2t:a 의 시험"])
	&& m.planKids(P1, ["없는 단계", "고치기"]).every((k) => k.length === 0), [m.planSteps(P1), KX(m.planKids(P1, m.planSteps(P1))), KX(m.planKids(P2, m.planSteps(P2))), KX(m.planKids(P3, m.planSteps(P3)))]);
const pk = m.replanTodo(null, m.planSteps(P1), 100, meta, m.planKids(P1, m.planSteps(P1)));
const PKT = (s) => s.items.map((x) => `${x.level}${{ todo: "_", doing: "~", done: "x" }[x.status]}:${x.text}`).join("|");
check("하위 작업이 든 계획 -> 목록: 남은 첫 단계와 그 첫 하위 작업이 하는 중, 끝난 단계의 하위 작업도 끝남",
	PKT(pk) === "0~:준비|1~:파일 읽기|0_:고치기|1_:함수 a 고치기|1_:함수 b 고치기|2_:b 의 시험|0x:시험|1x:전체 시험 실행", PKT(pk));
m.stepDone(pk, 1, 200);
check("[1단계 완료]: 다음 단계에 하위 작업이 있으면 그 첫 맨 아래 단계가 하는 중 (위 단계는 따라감)",
	PKT(pk).startsWith("0x:준비|1x:파일 읽기|0~:고치기|1~:함수 a 고치기|1_:함수 b 고치기") && m.todoSummary(pk).current === "2.1 함수 a 고치기", PKT(pk));
const fk = m.fitPlan(pk, m.parseTodo("- [x] 첫 단계\n- [~] 둘째 단계\n- [x] 셋째 단계"));
const FK = fk.map((l) => `${l.level}${{ todo: "_", doing: "~", done: "x" }[l.status]}:${l.text}`).join("|");
check("계획 진행 중 모델이 맨 위 단계만 보냄: 계획의 하위 작업은 그대로 (끝났다고 한 단계의 하위 작업은 끝남, 글은 계획대로)",
	FK === "0x:준비|1x:파일 읽기|0~:고치기|1~:함수 a 고치기|1_:함수 b 고치기|2_:b 의 시험|0x:시험|1x:전체 시험 실행", FK);
const P5 = Array.from({ length: 5 }, (_, i) => `${i + 1}. 큰 단계${i + 1}\n${Array.from({ length: 4 }, (_, j) => `   - 작업${i + 1}-${j + 1}`).join("\n")}`).join("\n");
const p5 = m.replanTodo(null, m.planSteps(P5), 1, meta, m.planKids(P5, m.planSteps(P5)));
m.stepDone(p5, 1, 2);
const w5 = m.todoWidget(p5).split("\n");
check("입력창 위: 12줄이 넘으면 맨 위 단계와 지금 단계의 하위 단계만, 다른 단계는 하위 단계 수 (5단계 + 하위 20개)",
	p5.items.length === 25 && w5.length === 1 + 5 + 4 && w5.includes(" [~] 2. 큰 단계2") && w5.includes("    [~] 2.1 작업2-1") && w5.includes(" [x] 1. 큰 단계1 (하위 4/4)") && w5.includes(" [ ] 5. 큰 단계5 (하위 0/4)") && !w5.some((l) => l.includes("작업3-1")), w5);
const S8 = Array.from({ length: 8 }, (_, i) => `단계${i + 1}`);
const p8 = m.planTodo(S8, 1000, meta);
m.stepDone(p8, 1, 2000);
m.stepDone(p8, 2, 3000);
const r8 = m.replanTodo(p8, ["단계1", "단계2 (끝남)", "단계3 + 시험", ...S8.slice(3)], 4000, { ...meta, request: "계획 보완" });
check("다듬은 계획: 끝난 단계는 끝남과 시각 그대로, 남은 첫 단계가 하는 중 (시작 시각 이어 감), 처음 요청·만든 때 그대로",
	r8.items.length === 8 && r8.items[0].status === "done" && r8.items[0].ended === 2000 && r8.items[1].ended === 3000 && r8.items[2].status === "doing" && r8.items[2].text === "단계3 + 시험"
	&& r8.items[2].started === 3000 && r8.items[3].status === "todo" && r8.created === 1000 && r8.request === meta.request && r8.updates === p8.updates + 1 && r8.source === "plan", r8.items);
const rNew = m.replanTodo(p8, ["전혀 다른 일", "둘째 (끝남)"], 5000, { ...meta, request: "새 일" });
const rDone = m.replanTodo(m.mergeTodo(null, m.parseTodo("- [x] 단계1"), 1, meta), ["단계1", "단계2"], 6000, meta);
check("다듬은 계획: 겹치는 단계가 없으면 새 목록 ((끝남) 표시만 끝남), 끝난 목록이나 목록이 없으면 처음부터",
	rNew.created === 5000 && rNew.request === "새 일" && rNew.items[0].status === "doing" && rNew.items[1].status === "done" && rNew.items[1].text === "둘째"
	&& rDone.items[0].status === "doing" && rDone.updates === 1 && m.replanTodo(null, ["가", "나"], 1, meta).items[0].status === "doing", [rNew.items, rDone.items]);
const CHANGED = "바뀐 점:\n1. 3단계에 시험 추가\n2. 6단계 뺌\n3. 끝에 정리\n\n고친 계획:\n" + ["단계1 (끝남)", "단계2 (끝남)", "단계3 + 시험", "단계4", "단계5", "단계7", "단계8", "정리"].map((s, i) => `${i + 1}. ${s}`).join("\n");
check("다듬은 답: 앞의 '바뀐 점' 번호 목록보다 진행하던 목록과 겹치는 단계가 많은 전체 계획을 고름 (더 나은 것이 없으면 null)",
	JSON.stringify(m.planSteps(CHANGED)) === JSON.stringify(["3단계에 시험 추가", "6단계 뺌", "끝에 정리"]) && m.replanSteps(CHANGED, p8, m.planSteps(CHANGED))?.length === 8
	&& m.replanSteps(CHANGED, p8, m.planSteps(CHANGED))[0] === "단계1 (끝남)" && m.replanSteps(PLAN8_OK(), p8, m.planSteps(PLAN8_OK())) === null && m.replanSteps(CHANGED, null, []) === null,
	m.replanSteps(CHANGED, p8, m.planSteps(CHANGED)));
function PLAN8_OK() { return S8.map((s, i) => `${i + 1}. ${s}`).join("\n"); }
check("계획 모드 안내 뒤의 지금 목록: 끝나지 않은 목록만, 끝난 단계에 (끝남), 전체를 다시 적으라고 (바뀐 점은 번호 없이)",
	m.planNow(p8).includes("[지금 진행 중인 계획: 8단계 중 2단계 끝남]") && m.planNow(p8).includes("\n1. 단계1 (끝남)\n2. 단계2 (끝남)\n3. 단계3\n") && m.planNow(p8).includes("고친 계획 전체를 1단계부터")
	&& m.planNow(p8).includes("바뀐 점은 번호 없이") && m.planNow(null) === "" && m.planNow(m.mergeTodo(null, m.parseTodo("- [x] a"), 1, meta)) === ""
	&& m.planNow(t1).includes("[지금 진행 중인 할 일 목록:"), m.planNow(p8));
check("입력창 위 목록: 계획은 예전 모양 (계획 진행 n/m, [x] 1. 단계), 할 일은 들여 쓴 하위 단계와 [~]·진행률·브라우저 안내",
	m.todoWidget(pl).startsWith("── 계획 진행 2/3") && m.todoWidget(pl).includes(" [x] 1. 준비") && m.todoWidget(pl).includes(" [~] 2. 실행")
	&& m.todoWidget(t2).includes("── 할 일 1/4 (25%)") && m.todoWidget(t2).includes("    [~] 2.1 나1") && m.todoWidget(t2).includes("/todo open"), [m.todoWidget(pl), m.todoWidget(t2)]);
const k1 = m.todoKey("C:\\Users\\a\\work\\lab", false);
check("파일 이름: 작업 폴더의 끝 두 이름 + 짧은 해시 (Windows 는 대소문자 같음), 노트북은 nb-, 쓸 수 없는 글자는 _",
	/^work-lab-[0-9a-f]{8}$/.test(k1) && (process.platform !== "win32" || m.todoKey("c:/users/A/Work/LAB/", false).endsWith(k1.slice(-8))) && m.todoKey("/home/jovyan/work/lab", true).startsWith("nb-work-lab-")
	&& m.todoKey("C:/w/a b:c*", false).startsWith("w-a_b_c_-") && m.todoKey("C:/x/한글 폴더", false).startsWith("x-한글_폴더-"), [k1, m.todoKey("C:/w/a b:c*", false)]);
const tricky = m.mergeTodo(null, m.parseTodo("- [~] </script><b>x</b>"), 1, meta);
const bt = m.emptyBoard();
m.addTask(bt, tricky, 1);
const html = m.boardHtml(bt, "board.data.js");
check("작업판 HTML: 처음 작업판을 담고(</script> 같은 글은 바꿔 담음), 옆의 board.data.js 를 다시 읽음, 진행·완료 탭, 밖의 파일·서버는 쓰지 않음",
	html.includes('var FILE = "board.data.js"') && html.includes("\\u003c/script>\\u003cb>") && !/https?:\/\//.test(html) && !html.includes("localhost") && (html.match(/<\/script>/g) || []).length === 2
	&& html.includes('data-tab="open"') && html.includes('data-tab="closed"') && m.boardDataJs(bt).startsWith("window.__piBoard && window.__piBoard({") && m.boardHtml(null, "x.js").includes("window.__PI_BOARD_INIT = null"));
// 작업판의 작업 (2026-11-04 사용자: 급한 일로 바꾸면 하던 일을 잊음 -> 모든 작업을 작업판에, 입력창 위에는 지금 작업만)
const b1 = m.emptyBoard();
const ta = m.addTask(b1, m.mergeTodo(null, m.parseTodo("- [~] 가\n- [ ] 나"), 10, meta), 10);
const tb = m.addTask(b1, m.mergeTodo(null, m.parseTodo("- [x] 다"), 20, meta), 20);
check("작업: 번호는 하나씩 늘고, 새 작업은 하는 중, 모든 단계가 끝난 목록은 바로 완료",
	ta.no === 1 && tb.no === 2 && b1.next === 3 && ta.state === "doing" && tb.state === "done" && tb.closed === 20 && ta.id !== tb.id, b1);
m.putTask(ta, m.mergeTodo(ta, m.parseTodo("- [x] 가\n- [x] 나"), 30, meta), 30);
const n1 = { ...ta };
m.putTask(ta, m.mergeTodo(ta, m.parseTodo("- [x] 가\n- [ ] 나"), 40, meta), 40);
check("작업 고치기: 번호·id 그대로, 모두 끝나면 완료, 다시 열린 단계가 있으면 다시 하는 중",
	n1.state === "done" && n1.closed === 30 && n1.no === 1 && ta.state === "doing" && ta.closed === null && ta.id === n1.id, [n1, ta]);
const b2 = m.emptyBoard();
for (let i = 0; i < m.BOARD_KEEP + 5; i++) Object.assign(m.addTask(b2, m.mergeTodo(null, m.parseTodo("- [x] a"), i, meta), i), { closed: i });
m.addTask(b2, m.mergeTodo(null, m.parseTodo("- [ ] 남은 일"), 9999, meta), 9999);
m.pruneBoard(b2);
check(`끝난 작업은 최근 ${m.BOARD_KEEP}개만 (진행 중 작업은 모두 남김)`, b2.tasks.filter((t) => !m.isOpen(t)).length === m.BOARD_KEEP && b2.tasks.some((t) => t.items[0].text === "남은 일") && !b2.tasks.some((t) => t.closed === 0));
const rs = m.resumeText(Object.assign(m.addTask(m.emptyBoard(), m.planTodo(["준비", "실행", "정리"], 1, { ...meta, request: "배포 정리" }), 1), { no: 7 }), "로그도 봐 줘");
check("이어서 할 때 모델에게: 작업 번호·처음 요청·단계(끝남·하던 중), 남은 단계부터, 계획이면 [N단계 완료], 덧붙인 말",
	rs.includes("쉬던 작업 #7") && rs.includes("처음 요청: 배포 정리") && rs.includes("1. 준비 (하던 중)") && rs.includes("남은 단계부터") && rs.includes("[N단계 완료]") && rs.endsWith("로그도 봐 줘"), rs);
check("브라우저로 열기: Windows explorer, macOS open, 화면 있는 Linux xdg-open, 화면 없으면·PI_TODO_OPEN=0 이면 열지 않음",
	m.openCmd("C:\\a.html", "win32", {})[0] === "explorer.exe" && m.openCmd("/a.html", "darwin", {})[0] === "open" && m.openCmd("/a.html", "linux", { DISPLAY: ":0" })[0] === "xdg-open"
	&& m.openCmd("/a.html", "linux", {}) === null && m.openCmd("C:\\a.html", "win32", { PI_TODO_OPEN: "0" }) === null);
// 가짜 pi 로: todo 도구 -> 작업판 파일 셋·입력창 위 목록, /todo, 계획 모드, [N단계 완료], 끝난 작업은 다음 요청 때 닫힘
const TW = mkdtempSync(join(tmpdir(), "modes-todo-"));
globalThis.__piWorkDir = { remote: false, cwd: TW };
const { existsSync: ex, readFileSync: rd, writeFileSync: wr, mkdirSync: md } = await import("node:fs");
const tdir = join(AGENT0, "todo");
// 2026-11-02.1 의 프로젝트별 목록 파일 -> 작업판으로 (한 번)
const key = m.todoKey(TW, false);
rmSync(tdir, { recursive: true, force: true }); // 앞 시험의 계획이 남긴 작업판은 지움
md(tdir, { recursive: true });
wr(join(tdir, `${key}.json`), JSON.stringify(m.mergeTodo(null, m.parseTodo("- [x] 옛 일 하나\n- [~] 옛 일 둘"), 5, { ...meta, cwd: TW, request: "옛 요청" })));
for (const f of on.session_start) await f({}, ctx);
const board = () => JSON.parse(rd(join(tdir, "board.json"), "utf8"));
const doing = () => board().tasks.filter((t) => t.state === "doing").sort((a, b) => b.updated - a.updated)[0];
check("pi 를 켜면 2026-11-02.1 의 끝나지 않은 프로젝트 목록을 작업판으로 옮겨 지금 작업으로 (한 번만)",
	board().tasks.length === 1 && board().tasks[0].request === "옛 요청" && board().imported.includes(key) && widgets.at(-1).v?.[0]?.includes("작업 #1"), [board(), widgets.at(-1)]);
for (const f of on.session_start) await f({}, ctx);
check("다시 켜도 다시 옮기지 않음", board().tasks.length === 1);
await tick(); // 켠 때와 요청을 보낸 때가 같은 ms 이면 같은 요청으로 봄
await on.input[0]({ text: "학습 파이프라인을 만들어 줘", source: "interactive" }, ctx);
let res = await tools.todo.execute("t1", { text: "- [~] 데이터 확인\n- [ ] 학습\n  - [ ] 피처\n  - [ ] 학습 돌리기" }, undefined, undefined, ctx);
w = widgets.at(-1);
check("새 요청의 겹치지 않는 목록은 새 작업 (#2), 하던 작업(#1)은 쉬는 중으로 작업판에 남고, 결과에 그렇다고 (파일 셋 board.json·.data.js·.html)",
	ex(join(tdir, "board.html")) && ex(join(tdir, "board.data.js")) && board().tasks.length === 2 && board().tasks[0].state === "paused" && doing().no === 2 && doing().request === "학습 파이프라인을 만들어 줘"
	&& w.k === "pi-kit-plan" && w.v[0].includes("── 할 일 0/3 (0%)") && w.v[0].includes("작업 #2") && !w.v[0].includes("옛 일") && res.content[0].text.includes("앞 작업 #1 은 쉬는 중"), [res, w, board()]);
res = await tools.todo.execute("t1b", { text: "- [~] 데이터 확인부터\n- [ ] 모델 학습\n  - [ ] 피처 만들기" }, undefined, undefined, ctx);
check("같은 요청 안에서 다시 쓴 목록 (겹치는 단계 없음): 새 작업이 아니라 지금 작업(#2)을 바꿔 씀",
	board().tasks.length === 2 && doing().no === 2 && doing().items[0].text === "데이터 확인부터" && !res.content[0].text.includes("쉬는 중"), [board().tasks.map((t) => [t.no, t.state]), res]);
await tools.todo.execute("t1c", { text: "- [~] 데이터 확인\n- [ ] 학습\n  - [ ] 피처\n  - [ ] 학습 돌리기" }, undefined, undefined, ctx);
res = await tools.todo.execute("t2", { text: "그냥 글" }, undefined, undefined, ctx);
check("todo 도구: 목록이 아니면 형식을 알려 줌 (목록은 그대로)", res.content[0].text.includes("- [ ] 할 일") && doing().items.length === 4);
globalThis.__piMode = "plan";
await cmds.mode.handler("plan", ctx);
check("계획 모드에서도 todo 는 막지 않음 (작업 폴더를 바꾸지 않음), /mode 는 지금 작업을 닫지 않음",
	!(await blocked("todo", { text: "- [ ] a" })) && widgets.at(-1).v?.[0]?.includes("── 할 일"), widgets.at(-1));
await cmds.mode.handler("auto", ctx);
await on.message_end[0]({ message: { role: "assistant", content: "[1단계 완료] 데이터를 확인했습니다" } }, ctx);
const after = JSON.parse(rd(join(tdir, "board.data.js"), "utf8").replace(/^window\.__piBoard && window\.__piBoard\(/, "").replace(/\);\s*$/, ""));
check("[N단계 완료] 는 todo 목록의 맨 위 단계에도 (board.data.js 에 바로)", after.tasks.find((t) => t.no === 2).items[0].status === "done", after.tasks.find((t) => t.no === 2)?.items[0]);
notes.length = 0;
await cmds.todo.handler("", ctx);
check("/todo: 진행 중 작업 목록 (지금 작업 ▶, 쉬는 중), 명령 안내",
	notes.at(-1).includes("진행 중 작업 2개") && notes.at(-1).includes("▶ #2 학습 파이프라인을 만들어 줘 — 할 일 1/3 · 지금 작업") && notes.at(-1).includes("#1 옛 요청 — 할 일 1/2 · 쉬는 중") && notes.at(-1).includes("/todo 이어서 N"), notes.at(-1));
await cmds.todo.handler("open", ctx);
check("/todo open: 열 수 없으면 (PI_TODO_OPEN=0) 작업판 파일 경로를 알려 줌", notes.at(-1).includes("브라우저로 여세요") && notes.at(-1).includes("board.html"), notes.at(-1));
// 모델이 남은 단계를 고치지 않고 답을 끝냄 (2026-11-02 실사용 시험): 브라우저가 '진행 중' 으로 시간을 계속 세지 않게 요청이 끝난 시각
for (const f of on.agent_end) await f({ messages: [{ role: "assistant", content: "끝났습니다", stopReason: "stop" }] }, ctx);
const st1 = doing().stopped;
check("요청이 끝났는데 지금 작업이 다 끝나지 않았으면 그 시각을 적음 (입력창 위에도 '요청 끝')", typeof st1 === "number" && widgets.at(-1).v[0].includes("요청 끝 (남은 단계 있음)"), [st1, widgets.at(-1)]);
await on.agent_start[0]({}, ctx);
check("다음 요청이 시작되면 지움", doing().stopped === null && !widgets.at(-1).v[0].includes("요청 끝"), widgets.at(-1));
// 목록을 고치지 않고 작업이 이어지면 결과에 안내 (2026-11-02 실사용 시험: 처음에 만들고 끝에만 [x])
const tr2 = async (toolName) => (await on.tool_result[0]({ toolName, input: {}, content: [{ type: "text", text: "결과" }], isError: false }, ctx))?.content?.at(-1)?.text;
const seen = [];
for (let i = 1; i <= m.TODO_NUDGE_AGAIN + 1; i++) seen.push(await tr2(i % 2 ? "bash" : "read"));
await tools.todo.execute("t2b", { text: "- [x] 데이터 확인\n- [~] 학습\n  - [~] 피처\n  - [ ] 학습 돌리기" }, undefined, undefined, ctx);
const afterTodo = [await tr2("bash"), await tr2("todo")];
check(`목록을 고친 뒤 도구 ${m.TODO_NUDGE_AT}번째·${m.TODO_NUDGE_AGAIN}번째 결과에 안내 (지금 하는 중 단계와 함께), 목록을 고치면 다시 셈, todo 결과에는 붙이지 않음`,
	seen.filter(Boolean).length === 2 && seen[m.TODO_NUDGE_AT - 1]?.includes("todo 로 목록 전체를 고쳐") && seen[m.TODO_NUDGE_AGAIN - 1]?.includes("todo 로 목록 전체를 고쳐")
	&& afterTodo.every((x) => x === undefined), [seen, afterTodo]);
// 쉬던 작업으로 돌아가기 (/todo 이어서 N): 지금 작업은 쉬는 중으로, 모델에게 그 작업의 단계를 보냄
const nSent0 = sent.length;
await cmds.todo.handler("이어서 1 로그도 봐 줘", ctx);
await sentAfter(nSent0);
check("/todo 이어서 1: #1 이 지금 작업 (입력창 위), #2 는 쉬는 중, 모델에게 #1 의 단계와 덧붙인 말을 보냄 (지금 작업이 끝난 뒤)",
	doing().no === 1 && board().tasks.find((t) => t.no === 2).state === "paused" && widgets.at(-1).v[0].includes("작업 #1") && sent.at(-1).text.includes("쉬던 작업 #1")
	&& sent.at(-1).text.includes("옛 일 하나 (끝남)") && sent.at(-1).text.endsWith("로그도 봐 줘") && sent.at(-1).opts?.deliverAs === "followUp", [board().tasks.map((t) => [t.no, t.state]), sent.at(-1)]);
await cmds.todo.handler("이어서 9", ctx);
check("/todo 이어서 (없는 번호): 알림만", notes.at(-1).includes("작업 #9") && doing().no === 1, notes.at(-1));
const other = m.editBoard((b) => void m.addTask(b, m.mergeTodo(null, m.parseTodo("- [ ] 남의 폴더 일"), 50, { ...meta, cwd: "C:/elsewhere", project: "elsewhere" }), 50));
const otherNo = other.tasks.at(-1).no;
await cmds.todo.handler(`이어서 ${otherNo}`, ctx);
check("/todo 이어서 (다른 폴더의 작업): 바꾸지 않고 그 폴더에서 하라고 알림", notes.at(-1).includes("다른 폴더의 작업") && notes.at(-1).includes("C:/elsewhere") && doing().no === 1, notes.at(-1));
await cmds.todo.handler(`폐기 ${otherNo}`, ctx);
await cmds.todo.handler("완료 2", ctx);
const bb = board();
check("/todo 폐기 N·완료 N: 작업판의 완료 탭으로 (폐기·완료 처리, 끝난 시각), 다른 폴더의 작업도",
	bb.tasks.find((t) => t.no === otherNo).state === "dropped" && bb.tasks.find((t) => t.no === 2).state === "done" && bb.tasks.find((t) => t.no === 2).manual === true
	&& typeof bb.tasks.find((t) => t.no === 2).closed === "number" && notes.at(-1).includes("완료로 옮겼습니다") && doing().no === 1, bb.tasks.map((t) => [t.no, t.state]));
await cmds.todo.handler("이어서 2", ctx);
await cmds.todo.handler("이어서 1", ctx);
check("완료·폐기한 작업도 /todo 이어서 N 으로 다시 열 수 있음 (다시 하는 중)", board().tasks.find((t) => t.no === 2).state === "paused" && doing().no === 1, board().tasks.map((t) => [t.no, t.state]));
await tools.todo.execute("t3", { text: "- [x] 옛 일 하나\n- [x] 옛 일 둘" }, undefined, undefined, ctx);
check("모두 끝나면 입력창 위에 '모두 끝남', 작업판에서는 바로 완료, 끝난 작업에는 안내하지 않음",
	widgets.at(-1).v[0].includes("모두 끝남") && board().tasks.find((t) => t.no === 1).state === "done" && [await tr2("bash"), await tr2("bash"), await tr2("bash")].every((x) => x === undefined), widgets.at(-1));
await on.input[0]({ text: "다음 일", source: "interactive" }, ctx);
check("끝난 작업은 다음 요청 때 입력창 위에서 닫히고 작업판에는 완료로 남음", widgets.at(-1).v === undefined && board().tasks.find((t) => t.no === 1).state === "done");
await cmds.todo.handler("이어서 2", ctx);
await cmds.todo.handler("clear", ctx);
check("/todo clear: 지금 작업을 폐기 (작업판 완료 탭에 '폐기')", board().tasks.find((t) => t.no === 2).state === "dropped" && widgets.at(-1).v === undefined, board().tasks.map((t) => [t.no, t.state]));
// 2026-11-04 실제 Copilot: 급한 일의 목록에 앞 작업의 끝난 단계 하나를 섞어 보냄 -> 겹친다고 같은 작업으로 보면 앞 작업의 목록이 급한 일로 바뀜
await tick();
await on.input[0]({ text: "보고서 만들기", source: "interactive" }, ctx);
await tools.todo.execute("m1", { text: "- [x] 자료 모으기\n- [~] 표 만들기\n- [ ] 글 쓰기" }, undefined, undefined, ctx);
const repNo = doing().no;
await tick();
await on.input[0]({ text: "급한 일: 서버 로그 보기", source: "interactive" }, ctx);
res = await tools.todo.execute("m2", { text: "- [x] 자료 모으기\n- [~] 서버 로그 열기\n- [ ] 오류 찾기\n- [ ] 보고서 작업 다시 하기" }, undefined, undefined, ctx);
const rep = board().tasks.find((t) => t.no === repNo);
check("새 요청의 목록이 앞 작업의 끝난 단계 하나만 겹치고 남은 단계는 없음: 새 작업, 앞 작업의 목록은 그대로 (쉬는 중), 결과에 '이 작업의 단계만'",
	doing().no === repNo + 1 && doing().items[1].text === "서버 로그 열기" && doing().request === "급한 일: 서버 로그 보기" && rep.state === "paused" && rep.items.map((x) => x.text).join("|") === "자료 모으기|표 만들기|글 쓰기"
	&& res.content[0].text.includes(`새 작업 #${repNo + 1}`) && res.content[0].text.includes("이 작업의 단계만"), [res, board().tasks.map((t) => [t.no, t.state, t.items.map((x) => x.text).join("|")])]);
await cmds.todo.handler(`이어서 ${repNo}`, ctx);
await tick();
await on.input[0]({ text: "계속", source: "interactive" }, ctx);
res = await tools.todo.execute("m3", { text: "- [x] 표 만들기\n- [~] 글 쓰기" }, undefined, undefined, ctx);
check("새 요청 뒤 남은 단계만 다시 보낸 목록: 같은 작업 (새 작업이 아님)", doing().no === repNo && !res.content[0].text.includes("새 작업"), [res, board().tasks.map((t) => [t.no, t.state])]);
check("남은 단계를 이어 가는지: 남은 맨 위 단계를 반 넘게 담으면 같은 작업 (계획은 앞서 받은 모델의 글로도)",
	m.keepsTask({ items: m.parseTodo("- [x] a\n- [~] b\n- [ ] c"), alias: [] }, [{ text: "b" }]) && !m.keepsTask({ items: m.parseTodo("- [x] a\n- [~] b\n- [ ] c\n- [ ] d") }, [{ text: "a" }, { text: "b" }, { text: "x" }])
	&& m.keepsTask({ items: m.parseTodo("- [x] a\n- [ ] b"), lastTop: ["a2", "b2"] }, [{ text: "B2" }]) && m.keepsTask({ items: m.parseTodo("- [x] a") }, []));
await cmds.todo.handler(`폐기 ${repNo + 1}`, ctx);
await cmds.todo.handler("clear", ctx);
wr(join(tdir, "board.json"), "{깨진");
m.editBoard(() => {});
const { readdirSync: rdir } = await import("node:fs");
check("깨진 작업판 파일은 덮어쓰지 않고 옆에 둠 (board.json.bad-…)", rdir(tdir).some((f) => f.startsWith("board.json.bad-")) && board().v === 2, rdir(tdir));
// 가짜 pi 로: 8단계 계획 진행 -> 1~2단계 끝 -> /plan 으로 다시 계획 모드 -> 다듬기 -> 승인 (2026-11-04 사용자 보고)
const items = () => doing().items;
const titles = [];
const select0 = ctx.ui.select;
ctx.ui.select = async (t, opts) => (titles.push(t), opts[0]);
const answerPlan = async (text) => {
	await on.agent_start[0]({}, ctx);
	await on.message_end[0]({ message: { role: "assistant", content: text } }, ctx);
	const n0 = sent.length;
	for (const f of on.agent_settled) await f({}, ctx);
	await sentAfter(n0);
};
globalThis.__piMode = "auto";
await cmds.mode.handler("auto", ctx);
await cmds.plan.handler("", ctx);
await answerPlan(PLAN8_OK());
check("진행 요청: 할 일 목록은 pi 가 계획의 단계로 이미 만들었다고 (todo 로 고칠 때는 같은 단계 수·차례)",
	sent.at(-1).text.includes("할 일 목록은 pi 가 이 계획의 단계로 이미 만들었습니다") && sent.at(-1).text.includes("같은 8개 단계를 같은 차례로"), sent.at(-1).text);
// 계획 진행 중에 모델이 제 글로 쓴 목록을 todo 로 보냄 (2026-11-04 실제 Copilot: 계획 목록이 새 목록으로 바뀜)
const nudges = [];
for (let i = 1; i <= m.TODO_NUDGE_AT; i++) nudges.push(await tr2("bash"));
check(`계획 진행 중에도 목록을 고치지 않고 도구 ${m.TODO_NUDGE_AT}번째 결과에 안내 (계획의 8개 단계를 같은 차례로, 또는 [N단계 완료])`,
	nudges.filter(Boolean).length === 1 && nudges.at(-1)?.includes("todo 로 계획의 8개 단계를 같은 차례로") && nudges.at(-1).includes("[N단계 완료]"), nudges);
await on.message_end[0]({ message: { role: "assistant", content: "[1단계 완료]" } }, ctx);
const own8 = Array.from({ length: 8 }, (_, i) => `- [${i === 0 ? "x" : i === 1 ? "~" : " "}] ${i + 1}단계 내 글로 쓴 단계${i === 1 ? "\n  - [x] 하위 일\n  - [ ] 하위 둘" : ""}`).join("\n");
res = await tools.todo.execute("t8a", { text: own8 }, undefined, undefined, ctx);
const fitted = items();
check("계획 진행 중 todo (같은 8단계, 글은 다름): 단계 글은 계획대로, 진행과 하위 단계만 받음 (입력창 위는 '계획 진행')",
	fitted.length === 10 && fitted[0].text === "단계1" && fitted[0].status === "done" && fitted[1].text === "단계2" && fitted[2].level === 1 && fitted[2].text === "하위 일"
	&& widgets.at(-1).v?.[0]?.includes("── 계획 진행 2/9") && res.content[0].text.includes("할 일 목록을 고쳤습니다"), [fitted, widgets.at(-1), res]);
res = await tools.todo.execute("t8b", { text: "- [x] 준비\n- [~] 고치기\n- [ ] 확인" }, undefined, undefined, ctx);
check("계획 진행 중 todo (단계 수가 다름): 목록은 그대로, 고치는 법을 알림", res.content[0].text === m.todoPlanKeep(8) && items().length === 10 && items()[0].text === "단계1", [res, items().length]);
check("계획에 맞춰 보기: 맨 위 단계 수가 같을 때만", m.fitPlan(m.planTodo(["가", "나"], 1, meta), m.parseTodo("- [x] a\n  - [ ] a1\n- [ ] b"))?.map((l) => l.text).join("|") === "가|a1|나"
	&& m.fitPlan(m.planTodo(["가", "나"], 1, meta), m.parseTodo("- a")) === null);
const p8no = doing().no;
await tick();
await on.input[0]({ text: "계속 진행해 줘", source: "interactive" }, ctx);
res = await tools.todo.execute("t8d", { text: own8 }, undefined, undefined, ctx);
check("새 요청 뒤에도 모델이 앞서 쓴 글(alias)과 같은 목록이면 같은 계획 (새 작업이 아님, 글은 계획대로)",
	doing().no === p8no && board().tasks.filter((t) => t.state === "doing" || t.state === "paused").length === 1 && items()[0].text === "단계1" && !res.content[0].text.includes("쉬는 중")
	&& doing().alias.includes("1단계 내 글로 쓴 단계"), [res, board().tasks.map((t) => [t.no, t.state]), doing().alias]);
await tools.todo.execute("t8c", { text: S8.map((s, i) => `- [${i === 0 ? "x" : i === 1 ? "~" : " "}] ${s}`).join("\n") }, undefined, undefined, ctx);
await on.message_end[0]({ message: { role: "assistant", content: "[2단계 완료]" } }, ctx);
const before8 = items();
await cmds.plan.handler("", ctx);
check("/plan 으로 다시 계획 모드: 진행하던 계획 목록을 닫지 않음 (입력창 위·파일 그대로)",
	globalThis.__piMode === "plan" && widgets.at(-1).v?.[0]?.includes("── 계획 진행 3/9") && items().length === 10, widgets.at(-1));
const tr8 = await on.input[0]({ text: "계획 보완해 줘. 3단계에 시험 추가", source: "interactive" }, ctx);
check("계획 모드의 요청에 지금 목록과 '전체를 다시 적기' 안내가 붙음",
	tr8?.text.includes("[지금 진행 중인 계획: 8단계 중 2단계 끝남]") && tr8.text.includes("1. 단계1 (끝남)") && tr8.text.endsWith("계획 보완해 줘. 3단계에 시험 추가"), tr8?.text);
res = await tools.todo.execute("t8", { text: "- [x] 단계1\n- [x] 단계2\n- [~] 계획 보완" }, undefined, undefined, ctx);
check("계획 모드에서 todo 는 목록을 바꾸지 않고 그렇다고 알림 (승인한 계획이 목록이 됨)", res.content[0].text === m.TODO_PLAN_MODE && items().length === 10, [res, items().length]);
await answerPlan(CHANGED);
const after8 = items();
check("다듬은 계획을 승인: 전체 계획(8단계)을 골라, 끝난 1~2단계는 끝남·시각 그대로, 3단계부터 진행, 묻는 창과 진행 요청에 알림",
	after8.length === 8 && after8[0].status === "done" && after8[0].ended === before8[0].ended && after8[1].ended === before8[1].ended && after8[2].status === "doing" && after8[2].text === "단계3 + 시험" && after8[7].text === "정리"
	&& titles.at(-1) === "이 계획대로 진행할까요? (8단계, 그중 2단계는 끝남 · 지금 목록 8단계를 이 계획으로 바꿈)" && sent.at(-1).text.includes("이미 끝난 단계(1, 2단계)는 다시 하지 말고") && sent.at(-1).text.includes("모두 8단계"),
	[after8, titles.at(-1), sent.at(-1).text]);
await cmds.mode.handler("ask", ctx);
check("/mode 도 진행 중인 계획 목록을 닫지 않음", widgets.at(-1).v?.[0]?.includes("── 계획 진행 2/8"), widgets.at(-1));
await cmds.mode.handler("auto", ctx);
const planNo = doing().no;
await tick();
await on.input[0]({ text: "급한 일부터: 로그 폴더 비우기", source: "interactive" }, ctx);
res = await tools.todo.execute("t9", { text: "- [~] 로그 폴더 보기\n- [ ] 지우기" }, undefined, undefined, ctx);
check("계획 진행 중에 새 요청의 다른 목록 (단계 수가 달라도): 새 작업, 하던 계획은 쉬는 중 (같은 단계 수 규칙은 그 계획을 진행하는 요청 안에서만)",
	doing().no === planNo + 1 && doing().source === "todo" && board().tasks.find((t) => t.no === planNo).state === "paused" && res.content[0].text.includes(`앞 작업 #${planNo} 은 쉬는 중`), [res, board().tasks.map((t) => [t.no, t.state])]);
await cmds.todo.handler(`폐기 ${planNo + 1}`, ctx);
await cmds.todo.handler(`이어서 ${planNo}`, ctx);
await sentAfter(sent.length - 1);
await cmds.plan.handler("", ctx);
await on.input[0]({ text: "급한 일: 배포 스크립트 고치기", source: "interactive" }, ctx);
await answerPlan("1. 배포 스크립트 읽기\n2. 고치기\n3. 시험");
check("진행 중인 계획과 겹치지 않는 새 계획을 승인: 새 작업 (묻는 창에 알림), 하던 계획은 쉬는 중으로 작업판에, 새 작업 이름은 계획 모드의 첫 요청",
	titles.at(-1) === `이 계획대로 진행할까요? (3단계 · 새 작업 (지금 작업 #${planNo} 은 쉬는 중으로))` && doing().no === board().next - 1 && doing().request === "급한 일: 배포 스크립트 고치기"
	&& board().tasks.find((t) => t.no === planNo).state === "paused" && widgets.at(-1).v[0].includes(`작업 #${board().next - 1}`), [titles.at(-1), board().tasks.map((t) => [t.no, t.state, t.request])]);
await cmds.todo.handler(`폐기 ${planNo}`, ctx);
// 하위 작업까지 세운 계획을 승인 (2026-11-05 사용자): 묻는 창에 하위 작업 수, 입력창 위·작업판에 하위 단계
const urgentNo = doing().no;
await cmds.plan.handler("", ctx);
await on.input[0]({ text: "세부 작업까지 계획 세워 줘", source: "interactive" }, ctx);
// 급한 일 계획(배포 스크립트 읽기·고치기·시험)과 '고치기'·'시험' 이 겹쳐 pi 는 고침으로 봄 -> 사용자는 '새 작업으로' 를 고름
const optsSeen = [];
ctx.ui.select = async (t, opts) => (titles.push(t), optsSeen.push(opts), opts.find((o) => o.includes("새 작업으로")) || opts[0]);
await answerPlan(P1);
w = widgets.at(-1);
check("하위 작업이 든 계획을 승인: 묻는 창에 '하위 작업 5개', 진행하던 작업이 있으면 pi 가 본 것과 반대로 하는 고르기('새 작업으로'), 고르면 새 작업 (하던 작업은 쉬는 중)",
	titles.at(-1) === `이 계획대로 진행할까요? (3단계, 그중 1단계는 끝남 · 하위 작업 5개 · 지금 목록 3단계를 이 계획으로 바꿈)` && optsSeen.at(-1).length === 4
	&& doing().no === board().next - 1 && board().tasks.find((t) => t.no === urgentNo).state === "paused" && board().tasks.find((t) => t.no === urgentNo).items[0].text === "배포 스크립트 읽기", [titles.at(-1), optsSeen.at(-1), board().tasks.map((t) => [t.no, t.state])]);
check("하위 작업이 든 계획: 목록에 하위 단계 (입력창 위에도 1.1 처럼), 진행 요청의 단계 수와 끝난 단계는 맨 위 단계로",
	doing().items.length === 8 && doing().items[1].level === 1 && w.v[0].includes("[~] 1.1 파일 읽기") && w.v[0].includes(" [~] 1. 준비") && sent.at(-1).text.includes("모두 3단계") && sent.at(-1).text.includes("이미 끝난 단계(3단계)"),
	[PKT(doing()), w.v[0], sent.at(-1).text]);
ctx.ui.select = async (t, opts) => (titles.push(t), opts[0]);
await cmds.todo.handler(`폐기 ${urgentNo}`, ctx);
await cmds.todo.handler("clear", ctx);
ctx.ui.select = select0;
await cmds.todo.handler("clear", ctx);
rmSync(TW, { recursive: true, force: true });
rmSync(AGENT0, { recursive: true, force: true });

console.log(fails ? `\n실패 ${fails}개` : "\n모두 통과");
process.exit(fails ? 1 : 0);
