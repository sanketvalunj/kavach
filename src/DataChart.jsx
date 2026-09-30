import React from 'react';
import {
  Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts';

const tooltipStyle = {
  contentStyle: { background: '#222c2d', border: '1px solid rgba(224,238,234,.12)', borderRadius: 7, color: '#dce5e1', fontSize: 10 },
  labelStyle: { color: '#94a39f' },
  itemStyle: { color: '#8ccbc0' },
};

export default function DataChart({ kind, data }) {
  if (kind === 'emitter') return <ResponsiveContainer width="100%" height="100%">
    <LineChart data={data} margin={{ top: 12, right: 16, left: 0, bottom: 0 }}>
      <CartesianGrid stroke="rgba(220,235,230,.08)" vertical={false} />
      <XAxis dataKey="t" tickFormatter={v => `${String(v).padStart(2, '0')}:00`} tick={{ fill: '#71807d', fontSize: 9, fontFamily: 'DM Mono' }} axisLine={false} tickLine={false} />
      <YAxis domain={['dataMin - .02', 'dataMax + .02']} tickFormatter={v => v.toFixed(2)} tick={{ fill: '#71807d', fontSize: 9, fontFamily: 'DM Mono' }} axisLine={false} tickLine={false} width={48} />
      <Tooltip {...tooltipStyle} formatter={v => [`${Number(v).toFixed(4)} GHz`, 'Frequency']} />
      <Line type="monotone" dataKey="freq" stroke="#75c9bf" strokeWidth={2} dot={false} activeDot={{ r: 3, fill: '#d6eee4' }} />
    </LineChart>
  </ResponsiveContainer>;

  const chartData = data.values.map((v, i) => ({ t: i, v }));
  if (data.key === 'hits') {
    const hitMissData = data.values.map((v, i) => ({ t: i, hits: v, misses: 100 - v }));
    return <ResponsiveContainer width="100%" height="100%">
      <LineChart data={hitMissData} margin={{ top: 8, right: 2, left: 0, bottom: 0 }}>
        <Line type="monotone" dataKey="hits" stroke="#89b59b" strokeWidth={1.8} dot={false} />
        <Line type="monotone" dataKey="misses" stroke="#c77e79" strokeWidth={1.5} dot={false} />
        <Tooltip {...tooltipStyle} />
      </LineChart>
    </ResponsiveContainer>;
  }
  return <ResponsiveContainer width="100%" height="100%">
    <AreaChart data={chartData} margin={{ top: 8, right: 2, left: 0, bottom: 0 }}>
      <defs><linearGradient id={`grad-${data.key}`} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor={data.color} stopOpacity={.22} /><stop offset="100%" stopColor={data.color} stopOpacity={0} /></linearGradient></defs>
      <Area type="monotone" dataKey="v" stroke={data.color} fill={`url(#grad-${data.key})`} strokeWidth={1.7} dot={false} />
      <Tooltip {...tooltipStyle} />
    </AreaChart>
  </ResponsiveContainer>;
}
