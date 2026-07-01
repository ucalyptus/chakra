import { compile, Runner } from '@chakra-dsl/core';
import { OpenRouterProvider } from '@chakra-dsl/providers';

interface Env {
  OPENROUTER_API_KEY: string;
  AUTH_USERNAME: string;
  AUTH_PASSWORD: string;
}

function checkBasicAuth(request: Request, env: Env): boolean {
  const header = request.headers.get('Authorization') ?? '';
  if (!header.startsWith('Basic ')) return false;
  try {
    const decoded = atob(header.slice(6));
    const colon = decoded.indexOf(':');
    if (colon === -1) return false;
    const user = decoded.slice(0, colon);
    const pass = decoded.slice(colon + 1);
    return user === env.AUTH_USERNAME && pass === env.AUTH_PASSWORD;
  } catch {
    return false;
  }
}

const UNAUTH = (request: Request) => new Response('Unauthorized', {
  status: 401,
  headers: { ...corsHeaders(request), 'WWW-Authenticate': 'Basic realm="Chakra Agent"' },
});

// Self-directed reasoner — loops until confident, then synthesizes a clean answer
const PROGRAM_YAML = `
program:
  name: "self-directed-reasoner"
  version: "2.0"
  defaults:
    model: "minimax/minimax-m3"
    temperature: 0.65
    max_iterations: 8

  stores:
    - id: transcript
      name: "Conversation Transcript"
      write_mode: append
      builtin: true

    - id: working_notes
      name: "Working Notes"
      write_mode: append

  nodes:
    - type: loop_start
      id: rs1

    - type: tool
      id: wait_input
      name: "Wait for User Input"
      tool_type: wait_for_user
      config: {}

    - type: actor
      id: orchestrator
      name: "Orchestrator"
      actor_type: llm
      subscribe: [transcript, working_notes]
      publish: working_notes
      prompt_template: |
        You are a deliberate reasoning agent. Your job is to think carefully before answering.

        The user's question (from transcript):
        {{channel:transcript}}

        Your reasoning so far (accumulates across rounds):
        {{channel:working_notes}}

        Think step by step. Build on previous reasoning if it exists. When you have reasoned enough
        to give a confident, complete answer — end your response with <decision>emit</decision>.
        When you need another reasoning pass — end with <decision>reason</decision>.

    - type: router
      id: branch
      name: "Continue or Emit?"
      mode: llm_driven
      branches:
        - label: reason
          target: re_think
        - label: emit
          target: synthesizer
        - label: fallback
          target: synthesizer

    - type: loop_end
      id: re_think
      max_iterations: 2

    - type: actor
      id: synthesizer
      name: "Synthesizer"
      actor_type: llm
      subscribe: [transcript, working_notes]
      prompt_template: |
        Based on this reasoning:
        {{channel:working_notes}}

        Write a clear, direct answer to the user's question:
        {{channel:transcript}}

        Be concise. No meta-commentary about your reasoning process.

    - type: tool
      id: emit_response
      name: "Emit Response"
      tool_type: emit_to_user
      config: {}

    - type: loop_end
      id: re_done
      max_iterations: 1

  edges:
    - from: rs1
      to: wait_input
      type: control
    - from: wait_input
      to: orchestrator
      type: control
    - from: orchestrator
      to: branch
      type: data
    - from: branch
      to: re_think
      type: control
    - from: branch
      to: synthesizer
      type: control
    - from: synthesizer
      to: emit_response
      type: data
    - from: emit_response
      to: re_done
      type: control
`;

function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get('Origin');
  return {
    'Access-Control-Allow-Origin': origin ?? '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Credentials': 'true',
  };
}

const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
};

