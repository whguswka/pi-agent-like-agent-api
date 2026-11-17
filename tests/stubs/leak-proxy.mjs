#!/usr/bin/env node
/**
 * 시험용 '회사 서버 흉내' 중계 (tests/stubs/leak-proxy.mjs)
 * OpenAI 호환 /v1/chat/completions 를 받아 위쪽 서버로 보내고 응답을 바꾼다.
 * 방식:
 *   - tools: tool_calls 를 지우고 content 에 <tool_call>{json}</tool_call>
 *   - xml: Qwen3-Coder <function=…> 꼴
 *   - think: reasoning_content 를 content 앞의 <think>…</think> 로
 *   - mix: think + tools/xml 섞어 쓰기
 * pi 는 stream 으로 부르니 위쪽에는 stream: false 로 보내고 pi 에게는 OpenAI SSE 꼴로 돌려준다.
 * /v1/models 는 그대로 넘긴다.
 * 키·응답 본문은 로그에 남기지 않는다.
 */

import { createServer } from "node:http";
import { URL } from "node:url";

export function transformResponse(json, mode = "tools") {
	if (!json || typeof json !== "object") return json;
	const choice = json.choices?.[0];
	if (!choice || !choice.message) return json;

	const msg = { ...choice.message };
	let content = String(msg.content || "");
	const toolCalls = Array.isArray(msg.tool_calls) ? [...msg.tool_calls] : [];
	const reasoning = String(msg.reasoning_content || msg.reasoning || "");

	// think 변환
	if ((mode === "think" || mode === "mix") && reasoning) {
		content = `<think>${reasoning}</think>\n${content}`.trim();
		delete msg.reasoning_content;
		delete msg.reasoning;
	}

	// tools 변환
	if ((mode === "tools" || mode === "mix") && toolCalls.length > 0) {
		for (const tc of toolCalls) {
			const fnName = tc.function?.name || tc.name || "";
			let fnArgs = tc.function?.arguments ?? tc.arguments ?? {};
			if (typeof fnArgs === "string") {
				try { fnArgs = JSON.parse(fnArgs); } catch {}
			}
			content = (content ? content + "\n" : "") + `<tool_call>${JSON.stringify({ name: fnName, arguments: fnArgs })}</tool_call>`;
		}
		msg.tool_calls = [];
	} else if (mode === "xml" && toolCalls.length > 0) {
		for (const tc of toolCalls) {
			const fnName = tc.function?.name || tc.name || "";
			let fnArgs = tc.function?.arguments ?? tc.arguments ?? {};
			if (typeof fnArgs === "string") {
				try { fnArgs = JSON.parse(fnArgs); } catch {}
			}
			let xml = `<function=${fnName}>`;
			if (typeof fnArgs === "object" && fnArgs !== null) {
				for (const [k, v] of Object.entries(fnArgs)) {
					const valStr = typeof v === "object" ? JSON.stringify(v) : String(v);
					xml += `<parameter=${k}>${valStr}</parameter>`;
				}
			}
			xml += `</function>`;
			content = (content ? content + "\n" : "") + xml;
		}
		msg.tool_calls = [];
	}

	msg.content = content;
	return {
		...json,
		choices: [
			{
				...choice,
				message: msg,
			},
		],
	};
}

