import { useState, useCallback, useMemo, useRef } from 'react';
import {
  ReactFlow, Background, Controls, MiniMap,
  addEdge, useNodesState, useEdgesState,
  type Node, type Edge, type Connection,
  type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { ChakraNode } from './ChakraNode';
import { ConfigPanel } from './ConfigPanel';
import { graphToYAML } from './serializer';
import type { ChakraNodeData, ChakraNodeType, ChakraConfig, RunResult } from './types';

const WORKER_URL = 'https://chakra-agent.sdas-codes.workers.dev';
const AUTH_KEY = 'chakra_studio_auth';

const NODE_DEFAULTS: Record<ChakraNodeType, ChakraConfig> = {
  loop_start: {},
  loop_end: { max_iterations: 1 },
  actor: { name: 'Actor', model: 'minimax/minimax-m3', prompt_template: 'You are a helpful agent.\n\nConversation:\n{{channel:transcript}}\n\nRespond thoughtfully.', subscribe: ['transcript'], publish: 'working_notes', temperature: 0.7 },
  router: { name: 'Branch', mode: 'llm_driven', branches: [{ label: 'yes', target: '' }, { label: 'no', target: '' }] },
  tool: { name: 'Effect', tool_type: 'emit_to_user' },
  goal: {
    name: 'Goal',
    statement: 'Deliver the requested outcome.',
    definition_of_done: 'The user-requested artifact is complete, coherent, and ready for review.',
    verification_criteria: ['Output addresses the request directly', 'Output is self-consistent', 'Any required artifact is produced'],
    subscribe: ['transcript'],
    publish: 'working_notes',
    model: 'minimax/minimax-m3',
    temperature: 0.3,
  },
  gate: {
    name: 'Delivery Gate',
    gate_kind: 'delivery',
    statement: 'Review the latest output against the requested outcome.',
    definition_of_done: 'The work satisfies the goal and all verification criteria with no material omissions.',
    verification_criteria: ['Output is complete', 'Output matches the requested scope', 'Output is ready to deliver or clearly needs revision'],
    subscribe: ['transcript', 'working_notes'],
    publish: 'gate_notes',
    model: 'minimax/minimax-m3',
    temperature: 0.1,
    pass_target: '',
    revise_target: '',
  },
};

const INITIAL_NODES: Node<ChakraNodeData>[] = [
  { id: 'rs1', type: 'chakra', position: { x: 250, y: 50 }, data: { chakraType: 'loop_start', config: {}, label: 'Start' } },
  { id: 'wait_input', type: 'chakra', position: { x: 250, y: 160 }, data: { chakraType: 'tool', config: { name: 'Wait Input', tool_type: 'wait_for_user' }, label: 'Wait Input' } },
  { id: 'thinker', type: 'chakra', position: { x: 250, y: 280 }, data: { chakraType: 'actor', config: { name: 'Thinker', model: 'minimax/minimax-m3', prompt_template: 'You are a helpful reasoning agent.\n\nConversation:\n{{channel:transcript}}\n\nThink carefully and respond.', subscribe: ['transcript'], publish: 'working_notes', temperature: 0.7 }, label: 'Thinker' } },
  { id: 'emit_response', type: 'chakra', position: { x: 250, y: 420 }, data: { chakraType: 'tool', config: { name: 'Emit Response', tool_type: 'emit_to_user' }, label: 'Emit Response' } },
  { id: 're1', type: 'chakra', position: { x: 250, y: 540 }, data: { chakraType: 'loop_end', config: { max_iterations: 1 }, label: 'End (1 round)' } },
];

const INITIAL_EDGES: Edge[] = [
  { id: 'e1', source: 'rs1', target: 'wait_input' },
  { id: 'e2', source: 'wait_input', target: 'thinker' },
  { id: 'e3', source: 'thinker', target: 'emit_response' },
  { id: 'e4', source: 'emit_response', target: 're1' },
];

const nodeTypes: NodeTypes = { chakra: ChakraNode as unknown as NodeTypes['chakra'] };

let nodeCounter = 100;

const PALETTE_ITEMS: Array<{ type: ChakraNodeType; label: string; color: string; icon: string; desc: string }> = [
  { type: 'loop_start', label: 'Loop Start', color: '#22c55e', icon: '▶', desc: 'Entry point for each round' },
  { type: 'loop_end', label: 'Loop End', color: '#ef4444', icon: '⏹', desc: 'End round or loop' },
  { type: 'goal', label: 'Goal', color: '#10b981', icon: '🎯', desc: 'Structured objective + done criteria' },
  { type: 'actor', label: 'Actor', color: '#7c6af7', icon: '🤖', desc: 'LLM inference node' },
  { type: 'gate', label: 'Gate', color: '#fb7185', icon: '🛂', desc: 'Judge with pass / revise verdict' },
  { type: 'router', label: 'Choice', color: '#f59e0b', icon: '◆', desc: 'Branch on decision' },
  { type: 'tool', label: 'Effect', color: '#38bdf8', icon: '⚡', desc: 'I/O or memory action' },
];

export default function App() {
  const [nodes, setNodes, onNodesChange] = useNodesState(INITIAL_NODES);
  const [edges, setEdges, onEdgesChange] = useEdgesState(INITIAL_EDGES);
  const [selectedNode, setSelectedNode] = useState<Node<ChakraNodeData> | null>(null);
  const [message, setMessage] = useState('');
  const [result, setResult] = useState<RunResult | null>(null);
  const [running, setRunning] = useState(false);
  const [showYAML, setShowYAML] = useState(false);
  const [auth, setAuth] = useState(() => sessionStorage.getItem(AUTH_KEY) || '');
  const [loginUser, setLoginUser] = useState('');
  const [loginPass, setLoginPass] = useState('');
  const [loginErr, setLoginErr] = useState('');
  const _reactFlowWrapper = useRef<HTMLDivElement>(null);

  const onConnect = useCallback((params: Connection) => setEdges(eds => addEdge(params, eds)), [setEdges]);
  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => { setSelectedNode(node as Node<ChakraNodeData>); }, []);
  const onPaneClick = useCallback(() => setSelectedNode(null), []);

  const updateNodeConfig = useCallback((id: string, config: Partial<ChakraNodeData['config']>) => {
    setNodes(ns => ns.map(n => {
      if (n.id !== id) return n;
      const merged = { ...n.data.config, ...config } as ChakraNodeData['config'];
      const label = ('name' in merged && merged.name) ? (merged as {name: string}).name :
        ('tool_type' in merged) ? (merged as {tool_type: string}).tool_type :
        ('max_iterations' in merged) ? `End (${(merged as {max_iterations: number}).max_iterations}r)` :
        n.data.label;
      return { ...n, data: { ...n.data, config: merged, label } };
    }));
    setSelectedNode(prev => prev?.id === id ? { ...prev, data: { ...prev.data, config: { ...prev.data.config, ...config } as ChakraNodeData['config'] } } : prev);
  }, [setNodes]);

  const addNode = useCallback((type: ChakraNodeType) => {
    const id = `${type}_${++nodeCounter}`;
    const config = { ...NODE_DEFAULTS[type] } as ChakraNodeData['config'];
    const label = ('name' in config && config.name) ? (config as {name:string}).name : type.replace('_', ' ');
    const newNode: Node<ChakraNodeData> = {
      id, type: 'chakra',
      position: { x: 100 + Math.random() * 200, y: 100 + Math.random() * 300 },
      data: { chakraType: type, config, label },
    };
    setNodes(ns => [...ns, newNode]);
  }, [setNodes]);

  const handleLogin = async () => {
    const token = btoa(`${loginUser}:${loginPass}`);
    try {
      const r = await fetch(`${WORKER_URL}/chat`, { method: 'POST', headers: { 'Authorization': `Basic ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'ping', history: [] }) });
      if (r.status !== 401) { sessionStorage.setItem(AUTH_KEY, token); setAuth(token); setLoginErr(''); }
      else setLoginErr('Wrong credentials');
    } catch { setLoginErr('Could not connect'); }
  };

  const handleRun = async () => {
    if (!message.trim() || running) return;
    setRunning(true); setResult(null);
    try {
      const yaml = yamlPreview.yaml;
      if (yamlPreview.error) {
        throw new Error(yamlPreview.error);
      }
      const res = await fetch(`${WORKER_URL}/chat`, {
        method: 'POST',
        headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, history: [], program: yaml }),
      });
      const data = await res.json() as RunResult;
      setResult(data);
    } catch (e) {
      setResult({ response: '', rounds: 0, error: String(e) });
    } finally { setRunning(false); }
  };

  const yamlPreview = useMemo(() => {
    try {
      return { yaml: graphToYAML(nodes as Node<ChakraNodeData>[], edges), error: null as string | null };
    } catch (error) {
      return { yaml: '', error: String(error) };
    }
  }, [nodes, edges]);

  if (!auth) return (
    <div style={{ height: '100vh', background: '#0d0f12', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#161920', border: '1px solid #2a2f3d', borderRadius: 16, padding: 36, width: 320 }}>
        <div style={{ fontSize: 24, fontWeight: 800, marginBottom: 6, color: '#e2e8f0' }}>⬡ Chakra Studio</div>
        <div style={{ fontSize: 13, color: '#8892a4', marginBottom: 24 }}>Sign in to use the visual DSL editor</div>
        <input placeholder="Username" value={loginUser} onChange={e => setLoginUser(e.target.value)}
          style={{ width: '100%', padding: '10px 12px', background: '#0d0f12', border: '1px solid #2a2f3d', borderRadius: 8, color: '#e2e8f0', fontSize: 14, marginBottom: 10, boxSizing: 'border-box' }} />
        <input placeholder="Password" type="password" value={loginPass} onChange={e => setLoginPass(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleLogin()}
          style={{ width: '100%', padding: '10px 12px', background: '#0d0f12', border: '1px solid #2a2f3d', borderRadius: 8, color: '#e2e8f0', fontSize: 14, marginBottom: 10, boxSizing: 'border-box' }} />
        {loginErr && <div style={{ color: '#ef4444', fontSize: 12, marginBottom: 10 }}>{loginErr}</div>}
        <button onClick={handleLogin} style={{ width: '100%', padding: 12, background: '#7c6af7', color: '#fff', borderRadius: 8, fontWeight: 700, fontSize: 15, cursor: 'pointer' }}>Sign In</button>
      </div>
    </div>
  );

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#0d0f12', color: '#e2e8f0', fontFamily: '-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif' }}>
      <div style={{ padding: '10px 16px', borderBottom: '1px solid #2a2f3d', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <span style={{ fontSize: 20 }}>⬡</span>
        <span style={{ fontWeight: 800, fontSize: 16 }}>Chakra Studio</span>
        <span style={{ fontSize: 11, color: '#8892a4', background: '#1e2330', padding: '2px 10px', borderRadius: 20, border: '1px solid #2a2f3d' }}>visual DSL editor</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button onClick={() => setShowYAML(s => !s)} style={{ padding: '6px 12px', background: '#1e2330', border: '1px solid #2a2f3d', borderRadius: 7, color: '#8892a4', fontSize: 12, cursor: 'pointer' }}>
            {showYAML ? 'Hide YAML' : 'View YAML'}
          </button>
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <div style={{ width: 180, background: '#161920', borderRight: '1px solid #2a2f3d', padding: 12, display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0, overflowY: 'auto' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#8892a4', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Add Node</div>
          {PALETTE_ITEMS.map(item => (
            <button key={item.type} onClick={() => addNode(item.type)}
              style={{ padding: '10px 10px', background: '#1e2330', border: `1px solid ${item.color}40`, borderRadius: 8, color: '#e2e8f0', cursor: 'pointer', textAlign: 'left' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 16 }}>{item.icon}</span>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: item.color }}>{item.label}</div>
                  <div style={{ fontSize: 10, color: '#8892a4', lineHeight: 1.3 }}>{item.desc}</div>
                </div>
              </div>
            </button>
          ))}
          <div style={{ marginTop: 'auto', fontSize: 10, color: '#8892a4', lineHeight: 1.5, paddingTop: 12 }}>
            Click to add.<br />Drag to reposition.<br />Click node to configure.<br />Drag handles to connect.
          </div>
        </div>

        <div style={{ flex: 1, position: 'relative' }} ref={_reactFlowWrapper}>
          <ReactFlow
            nodes={nodes} edges={edges}
            onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
            onConnect={onConnect} onNodeClick={onNodeClick} onPaneClick={onPaneClick}
            nodeTypes={nodeTypes} fitView
            style={{ background: '#0d0f12' }}
            defaultEdgeOptions={{ style: { stroke: '#4b5563', strokeWidth: 2 }, markerEnd: { type: 'arrowclosed' as const, color: '#4b5563' } }}
          >
            <Background color="#1e2330" gap={24} />
            <Controls style={{ background: '#1e2330', border: '1px solid #2a2f3d' }} />
            <MiniMap style={{ background: '#161920' }} nodeColor="#7c6af7" />
          </ReactFlow>
        </div>

        <div style={{ width: 260, background: '#161920', borderLeft: '1px solid #2a2f3d', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid #2a2f3d', fontSize: 11, fontWeight: 700, color: '#8892a4', textTransform: 'uppercase', letterSpacing: 1 }}>
            {selectedNode ? 'Configure Node' : 'Run Program'}
          </div>
          {selectedNode ? (
            <>
              <ConfigPanel node={selectedNode} onChange={updateNodeConfig} />
              <button onClick={() => setSelectedNode(null)} style={{ margin: '0 16px 16px', padding: '8px 0', background: '#0d0f12', border: '1px solid #2a2f3d', borderRadius: 7, color: '#8892a4', fontSize: 13, cursor: 'pointer' }}>← Back to Run</button>
            </>
          ) : (
            <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10, flex: 1, overflowY: 'auto' }}>
              <div style={{ fontSize: 12, color: '#8892a4' }}>Your graph → Chakra YAML → Worker → response.</div>
              <label style={{ fontSize: 11, fontWeight: 700, color: '#8892a4', textTransform: 'uppercase', letterSpacing: 0.8 }}>Message</label>
              <textarea value={message} onChange={e => setMessage(e.target.value)} placeholder="Ask the agent something..."
                style={{ padding: '9px 10px', background: '#0d0f12', border: '1px solid #2a2f3d', borderRadius: 8, color: '#e2e8f0', fontSize: 13, resize: 'vertical', height: 80 }} />
              <button onClick={handleRun} disabled={running || !message.trim()}
                style={{ padding: '10px 0', background: running ? '#2a2f3d' : '#7c6af7', color: running ? '#8892a4' : '#fff', borderRadius: 8, fontWeight: 700, fontSize: 14, cursor: running ? 'not-allowed' : 'pointer' }}>
                {running ? '⏳ Running...' : '▶ Run Program'}
              </button>
              {result && (
                <div style={{ background: '#0d0f12', border: `1px solid ${result.error ? '#ef444440' : '#7c6af740'}`, borderRadius: 10, padding: 12 }}>
                  {result.rounds > 0 && <div style={{ fontSize: 10, color: '#8892a4', marginBottom: 8 }}>{result.rounds} round{result.rounds !== 1 ? 's' : ''}</div>}
                  <div style={{ fontSize: 13, color: result.error ? '#ef4444' : '#e2e8f0', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{result.error ?? result.response}</div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {showYAML && (
        <div style={{ height: 240, background: '#161920', borderTop: '1px solid #2a2f3d', padding: 12, flexShrink: 0 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#8892a4', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Generated YAML</div>
          {yamlPreview.error ? (
            <div style={{ fontSize: 11, color: '#ef4444', whiteSpace: 'pre-wrap' }}>{yamlPreview.error}</div>
          ) : (
            <pre style={{ fontSize: 11, color: '#a5f3fc', overflowY: 'auto', height: 190, margin: 0 }}>{yamlPreview.yaml}</pre>
          )}
        </div>
      )}
    </div>
  );
}
