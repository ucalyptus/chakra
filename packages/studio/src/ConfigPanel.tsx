import { type Node } from '@xyflow/react';
import type {
  ChakraNodeData,
  ActorConfig,
  RouterConfig,
  ToolConfig,
  LoopEndConfig,
  GoalConfig,
  GateConfig,
} from './types';

interface Props {
  node: Node<ChakraNodeData> | null;
  onChange: (id: string, config: Partial<ChakraNodeData['config']>) => void;
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '7px 10px', background: '#0d0f12', border: '1px solid #2a2f3d',
  borderRadius: 6, color: '#e2e8f0', fontSize: 13, marginBottom: 10,
};
const labelStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, color: '#8892a4', textTransform: 'uppercase',
  letterSpacing: 0.8, display: 'block', marginBottom: 4,
};

export function ConfigPanel({ node, onChange }: Props) {
  if (!node) return (
    <div style={{ padding: 20, color: '#8892a4', fontSize: 13, fontStyle: 'italic' }}>
      Select a node to configure it
    </div>
  );

  const { chakraType, config } = node.data;
  const id = node.id;

  return (
    <div style={{ padding: 16, overflowY: 'auto', flex: 1 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#7c6af7', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 14 }}>
        {chakraType.replace('_', ' ')} · {id}
      </div>

      {chakraType === 'actor' && (() => {
        const cfg = config as ActorConfig;
        return (
          <>
            <label style={labelStyle}>Name</label>
            <input style={inputStyle} value={cfg.name || ''} onChange={e => onChange(id, { ...cfg, name: e.target.value })} />

            <label style={labelStyle}>Model</label>
            <select style={inputStyle} value={cfg.model || 'minimax/minimax-m3'} onChange={e => onChange(id, { ...cfg, model: e.target.value })}>
              <option value="minimax/minimax-m3">minimax/minimax-m3</option>
              <option value="minimax/minimax-01">minimax/minimax-01</option>
              <option value="google/gemini-2.5-flash">gemini-2.5-flash</option>
              <option value="anthropic/claude-sonnet-4-6">claude-sonnet-4-6</option>
              <option value="deepseek/deepseek-r1">deepseek-r1</option>
            </select>

            <label style={labelStyle}>Temperature</label>
            <input style={inputStyle} type="number" step="0.1" min="0" max="2"
              value={cfg.temperature ?? 0.7} onChange={e => onChange(id, { ...cfg, temperature: parseFloat(e.target.value) })} />

            <label style={labelStyle}>Subscribe channels (comma-separated)</label>
            <input style={inputStyle} value={(cfg.subscribe || []).join(', ')}
              onChange={e => onChange(id, { ...cfg, subscribe: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })} />

            <label style={labelStyle}>Publish channel</label>
            <input style={inputStyle} value={cfg.publish || ''} onChange={e => onChange(id, { ...cfg, publish: e.target.value })} />

            <label style={labelStyle}>Prompt template</label>
            <textarea style={{ ...inputStyle, height: 160, resize: 'vertical', fontFamily: 'monospace' }}
              value={cfg.prompt_template || ''} onChange={e => onChange(id, { ...cfg, prompt_template: e.target.value })} />
          </>
        );
      })()}

      {chakraType === 'goal' && (() => {
        const cfg = config as GoalConfig;
        return (
          <>
            <label style={labelStyle}>Name</label>
            <input style={inputStyle} value={cfg.name || ''} onChange={e => onChange(id, { ...cfg, name: e.target.value })} />

            <label style={labelStyle}>Statement</label>
            <textarea style={{ ...inputStyle, height: 80, resize: 'vertical' }}
              value={cfg.statement || ''} onChange={e => onChange(id, { ...cfg, statement: e.target.value })} />

            <label style={labelStyle}>Definition of done</label>
            <textarea style={{ ...inputStyle, height: 100, resize: 'vertical' }}
              value={cfg.definition_of_done || ''} onChange={e => onChange(id, { ...cfg, definition_of_done: e.target.value })} />

            <label style={labelStyle}>Verification criteria (one per line)</label>
            <textarea style={{ ...inputStyle, height: 120, resize: 'vertical' }}
              value={(cfg.verification_criteria || []).join('\n')}
              onChange={e => onChange(id, { ...cfg, verification_criteria: e.target.value.split('\n').map(s => s.trim()).filter(Boolean) })} />

            <label style={labelStyle}>Subscribe channels (comma-separated)</label>
            <input style={inputStyle} value={(cfg.subscribe || []).join(', ')}
              onChange={e => onChange(id, { ...cfg, subscribe: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })} />

            <label style={labelStyle}>Publish channel</label>
            <input style={inputStyle} value={cfg.publish || ''} onChange={e => onChange(id, { ...cfg, publish: e.target.value })} />

            <label style={labelStyle}>Model</label>
            <input style={inputStyle} value={cfg.model || ''} onChange={e => onChange(id, { ...cfg, model: e.target.value })} />

            <label style={labelStyle}>Temperature</label>
            <input style={inputStyle} type="number" step="0.1" min="0" max="2"
              value={cfg.temperature ?? 0.3} onChange={e => onChange(id, { ...cfg, temperature: parseFloat(e.target.value) })} />
          </>
        );
      })()}

      {chakraType === 'gate' && (() => {
        const cfg = config as GateConfig;
        return (
          <>
            <label style={labelStyle}>Name</label>
            <input style={inputStyle} value={cfg.name || ''} onChange={e => onChange(id, { ...cfg, name: e.target.value })} />

            <label style={labelStyle}>Gate kind</label>
            <select style={inputStyle} value={cfg.gate_kind ?? 'delivery'} onChange={e => onChange(id, { ...cfg, gate_kind: e.target.value as GateConfig['gate_kind'] })}>
              <option value="plan">plan — review plan quality before execution</option>
              <option value="delivery">delivery — review finished work before shipping</option>
            </select>

            <label style={labelStyle}>Statement</label>
            <textarea style={{ ...inputStyle, height: 80, resize: 'vertical' }}
              value={cfg.statement || ''} onChange={e => onChange(id, { ...cfg, statement: e.target.value })} />

            <label style={labelStyle}>Definition of done</label>
            <textarea style={{ ...inputStyle, height: 100, resize: 'vertical' }}
              value={cfg.definition_of_done || ''} onChange={e => onChange(id, { ...cfg, definition_of_done: e.target.value })} />

            <label style={labelStyle}>Verification criteria (one per line)</label>
            <textarea style={{ ...inputStyle, height: 120, resize: 'vertical' }}
              value={(cfg.verification_criteria || []).join('\n')}
              onChange={e => onChange(id, { ...cfg, verification_criteria: e.target.value.split('\n').map(s => s.trim()).filter(Boolean) })} />

            <label style={labelStyle}>Subscribe channels (comma-separated)</label>
            <input style={inputStyle} value={(cfg.subscribe || []).join(', ')}
              onChange={e => onChange(id, { ...cfg, subscribe: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })} />

            <label style={labelStyle}>Publish channel</label>
            <input style={inputStyle} value={cfg.publish || ''} onChange={e => onChange(id, { ...cfg, publish: e.target.value })} />

            <label style={labelStyle}>Model</label>
            <input style={inputStyle} value={cfg.model || ''} onChange={e => onChange(id, { ...cfg, model: e.target.value })} />

            <label style={labelStyle}>Temperature</label>
            <input style={inputStyle} type="number" step="0.1" min="0" max="2"
              value={cfg.temperature ?? 0.1} onChange={e => onChange(id, { ...cfg, temperature: parseFloat(e.target.value) })} />

            <label style={labelStyle}>Pass target node id</label>
            <input style={inputStyle} value={cfg.pass_target || ''} onChange={e => onChange(id, { ...cfg, pass_target: e.target.value })} />

            <label style={labelStyle}>Revise target node id</label>
            <input style={inputStyle} value={cfg.revise_target || ''} onChange={e => onChange(id, { ...cfg, revise_target: e.target.value })} />
          </>
        );
      })()}

      {chakraType === 'router' && (() => {
        const cfg = config as RouterConfig;
        return (
          <>
            <label style={labelStyle}>Name</label>
            <input style={inputStyle} value={cfg.name || ''} onChange={e => onChange(id, { ...cfg, name: e.target.value })} />

            <label style={labelStyle}>Mode</label>
            <select style={inputStyle} value={cfg.mode ?? 'llm_driven'} onChange={e => onChange(id, { ...cfg, mode: e.target.value as 'llm_driven' | 'expression' })}>
              <option value="llm_driven">llm_driven — parse &lt;decision&gt; tags</option>
              <option value="expression">expression — keyword match</option>
            </select>

            <label style={labelStyle}>Branches (label → target node id)</label>
            {(cfg.branches ?? []).map((b, i) => (
              <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                <input placeholder="label" style={{ ...inputStyle, marginBottom: 0, flex: 1 }} value={b.label}
                  onChange={e => { const bs = [...(cfg.branches ?? [])]; bs[i] = { ...bs[i], label: e.target.value }; onChange(id, { ...cfg, branches: bs }); }} />
                <input placeholder="target id" style={{ ...inputStyle, marginBottom: 0, flex: 1 }} value={b.target}
                  onChange={e => { const bs = [...(cfg.branches ?? [])]; bs[i] = { ...bs[i], target: e.target.value }; onChange(id, { ...cfg, branches: bs }); }} />
                <button onClick={() => { const bs = (cfg.branches ?? []).filter((_, j) => j !== i); onChange(id, { ...cfg, branches: bs }); }}
                  style={{ padding: '0 8px', background: '#ef444430', color: '#ef4444', borderRadius: 6, fontSize: 16, cursor: 'pointer' }}>×</button>
              </div>
            ))}
            <button onClick={() => onChange(id, { ...cfg, branches: [...(cfg.branches ?? []), { label: '', target: '' }] })}
              style={{ ...inputStyle, background: '#7c6af720', color: '#7c6af7', border: '1px dashed #7c6af7', cursor: 'pointer', textAlign: 'center' }}>
              + Add branch
            </button>
          </>
        );
      })()}

      {chakraType === 'tool' && (() => {
        const cfg = config as ToolConfig;
        return (
          <>
            <label style={labelStyle}>Name</label>
            <input style={inputStyle} value={cfg.name || ''} onChange={e => onChange(id, { ...cfg, name: e.target.value })} />

            <label style={labelStyle}>Tool type</label>
            <select style={inputStyle} value={cfg.tool_type ?? 'emit_to_user'} onChange={e => onChange(id, { ...cfg, tool_type: e.target.value as ToolConfig['tool_type'] })}>
              <option value="wait_for_user">wait_for_user — receive input</option>
              <option value="emit_to_user">emit_to_user — send response</option>
              <option value="memory_write">memory_write — write to channel</option>
              <option value="log">log — debug event</option>
            </select>
          </>
        );
      })()}

      {chakraType === 'loop_end' && (() => {
        const cfg = config as LoopEndConfig;
        return (
          <>
            <label style={labelStyle}>Max iterations</label>
            <input style={inputStyle} type="number" min="1" max="20"
              value={cfg.max_iterations ?? 1} onChange={e => onChange(id, { max_iterations: parseInt(e.target.value) })} />
          </>
        );
      })()}

      {(chakraType === 'loop_start') && (
        <div style={{ color: '#8892a4', fontSize: 13 }}>No configuration needed. This is the loop entry point.</div>
      )}
    </div>
  );
}