export function startLeakProxy(opts = {}) {
	const upstream = (opts.upstream || process.env.UPSTREAM_URL || "http://127.0.0.1:8000").replace(/\/+$/, "");
	const defaultMode = opts.mode || process.env.LEAK_MODE || "tools";

	const server = createServer(async (req, res) => {
		const reqUrl = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
		const pathname = reqUrl.pathname;

		// /v1/models (또는 /models) 그대로 전달
		if (pathname.endsWith("/models")) {
			const targetUrl = `${upstream}${pathname}${reqUrl.search}`;
			const headers = {};
			if (req.headers["authorization"]) headers["Authorization"] = req.headers["authorization"];
			try {
				const upRes = await fetch(targetUrl, { method: "GET", headers });
				const data = await upRes.text();
				res.writeHead(upRes.status, { "Content-Type": upRes.headers.get("content-type") || "application/json" });
				res.end(data);
			} catch (e) {
				res.writeHead(502, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ error: { message: `Upstream error: ${e.message}` } }));
			}
			return;
		}

		// /v1/chat/completions (또는 /chat/completions)
		if (pathname.endsWith("/chat/completions")) {
			const mode = req.headers["x-leak-mode"] || reqUrl.searchParams.get("leak_mode") || defaultMode;
			let bodyText = "";
			req.on("data", (chunk) => { bodyText += chunk; });
			req.on("end", async () => {
				let clientBody = {};
				try {
					clientBody = JSON.parse(bodyText);
				} catch {}

				const clientWantsStream = clientBody.stream !== false;
				// 위쪽 서버에는 stream: false 로 보냄
				const upstreamBody = { ...clientBody, stream: false };

				const targetUrl = `${upstream}${pathname}`;
				const headers = { "Content-Type": "application/json" };
				if (req.headers["authorization"]) headers["Authorization"] = req.headers["authorization"];

				try {
					const upRes = await fetch(targetUrl, {
						method: "POST",
						headers,
						body: JSON.stringify(upstreamBody),
					});

					const upText = await upRes.text();
					let upJson;
					try {
						upJson = JSON.parse(upText);
					} catch {
						res.writeHead(upRes.status, { "Content-Type": upRes.headers.get("content-type") || "application/json" });
						res.end(upText);
						return;
					}

					if (!upRes.ok) {
						res.writeHead(upRes.status, { "Content-Type": "application/json" });
						res.end(JSON.stringify(upJson));
						return;
					}

					// 응답 변환
					const transformed = transformResponse(upJson, mode);
					const transChoice = transformed.choices?.[0];
					const finalContent = transChoice?.message?.content || "";
					const modelName = transformed.model || clientBody.model || "leak-model";
					const respId = transformed.id || `chatcmpl-${Date.now()}`;

					if (clientWantsStream) {
						res.writeHead(200, {
							"Content-Type": "text/event-stream; charset=utf-8",
							"Cache-Control": "no-cache",
							Connection: "keep-alive",
						});

						// Chunk 1: 내용 전달
						const chunk1 = {
							id: respId,
							object: "chat.completion.chunk",
							created: Math.floor(Date.now() / 1000),
							model: modelName,
							choices: [
								{
									index: 0,
									delta: { role: "assistant", content: finalContent },
									finish_reason: null,
								},
							],
						};
						res.write(`data: ${JSON.stringify(chunk1)}\n\n`);

						// Chunk 2: 종료 전달
						const chunk2 = {
							id: respId,
							object: "chat.completion.chunk",
							created: Math.floor(Date.now() / 1000),
							model: modelName,
							choices: [
								{
									index: 0,
									delta: {},
									finish_reason: "stop",
								},
							],
						};
						res.write(`data: ${JSON.stringify(chunk2)}\n\n`);

						// Chunk 3: DONE
						res.write("data: [DONE]\n\n");
						res.end();
					} else {
						res.writeHead(200, { "Content-Type": "application/json" });
						res.end(JSON.stringify(transformed));
					}
				} catch (e) {
					res.writeHead(502, { "Content-Type": "application/json" });
					res.end(JSON.stringify({ error: { message: `Upstream error: ${e.message}` } }));
				}
			});
			return;
		}

		res.writeHead(404, { "Content-Type": "application/json" });
		res.end(JSON.stringify({ error: { message: "Not found" } }));
	});

	const port = opts.port ?? (process.env.PORT ? parseInt(process.env.PORT, 10) : 0);

	return new Promise((resolve, reject) => {
		server.listen(port, "127.0.0.1", () => {
			const addr = server.address();
			const actualPort = typeof addr === "object" ? addr.port : port;
			resolve({
				server,
				port: actualPort,
				url: `http://127.0.0.1:${actualPort}`,
				close: () => new Promise((cb) => server.close(cb)),
			});
		});
		server.on("error", reject);
	});
}

// 직접 실행될 때 CLI
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
	const args = process.argv.slice(2);
	let upstream = process.env.UPSTREAM_URL || "http://127.0.0.1:8000";
	let port = process.env.PORT ? parseInt(process.env.PORT, 10) : 8899;
	let mode = process.env.LEAK_MODE || "tools";

	for (let i = 0; i < args.length; i++) {
		if (args[i] === "--upstream" && args[i + 1]) upstream = args[++i];
		else if (args[i] === "--port" && args[i + 1]) port = parseInt(args[++i], 10);
		else if (args[i] === "--mode" && args[i + 1]) mode = args[++i];
	}

	startLeakProxy({ upstream, port, mode }).then((proxy) => {
		console.log(`[leak-proxy] mode=${mode} listening on ${proxy.url} -> upstream ${upstream}`);
	});
}
