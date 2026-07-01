import { Handle, Position } from '@xyflow/react';
import type { ChakraNodeData, ChakraNodeType } from './types';

const NODE_COLORS: Record<ChakraNodeType, string> = {
  loop_start: '#22c55e',
  loop_end: '#ef4444',
  actor: '#7c6af7',
  router: '#f59e0b',
  tool: '#38bdf8',
  goal: '#10b981',
  gate: '#fb7185',
};

const NODE_ICONS: Record<ChakraNodeType, string> = {
  loop_start: '▶',
  loop_end: '⏹',
  actor: '🤖',
  router: '◆',
  tool: '⚡',
  goal: '🎯',
  gate: '🛂',
};

interface Props {
  data: ChakraNodeData;
  selected: boolean;
}

export function ChakraNode({ data, selected }: Props) {
  const color = NODE_COLORS[data.chakraType];
  const isDiamond = data.chakraType === 'router' || data.chakraType === 'gate';
  return (
    <div style={{
      background: '#1e2330',
      border: `2px solid ${selected ? '#fff' : color}`,
      borderRadius: isDiamond ? 4 : 10,
      padding: '10px 14px',
      minWidth: 140,
      maxWidth: 200,
      transform: isDiamond ? 'rotate(45deg)' : undefined,
      boxShadow: selected ? `0 0 0 2px ${color}40` : `0 2px 8px rgba(0,0,0,0.4)`,
    }}>
      <Handle type="target" position={Position.Top} style={{ background: color, width: 10, height: 10 }} />
      <div style={{
        transform: isDiamond ? 'rotate(-45deg)' : undefined,
        textAlign: 'center',
      }}>
        <div style={{ fontSize: 18, marginBottom: 4 }}>{NODE_ICONS[data.chakraType]}</div>
        <div style={{ fontSize: 12, fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 }}>
          {data.chakraType.replace('_', ' ')}
        </div>
        <div style={{ fontSize: 13, color: '#e2e8f0', fontWeight: 500 }}>{data.label}</div>
      </div>
      <Handle type="source" position={Position.Bottom} style={{ background: color, width: 10, height: 10 }} />
    </div>
  );
}