const CHAT_UI = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Chakra Agent</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0d0f12;color:#e2e8f0;height:100vh;display:flex;flex-direction:column}
  header{padding:16px 20px;border-bottom:1px solid #2a2f3d;display:flex;align-items:center;gap:12px}
  header h1{font-size:18px;font-weight:700}
  header span{font-size:12px;color:#8892a4;background:#1e2330;padding:3px 10px;border-radius:20px;border:1px solid #2a2f3d}
  #msgs{flex:1;overflow-y:auto;padding:20px;display:flex;flex-direction:column;gap:12px}
  .msg{max-width:75%;padding:10px 14px;border-radius:12px;font-size:14px;line-height:1.6}
  .user{align-self:flex-end;background:#7c6af7;color:#fff;border-radius:12px 12px 3px 12px}
  .assistant{align-self:flex-start;background:#1e2330;border:1px solid #2a2f3d;border-radius:12px 12px 12px 3px}
  .thinking{align-self:flex-start;color:#8892a4;font-size:13px;font-style:italic}
  form{padding:14px 16px;border-top:1px solid #2a2f3d;display:flex;gap:10px}
  input{flex:1;padding:10px 14px;border-radius:8px;background:#1e2330;border:1px solid #2a2f3d;color:#e2e8f0;font-size:14px}
  button{padding:10px 18px;background:#7c6af7;color:#fff;border-radius:8px;font-weight:700;font-size:14px;cursor:pointer}
  button:disabled{opacity:0.5;cursor:not-allowed}
</style>
</head>
<body>
<header>
  <span>⬡</span>
  <h1>Chakra Agent</h1>
  <span>minimax-m3 · my-agent program</span>
</header>
<div id="msgs">
  <div class="msg assistant">Hey! I'm a reasoning agent running on the Chakra DSL. Ask me anything.</div>
</div>
<form id="form">
  <input id="inp" placeholder="Type a message..." autocomplete="off" autofocus>
  <button id="btn" type="submit">Send</button>
</form>
<script>
const msgs = document.getElementById('msgs');
const form = document.getElementById('form');
const inp = document.getElementById('inp');
const btn = document.getElementById('btn');

const history = [];

function addMsg(role, text) {
  const d = document.createElement('div');
  d.className = 'msg ' + role;
  d.textContent = text;
  msgs.appendChild(d);
  msgs.scrollTop = msgs.scrollHeight;
  return d;
}

form.onsubmit = async (e) => {
  e.preventDefault();
  const text = inp.value.trim();
  if (!text) return;
  inp.value = '';
  btn.disabled = true;

  addMsg('user', text);
  history.push({ role: 'user', content: text });

  const thinking = document.createElement('div');
  thinking.className = 'thinking';
  thinking.textContent = 'thinking...';
  msgs.appendChild(thinking);
  msgs.scrollTop = msgs.scrollHeight;

  try {
    const res = await fetch('/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, history }),
    });
    const data = await res.json();
    msgs.removeChild(thinking);
    addMsg('assistant', data.response || data.error || '(no response)');
    if (data.response) history.push({ role: 'assistant', content: data.response });
  } catch (err) {
    msgs.removeChild(thinking);
    addMsg('assistant', 'Error: ' + err.message);
  }
  btn.disabled = false;
  inp.focus();
};
</script>
</body>
</html>`;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders(request) });
    }

    if (!checkBasicAuth(request, env)) return UNAUTH(request);

    // Serve chat UI
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '')) {
      return new Response(CHAT_UI, {
        headers: { 'Content-Type': 'text/html; charset=utf-8', ...SECURITY_HEADERS },
      });
    }

    // Chat endpoint
    if (request.method === 'POST' && url.pathname === '/chat') {
      if (!env.OPENROUTER_API_KEY) {
        return new Response(JSON.stringify({ error: 'OPENROUTER_API_KEY not configured' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
        });
      }

      let message: string;
      let history: { role: string; content: string }[] = [];
      let customGraph: string | undefined;
      try {
        const body: { message: string; history?: { role: string; content: string }[]; program?: string } = await request.json();
        message = body.message;
        history = body.history ?? [];
        customGraph = body.program;
      } catch {
        return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
        });
      }

      try {
        const { program: compiled } = compile(customGraph ?? PROGRAM_YAML, 'yaml');

        const provider = new OpenRouterProvider({
          apiKey: env.OPENROUTER_API_KEY,
          defaultModel: 'minimax/minimax-m3',
        });

        // Seed transcript from history so the agent has context
        const transcript = history
          .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
          .join('\n');

        let response = '';
        let inputDone = false;

        const controller = new Runner(compiled, {
          provider,
          io: {
            waitForInput: async () => {
              if (!inputDone) {
                inputDone = true;
                return message;
              }
              return '';
            },
            emit: async (msg: string) => {
              response = msg;
            },
          },
          // Seed transcript channel with conversation history
          ...(transcript ? { initialMemory: { transcript } } : {}),
        });

        const result = await controller.run();

        // Fallback: if agent hit max_iterations without emitting, use working_notes
        if (!response) {
          response = result.finalMemory.get('working_notes') ?? '(no response)';
        }

        return new Response(JSON.stringify({ response, rounds: result.rounds }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: String(err) }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
        });
      }
    }

    return new Response('Not Found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
