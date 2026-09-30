import React, { Suspense, lazy, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Activity, Antenna, ArrowDownRight, ArrowUpRight, AudioWaveform, Bell, ChevronDown, ChevronRight, Crosshair, Database, FlaskConical, Gauge, Headphones, Layers3, Menu, Microscope, Radio, Radar, Settings2, Shield, Signal, SlidersHorizontal, Sparkles, Target, Waves, X, Play, ArrowRight, Check, Maximize2 } from 'lucide-react';
import { selectOperatorEmitters, useSimulationStore } from './store/simulationStore';
import { BELIEF_WEIGHTS } from './simulation/beliefEngine.ts';
import './simulation/loop';
import { connectStream } from './services/stream';
import { listScenarios, loadScenario as loadBackendScenario, startScenario, pauseScenario, resetScenario, getSimulationState, login, getHistory, exportHistory, runResearchBaselines, getResearchGroundTruth } from './services/api';
import { clearAuthSession, getAuthSession, saveAuthSession } from './services/auth';

const SpectrumScene = lazy(() => import('./SpectrumScene.jsx'));
const DataChart = lazy(() => import('./DataChart.jsx'));
const ease = [.22, 1, .36, 1];

const nav = [
  { title: 'OPERATIONS', items: [{ label: 'Command center', icon: Radar, active: true }, { label: 'Live spectrum', icon: AudioWaveform }, { label: 'Scan strategy', icon: SlidersHorizontal }, { label: 'Emitter activity', icon: Antenna }, { label: 'Scenario lab', icon: FlaskConical }] },
  { title: 'ANALYSIS', items: [{ label: 'Decision history', icon: Layers3 }, { label: 'Performance', icon: Gauge }, { label: 'Research mode', icon: Microscope }] },
];

function Mono({ children, className = '' }) { return <span className={`mono ${className}`}>{children}</span>; }
function Status({ children, tone = 'teal', live = false }) { return <span className={`status status-${tone}`}><i className={live ? 'live-dot' : ''} />{children}</span>; }
function Panel({ children, className = '', delay = 0 }) { return <motion.section className={`panel ${className}`} initial={{ opacity: 0, y: 9 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .48, delay, ease }}>{children}</motion.section>; }

function Sidebar({ active, setActive, collapsed, setCollapsed, session }) {
  const currentTime = useSimulationStore(s => s.currentSimulationTime);
  const operationId = useSimulationStore(s => s.operationId);
  return <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
    <div className="brand"><div className="brand-mark"><Shield size={19} strokeWidth={1.6} /></div>{!collapsed && <div><b>AEGIS</b><small>EW COMMAND</small></div>}<button className="collapse-btn" onClick={() => setCollapsed(!collapsed)}><Menu size={16} /></button></div>
    <div className="mission"><span className="eyebrow">ACTIVE THEATER</span><div className="mission-name">{!collapsed ? <>Northern Sector <ChevronDown size={13} /></> : <Target size={16} />}</div><div className="mission-code mono">{operationId} · {currentTime}Z</div></div>
    {nav.map(group => <div className="nav-group" key={group.title}>{!collapsed && <div className="nav-title">{group.title}</div>}{group.items.filter(item => item.label !== 'Research mode' || session?.role === 'RESEARCHER').map(item => <button key={item.label} onClick={() => setActive(item.label)} className={`nav-item ${active === item.label ? 'selected' : ''}`} title={collapsed ? item.label : undefined}><item.icon size={17} strokeWidth={1.7} />{!collapsed && <span>{item.label}</span>}{active === item.label && <i />}</button>)}</div>)}
    <div className="sidebar-spacer" />
    <button className="operator profile-link" onClick={() => setActive('Profile')} title="Open profile"><div className="avatar">{(session?.username || 'SK').slice(0, 2).toUpperCase()}</div>{!collapsed && <div><b>{(session?.username || 'S. KAPOOR').toUpperCase()}</b><small>{session?.role || 'OPERATOR'} · ACCOUNT</small></div>}<span className="operator-live" />{!collapsed && <Settings2 className="operator-settings" size={16}/>}</button>
  </aside>;
}

function Header({ active, onNavigate, onSourceChange }) {
  const group = nav.find(g => g.items.some(i => i.label === active))?.title || 'OPERATIONS';
  const currentTime = useSimulationStore(s => s.currentSimulationTime);
  const activeAlerts = useSimulationStore(s => s.activeAlerts);
  const constraints = useSimulationStore(s => s.receiverConstraints);
  const source = useSimulationStore(s => s.dataSource);
  const setAlerts = useSimulationStore(s => s.setAlerts);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  return <header className="topbar"><div className="breadcrumb"><span>{group}</span><ChevronRight size={13} /><b>{active.toUpperCase()}</b></div><div className="top-right"><label className="data-source-control"><span className="eyebrow">DATA SOURCE</span><select aria-label="Data source" value={source} onChange={e => onSourceChange(e.target.value)}><option value="OFFLINE">OFFLINE SIMULATION</option><option value="LIVE">LIVE BACKEND · DATASET REPLAY</option></select></label><AuthControl /><div className="system-health"><span className="health-dot" /> SYSTEM NOMINAL <span className="divider" /><Mono>SYNC {constraints.retuningDelayMs}ms</Mono></div><div className="notification-wrap"><button aria-label="Notifications" aria-expanded={notificationsOpen} className="icon-button notification" onClick={() => setNotificationsOpen(open => !open)}><Bell size={17} />{activeAlerts.some(a => a.active) && <i />}</button>{notificationsOpen && <div className="notification-panel"><div className="notification-head"><b>NOTIFICATIONS</b><button aria-label="Close notifications" onClick={() => setNotificationsOpen(false)}><X size={14}/></button></div>{activeAlerts.filter(a => a.active).length ? activeAlerts.filter(a => a.active).map(alert => <button className="notification-item" key={alert.id} onClick={() => { setNotificationsOpen(false); onNavigate(alert.severity === "CRITICAL" ? "Research mode" : "Decision history"); }}><span className="notification-severity">{alert.severity} · {alert.timestamp}</span><b>{alert.title}</b><small>{alert.description}</small></button>) : <p className="notification-empty">All clear. No active alerts.</p>}<button className="notification-clear" onClick={() => setAlerts(activeAlerts.map(alert => ({ ...alert, active: false })))}>CLEAR ACTIVE ALERTS</button></div>}</div><div className="utc"><span className="eyebrow">UTC</span><Mono>{currentTime}</Mono></div></div></header>;
}

function AuthControl() {
  const [session, setSession] = useState(getAuthSession);
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async event => { event.preventDefault(); setBusy(true); setError(''); try { const result = await login(username, password); setSession(getAuthSession()); window.dispatchEvent(new Event('aegis-auth-changed')); setPassword(''); setOpen(false); } catch (problem) { setError(problem.message); } finally { setBusy(false); } };
  const logout = () => { clearAuthSession(); setSession(null); window.dispatchEvent(new Event('aegis-auth-changed')); };
  return <div className="auth-control"><button className="subtle-button" onClick={() => session ? logout() : setOpen(value => !value)}>{session ? `${session.role} · LOG OUT` : 'SIGN IN'}</button>{open && <form className="auth-popover" onSubmit={submit}><div className="eyebrow">PILOT ACCOUNT</div><input autoComplete="username" placeholder="Username" value={username} onChange={event => setUsername(event.target.value)} /><input autoComplete="current-password" type="password" placeholder="Password" value={password} onChange={event => setPassword(event.target.value)} />{error && <small>{error}</small>}<button className="button-primary" disabled={busy}>{busy ? 'SIGNING IN…' : 'SIGN IN'}</button></form>}</div>;
}

function SpectrumPanel() {
  const receiver = useSimulationStore(s => s.receiverState);
  const emitters = useSimulationStore(selectOperatorEmitters);
  const constraints = useSimulationStore(s => s.receiverConstraints);
  const simulationStatus = useSimulationStore(s => s.simulationStatus);
  const dataSource = useSimulationStore(s => s.dataSource);
  const startSimulation = useSimulationStore(s => s.startSimulation);
  const pauseSimulation = useSimulationStore(s => s.pauseSimulation);
  const toggleLive = () => { if (dataSource === 'LIVE') void (simulationStatus === 'RUNNING' ? pauseScenario() : startScenario()).then(state => useSimulationStore.getState().applyBackendDelta({ type: 'full_state', version: 1, ...state })).catch(error => window.dispatchEvent(new CustomEvent('aegis-toast', { detail: error.message }))); else simulationStatus === 'RUNNING' ? pauseSimulation() : startSimulation(); };
  return <Panel className="spectrum-panel" delay={.08}>
    <div className="panel-heading spectrum-heading"><div><div className="eyebrow"><span className="small-live" /> LIVE SPECTRUM · RF ENVIRONMENT</div><h2>Signal field <span className="heading-divider">/</span> <span className="subheading">Wideband capture</span></h2></div><div className="heading-actions"><Status live={simulationStatus === 'RUNNING'} tone={simulationStatus === 'RUNNING' ? 'teal' : simulationStatus === 'PAUSED' ? 'amber' : 'quiet'}>{simulationStatus === 'RUNNING' ? 'RECEIVING' : simulationStatus}</Status><button className="subtle-button" onClick={toggleLive} aria-label={simulationStatus === 'RUNNING' ? 'Pause live simulation' : 'Resume live simulation'}><span className="small-live" /> LIVE VIEW <ChevronDown size={13} /></button></div></div>
    <div className="spectrum-stage"><div className="stage-watermark">RF / 3D FIELD VIEW</div><div className="scene-wrap"><Suspense fallback={<div className="scene-loading">INITIALIZING FIELD MODEL</div>}><SpectrumScene /></Suspense></div>
      <div className="scene-callout callout-left"><span className="eyebrow">ACTIVE BAND</span><Mono>{receiver.currentFrequencyGHz.toFixed(2)} GHz</Mono></div>
      <div className="scene-callout callout-right"><span className="eyebrow">SIGNAL CLUSTER</span><Mono>{String(emitters.filter(e => e.status === 'ACTIVE' || e.status === 'TRACKED').length).padStart(2, '0')} / {String(emitters.length).padStart(2, '0')}</Mono></div>
      <div className="scene-legend"><span><i className="legend-pulse" /> Signal burst</span><span><i className="legend-marker" /> Receiver</span></div>
      <div className="frequency-label freq-low"><Mono>{constraints.frequencyMinGHz.toFixed(1)} GHz</Mono></div><div className="frequency-label freq-high"><Mono>{constraints.frequencyMaxGHz.toFixed(1)} GHz</Mono></div>
    </div>
    <div className="spectrum-footer"><div className="range-label"><span className="eyebrow">CAPTURE RANGE</span><Mono>{constraints.frequencyMinGHz.toFixed(1)} — {constraints.frequencyMaxGHz.toFixed(1)} GHz</Mono></div><div className="scale-track"><i /><i /><i /><i /><i /><span /></div><div className="receiver-label"><span className="eyebrow">RECEIVER</span><Mono>{receiver.id} · <em>{receiver.isRetuning ? 'RETUNING' : receiver.mode}</em></Mono></div></div>
  </Panel>;
}

function Observation({ onNavigate = () => { } }) {
  const emitter = useSimulationStore(selectOperatorEmitters)[0];
  const alert = useSimulationStore(s => s.activeAlerts.find(a => a.active));
  const simulationStatus = useSimulationStore(s => s.simulationStatus);
  if (simulationStatus === 'IDLE') return <Panel className="observation-panel empty-panel" delay={.13}><div className="eyebrow">CURRENT OBSERVATION</div><h3>No active RF scenario</h3><p>Start a scenario to begin spectrum monitoring.</p></Panel>;
  if (!emitter) return <Panel className="observation-panel empty-panel" delay={.13}><div className="eyebrow">CURRENT OBSERVATION</div><h3>Awaiting dataset pulses</h3><p>The recorded TSRD replay will populate emitter tracks as pulse rows arrive.</p></Panel>;
  return <Panel className="observation-panel" delay={.13}>
    <div className="panel-heading compact"><div><div className="eyebrow">CURRENT OBSERVATION</div><h3>Emitter detected</h3></div><Status tone={alert?.severity === 'CRITICAL' ? 'red' : 'amber'}>{alert?.displayLabel || 'NOMINAL'}</Status></div>
    <div className="emitter-id"><div className="emitter-icon"><Antenna size={17} /></div><div><b>{emitter.displayName} <span className="muted">/</span> {emitter.id}</b><small>TRACKED · FIRST SEEN {emitter.firstSeenTimestamp}</small>{alert?.description && <small className="alert-detail">{alert.description}</small>}</div><button className="dots" aria-label="Inspect emitter" title="Open emitter details" onClick={() => onNavigate("Emitter activity")}>···</button></div>
    <div className="observation-grid">
      <div className="obs-cell"><span className="eyebrow">CENTER FREQUENCY</span><Mono className="large-number">{emitter.centerFrequencyGHz.toFixed(3)} <small>GHz</small></Mono><span className="trend"><ArrowUpRight size={12} /> +{emitter.frequencyDeltaMHz.toFixed(1)} MHz</span></div>
      <div className="obs-cell"><span className="eyebrow">PULSE REP. INT.</span><Mono className="large-number">{emitter.priMs.toFixed(3)} <small>ms</small></Mono><span className="trend neutral"><Activity size={12} /> {emitter.stabilityStatus}</span></div>
      <div className="obs-cell"><span className="eyebrow">CONFIDENCE</span><Mono className="large-number">{(emitter.confidence * 100).toFixed(1)}<small>%</small></Mono><div className="confidence-track"><motion.i initial={{ width: 0 }} animate={{ width: `${emitter.confidence * 100}%` }} transition={{ duration: .85, delay: .32, ease }} /></div></div>
      <div className="obs-cell"><span className="eyebrow">SIGNAL STRENGTH</span><Mono className="large-number">{emitter.signalStrengthDbm} <small>dBm</small></Mono><span className="signal-bars">{Array.from({ length: 10 }, (_, i) => <motion.i key={i} className={i > 7 ? 'dim' : ''} initial={{ scaleY: 0 }} animate={{ scaleY: 1 }} transition={{ duration: .36, delay: .22 + i * .045, ease }} />)}</span></div>
    </div>
    <button className="button-primary" onClick={() => onNavigate('Emitter activity')}>VIEW SIGNAL PROFILE <ChevronRight size={15} /></button>
  </Panel>;
}

function Recommendation({ onNavigate = () => { } }) {
  const recommendation = useSimulationStore(s => s.currentRecommendation);
  return <Panel className="recommendation-panel" delay={.18}>
    <div className="panel-heading compact"><div><div className="eyebrow"><Sparkles size={12} /> NEXT SCAN RECOMMENDATION</div><h3>{recommendation.title}</h3></div><span className="rec-index mono">01 / 03</span></div>
    <motion.div key={`${recommendation.bandId}-${recommendation.title}`} className="rec-band" initial={{ opacity: .55, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .42, ease }}><div className="band-icon"><Waves size={16} /></div><div className="band-details"><b>{recommendation.frequencyStartGHz.toFixed(2)} – {recommendation.frequencyEndGHz.toFixed(2)} <small>GHz</small></b><span>{recommendation.explanation}</span></div><Status tone="amber">{recommendation.likelihood.toFixed(2)} LIKELIHOOD</Status></motion.div>
    <div className="rec-meta"><span><span className="eyebrow">EXPECTED YIELD</span><Mono>+{recommendation.expectedYieldPercent}% <ArrowUpRight size={12} /></Mono></span><span><span className="eyebrow">DWELL TIME</span><Mono>{recommendation.dwellMs} ms</Mono></span><span><span className="eyebrow">BASIS</span><span className="basis-chip">{recommendation.basis}</span></span></div>
    <div className="recommendation-actions"><button className="button-secondary" onClick={() => onNavigate('Live spectrum')}>APPLY SCAN PLAN <ChevronRight size={15} /></button><button className="text-action" onClick={() => onNavigate('Decision history')}>VIEW DECISION <ArrowUpRight size={13} /></button></div>
  </Panel>;
}

function RecentActivity({ onNavigate = () => { } }) {
  const pdws = useSimulationStore(s => s.pdws);
  const entries = pdws.slice(0, 4);
  const metrics = useSimulationStore(s => s.operationalMetrics);
  return <Panel className="activity-panel" delay={.23}>
    <div className="panel-heading compact activity-heading"><div><div className="eyebrow">RECENT INTERCEPTS</div><h3>Pulse descriptor stream <span className="stream-count mono">· {metrics.totalPdwCount.toLocaleString()}</span></h3></div><button className="text-action" onClick={() => onNavigate('Emitter activity')}>OPEN PDW INSPECTOR <ArrowUpRight size={13} /></button></div>
    <div className="table-head"><span>TIME OF ARRIVAL <ChevronDown size={11} /></span><span>DESCRIPTOR</span><span>CENTER FREQ.</span><span>CLASSIFICATION</span><span>AMPLITUDE</span><span>RESULT</span></div>
    {!entries.length && <div className="empty-table-state"><b>No observations yet</b><span>Start a scenario to begin spectrum monitoring.</span></div>}{entries.map((entry, i) => {
      const tone = entry.result === 'HIT' ? 'green' : entry.result === 'REVIEW' ? 'amber' : 'quiet'; const flash = tone === 'green' ? 'rgba(137,181,155,.14)' : tone === 'amber' ? 'rgba(213,165,106,.14)' : 'rgba(150,165,160,.1)'; return <motion.div layout key={entry.id} className="table-row" initial={{ opacity: 0, y: -7, backgroundColor: flash }} animate={{ opacity: 1, y: 0, backgroundColor: [flash, 'rgba(0,0,0,0)'] }} transition={{ duration: .42, delay: .12 + i * .06, ease }}>
        <Mono className="time-cell">{entry.timestamp}</Mono><Mono className="descriptor">{entry.id}</Mono><Mono>{entry.centerFrequencyGHz.toFixed(4)} <small>GHz</small></Mono><span className="classification"><span className="class-glyph">{entry.classification.includes('PULSE') ? <Signal size={12} /> : <Radio size={12} />}</span>{entry.classification}</span><div className="amp-cell"><div className="amp-track"><i style={{ width: `${entry.amplitudePercent}%` }} /></div><Mono>{entry.amplitudePercent}</Mono></div><Status tone={tone}>{entry.result}</Status>
      </motion.div>;
    })}
    <div className="activity-foot"><span><span className="small-live" /> STREAMING LIVE</span><span className="mono">{metrics.pdwUpdateRateKHz.toFixed(1)} kHz <span className="quiet">· UPDATE RATE</span></span><button onClick={() => onNavigate('Emitter activity')}>VIEW ALL INTERCEPTS <ChevronRight size={13} /></button></div>
  </Panel>;
}

function MetricRail() {
  const receivers = useSimulationStore(s => s.receivers);
  const metrics = useSimulationStore(s => s.operationalMetrics);
  const activeReceivers = receivers.filter(r => r.active).length;
  return <div className="metric-rail"><div className="metric"><div className="metric-icon"><Headphones size={15} /></div><div><span className="eyebrow">RECEIVERS</span><div className="metric-value"><Mono>{String(activeReceivers).padStart(2, '0')}</Mono><span> / {String(metrics.receiverCapacity).padStart(2, '0')} active</span></div></div><div className="metric-health">{activeReceivers} <i /> {metrics.receiverCapacity - activeReceivers}</div></div><div className="metric"><div className="metric-icon"><Crosshair size={15} /></div><div><span className="eyebrow">TRACKED EMITTERS</span><div className="metric-value"><Mono>{String(metrics.trackedEmitterCount).padStart(2, '0')}</Mono><span> in current theater</span></div></div><ArrowUpRight size={14} className="metric-trend" /></div><div className="metric"><div className="metric-icon"><Gauge size={15} /></div><div><span className="eyebrow">SCAN EFFICIENCY</span><div className="metric-value"><Mono>{metrics.scanEfficiencyPercent.toFixed(1)}<small>%</small></Mono><span> +{metrics.scanEfficiencyDeltaPercent.toFixed(1)}% this hour</span></div></div><div className="efficiency-ring">{Math.round(metrics.scanEfficiencyPercent)}</div></div></div>;
}

function IntegrityNote() {
  const constraints = useSimulationStore(s => s.receiverConstraints);
  return <div className="integrity-note"><span className="integrity-mark"><Activity size={13} /></span><div><b>Collection integrity nominal</b><span>All receivers synchronized · {constraints.retuningDelayMs}ms latency</span></div><ChevronRight size={14} /></div>;
}

function PageHeaderActions({ children }) { return <div className="page-header-actions">{children}</div>; }
function Waterfall() {
  const samples = useSimulationStore(s => s.waterfallSamples);
  const regions = useSimulationStore(s => s.waterfallRegions);
  const receiver = useSimulationStore(s => s.receiverState);
  const pdwRate = useSimulationStore(s => s.operationalMetrics.pdwUpdateRateKHz);
  const windowSeconds = useSimulationStore(s => s.timeWindowSeconds);
  const constraints = useSimulationStore(s => s.receiverConstraints);
  const setTimeWindow = useSimulationStore(s => s.setTimeWindowSeconds);
  const [zoom, setZoom] = useState(1);
  const [scrub, setScrub] = useState(92);
  const freqSpan = constraints.frequencyMaxGHz - constraints.frequencyMinGHz;
  const streaks = samples.map(sample => ({ id: sample.id, x: ((sample.relativeTimeSeconds + windowSeconds) / windowSeconds) * 960, y: ((constraints.frequencyMaxGHz - sample.frequencyGHz) / freqSpan) * 530, width: Math.max(6, (sample.durationMs / (windowSeconds * 1000)) * 960), hot: sample.amplitude >= .88, opacity: sample.amplitude, predicted: sample.isPredicted }));
  const receiverY = ((constraints.frequencyMaxGHz - receiver.currentFrequencyGHz) / freqSpan) * 530;
  const frequencyTicks = Array.from({ length: 5 }, (_, i) => (constraints.frequencyMaxGHz - (freqSpan / 4) * i).toFixed(1));
  const timeLabels = Array.from({ length: 6 }, (_, i) => i === 5 ? 'NOW' : `−${Math.floor((windowSeconds / 60) * (1 - i / 5))}:00`);
  return <div className="waterfall-panel panel">
    <div className="waterfall-toolbar"><div><span className="eyebrow"><span className="small-live" /> WATERFALL · {receiver.id}</span><span className="wf-subtitle">{freqSpan.toFixed(0)} GHz span <i>·</i> {pdwRate.toFixed(1)} kHz sample rate</span></div><div className="wf-actions"><Status live>LIVE CAPTURE</Status><button className="wf-control" aria-label="Zoom out" onClick={() => setZoom(value => Math.max(.5, +(value - .25).toFixed(2)))}>−</button><button className="wf-control" onClick={() => setZoom(1)} title="Reset zoom">{Math.round(zoom * 100)}%</button><button className="wf-control" aria-label="Zoom in" onClick={() => setZoom(value => Math.min(3, +(value + .25).toFixed(2)))}>+</button><button className="wf-control" aria-label="Toggle waterfall fullscreen" onClick={event => { const panel = event.currentTarget.closest(".waterfall-panel"); if (!document.fullscreenElement) void panel?.requestFullscreen?.(); else void document.exitFullscreen?.(); }}><Maximize2 size={13}/></button></div></div>
    <div className="waterfall-chart"><div className="wf-y-labels">{frequencyTicks.map(tick => <Mono key={tick}>{tick}</Mono>)}<span>GHz</span></div><div className="wf-plot" style={{ "--waterfall-zoom": zoom }}>{regions.map(region => <div key={region.id} className={`wf-predicted ${region.styleClass}`} style={{ top: `${region.topPercent}%`, height: `${region.heightPercent}%` }}>{region.label && <span>{region.label}</span>}</div>)}<svg viewBox="0 0 1000 530" preserveAspectRatio="none" role="img" aria-label="Live RF waterfall showing signal energy over time and frequency">
      <defs><linearGradient id="signalFade" x1="0" x2="1"><stop offset="0" stopColor="#3c8d85" stopOpacity=".15" /><stop offset=".55" stopColor="#73c9bc" stopOpacity=".78" /><stop offset="1" stopColor="#d8f5e9" stopOpacity=".95" /></linearGradient><linearGradient id="hotStreak" x1="0" x2="1"><stop offset="0" stopColor="#66b9ad" stopOpacity=".35" /><stop offset=".7" stopColor="#b8e9db" /><stop offset="1" stopColor="#fff" /></linearGradient></defs>
      {[0, 1, 2, 3, 4].map(i => <line key={`h${i}`} x1="0" x2="1000" y1={26 + i * 119} y2={26 + i * 119} stroke="rgba(210,230,225,.11)" strokeDasharray="2 5" />)}
      {[0, 1, 2, 3, 4, 5, 6, 7].map(i => <line key={`v${i}`} y1="0" y2="530" x1={i * 143} x2={i * 143} stroke="rgba(210,230,225,.055)" />)}
      {streaks.filter(s => !s.predicted).map(s => <g key={s.id}><rect x={s.x} y={s.y} width={s.width} height={s.hot ? 2.5 : 1.5} rx="1" fill={s.hot ? 'url(#hotStreak)' : 'url(#signalFade)'} opacity={s.hot ? .98 : s.opacity} /><rect x={s.x + s.width * .25} y={s.y - 2} width={s.width * .42} height="6" rx="3" fill={s.hot ? '#70cfc1' : '#54a49a'} opacity={s.hot ? .12 : .045} /></g>)}
      <line className="receiver-sweep" x1="0" x2="1000" y1={receiverY} y2={receiverY} stroke="#d5a56a" strokeWidth="1" strokeDasharray="7 5" /><circle cx="746" cy={receiverY} r="3" fill="#e4b979" /><circle cx="746" cy={receiverY} r="8" fill="#d5a56a" opacity=".12" />
      <rect x="0" y="0" width="1000" height="530" fill="url(#signalFade)" opacity=".025" />
    </svg><div className="wf-x-labels">{timeLabels.map((label, i) => <Mono key={i}>{label}</Mono>)}</div><span className="wf-x-title">TIME ← HISTORICAL CAPTURE · MOST RECENT →</span></div></div>
    <div className="waterfall-bottom"><div className="wf-legend"><span><i className="legend-low" />LOW ENERGY</span><span><i className="legend-mid" />MODERATE</span><span><i className="legend-high" />HIGH ENERGY</span><span><i className="legend-predicted" />PREDICTED WINDOW</span><span><i className="legend-receiver" />{receiver.id} TUNE</span></div><div className="time-scrubber"><button onClick={() => setTimeWindow(Math.max(60, windowSeconds - 60))} aria-label="Decrease time window">{Math.floor(windowSeconds / 60)}m</button><input type="range" min="0" max="100" value={scrub} onChange={event => setScrub(Number(event.target.value))} aria-label="Time window scrubber" title={`Capture position ${scrub}%`} /><button onClick={() => setTimeWindow(Math.min(3600, windowSeconds + 60))}>+ 1m</button></div></div>
  </div>;
}

function LiveSpectrumPage() {
  const receiver = useSimulationStore(s => s.receiverState);
  const constraints = useSimulationStore(s => s.receiverConstraints);
  return <div className="live-spectrum-layout"><Waterfall /><aside className="live-inspector"><Observation /><Recommendation /><Panel className="receiver-readout"><div className="eyebrow">RECEIVER POSITION</div><div className="receiver-readout-main"><Mono>{receiver.currentFrequencyGHz.toFixed(3)}</Mono><span>GHz</span><Status tone={receiver.isRetuning ? 'amber' : 'teal'}>{receiver.isRetuning ? 'RETUNING' : receiver.mode}</Status></div><div className="receiver-position-track"><i /></div><div className="receiver-range"><Mono>{constraints.frequencyMinGHz.toFixed(2)} GHz</Mono><Mono>{constraints.frequencyMaxGHz.toFixed(2)} GHz</Mono></div></Panel></aside></div>;
}

function ScanStrategyPage() {
  const rows = useSimulationStore(s => s.bandBeliefs);
  const constraints = useSimulationStore(s => s.receiverConstraints);
  const scanPolicy = constraints.optimizationPolicy;
  const receivers = useSimulationStore(s => s.receivers);
  const slots = useSimulationStore(s => s.scanSchedule);
  const latestDecision = useSimulationStore(s => s.scanDecisions[0]);
  const windowTicks = Array.from({ length: 6 }, (_, i) => i === 0 ? 'NOW' : `${(constraints.scanWindowSeconds / 5 * i).toFixed(0)}s`);
  const constraintRows = [['BANDWIDTH', `${constraints.bandwidthMHz} MHz`], ['DWELL LIMIT', `≤ ${constraints.dwellLimitMs} ms`], ['RETUNE DELAY', `${constraints.retuningDelayMs} ms`], ['SCAN BUDGET', `${constraints.scanBudgetSeconds.toFixed(1)} s / ${constraints.scanWindowSeconds} s`], ['RECEIVERS', `${String(receivers.filter(r => r.active).length).padStart(2, '0')} AVAILABLE`]];
  return <div className="planning-page"><div className="constraint-strip">{constraintRows.map(([label, value]) => <div key={label}><span className="eyebrow">{label}</span><Mono>{value}</Mono></div>)}</div>
    <Panel className="queue-panel"><div className="panel-heading compact"><div><div className="eyebrow">PRIORITY QUEUE · {String(rows.length).padStart(2, '0')} TARGETS</div><h3>Planned observations</h3></div><PageHeaderActions><button className="subtle-button" onClick={() => window.dispatchEvent(new CustomEvent("aegis-toast", { detail: "Queue is ordered by current observation value." }))}>REORDER QUEUE <SlidersHorizontal size={13} /></button><button className="button-secondary queue-run" onClick={() => { const source = useSimulationStore.getState().dataSource; if (source === "LIVE") void startScenario().catch(error => window.dispatchEvent(new CustomEvent("aegis-toast", { detail: error.message }))); else useSimulationStore.getState().startSimulation(); }}>COMMIT PLAN <ChevronRight size={14} /></button></PageHeaderActions></div>
      <div className="queue-head"><span>RANK</span><span>FREQUENCY BAND</span><span>ACTIVITY</span><span>UNCERTAINTY</span><span>OBSERVATION VALUE</span><span>DWELL</span><span>STATE</span></div>
      {rows.map((row, i) => <div key={row.bandId} className={`queue-row ${row.queueStatus === 'NEXT' ? 'queue-next' : ''}`}><Mono className="queue-rank">{String(row.rank).padStart(2, '0')}</Mono><div className="queue-band"><b>{row.band}</b><Mono>{row.frequencyStartGHz.toFixed(2)}–{row.frequencyEndGHz.toFixed(2)} GHz</Mono></div><div className="queue-percent"><div className="mini-track"><i style={{ width: `${row.activityPercent}%` }} /></div><Mono>{row.activityPercent}%</Mono></div><Mono className="uncertainty">{row.uncertaintyPercent}%</Mono><div className="value-cell"><div className="value-track"><i style={{ width: `${row.observationValue}%` }} /></div><Mono>{row.observationValue}</Mono></div><Mono className="dwell-cell">{row.dwellMs} ms</Mono><Status tone={row.queueStatus === 'NEXT' ? 'teal' : 'quiet'}>{row.queueStatus}</Status></div>)}
      <div className="queue-foot"><span>POLICY <b>{scanPolicy}</b></span><span>QUEUE LAST OPTIMIZED <Mono>{latestDecision?.timestamp ? `${latestDecision.timestamp}Z` : 'NO DECISION'}</Mono></span></div>
    </Panel>
    <Panel className="schedule-panel"><div className="panel-heading compact"><div><div className="eyebrow">EXECUTION WINDOW · NEXT {constraints.scanWindowSeconds} SECONDS</div><h3>Scan schedule</h3></div><Mono className="schedule-total">{constraints.scanBudgetSeconds.toFixed(1)}s SCHEDULED / {(constraints.scanWindowSeconds - constraints.scanBudgetSeconds).toFixed(1)}s BUFFER</Mono></div><div className="schedule-ruler">{windowTicks.map(t => <span key={t}>{t}</span>)}</div><div className="schedule-track"><span className="schedule-now" />{slots.map((s, i) => <div key={`${s.receiverId}-${i}`} className={`schedule-slot ${s.type === 'RETUNE' ? 'amber' : s.type === 'SECONDARY' ? 'blue' : 'teal'}`} style={{ left: `${s.offsetPercent}%`, width: `${s.widthPercent}%` }}><b>{s.label}</b><small>{s.durationMs}ms</small></div>)}</div><div className="schedule-legend"><span><i className="teal" />RECEIVE DWELL</span><span><i className="amber" />RETUNE</span><span><i className="blue" />SECONDARY RECEIVER</span></div></Panel>
  </div>;
}

function Sparkline({ values, color = '#75c9bf' }) { const safeValues = values.length ? values : [0]; const points = safeValues.map((v, i) => `${(i / (safeValues.length - 1 || 1)) * 100},${36 - v * .34}`).join(' '); return <svg className="sparkline" viewBox="0 0 100 40" preserveAspectRatio="none"><polyline points={points} fill="none" stroke={color} strokeWidth="1.8" vectorEffect="non-scaling-stroke" /><circle cx="100" cy={36 - safeValues.at(-1) * .34} r="2.2" fill={color} /></svg>; }

function pdwTimeMs(timestamp) { const match = timestamp.match(/(\d+):(\d+):(\d+)\.(\d+)/); return match ? (((Number(match[1]) * 60 + Number(match[2])) * 60 + Number(match[3])) * 1000 + Number(match[4])) : 0; }
function angleDistance(left, right) { const distance = Math.abs(left - right); return Math.min(distance, 360 - distance); }
function classifyCluster(observations, intervals, frequencyRange) {
  if (observations.length <= 2) return 'Newly Observed';
  const meanInterval = intervals.length ? intervals.reduce((sum, value) => sum + value, 0) / intervals.length : 0;
  const intervalVariance = intervals.length ? intervals.reduce((sum, value) => sum + (value - meanInterval) ** 2, 0) / intervals.length : 0;
  const intervalCv = meanInterval ? Math.sqrt(intervalVariance) / meanInterval : 1;
  const frequencies = observations.map(observation => observation.centerFrequencyGHz);
  const trend = frequencies.at(-1) - frequencies[0];
  if (frequencyRange > .05 && Math.abs(trend) > .02) return 'Changing';
  if (frequencyRange > .05) return 'Frequency Agile';
  if (intervalCv < .22 && intervals.length >= 3) return 'Periodic';
  if (intervalCv > .55) return 'Intermittent';
  return 'Stable';
}
function deriveObservedClusters(pdws) {
  const clusters = [];
  [...pdws].reverse().forEach(pdw => {
    const match = clusters.find(cluster => Math.abs(cluster.lastFrequency - pdw.centerFrequencyGHz) <= .15 && angleDistance(cluster.lastAoa, pdw.aoaDeg ?? 0) <= 25);
    if (match) { match.observations.push(pdw); match.lastFrequency = pdw.centerFrequencyGHz; match.lastAoa = pdw.aoaDeg ?? 0; }
    else clusters.push({ observations: [pdw], lastFrequency: pdw.centerFrequencyGHz, lastAoa: pdw.aoaDeg ?? 0 });
  });
  return clusters.map((cluster, index) => {
    const observations = cluster.observations;
    const ordered = [...observations].sort((left, right) => pdwTimeMs(left.timestamp) - pdwTimeMs(right.timestamp));
    const times = ordered.map(observation => pdwTimeMs(observation.timestamp));
    const intervals = times.slice(1).map((time, intervalIndex) => time - times[intervalIndex]);
    const frequencies = observations.map(observation => observation.centerFrequencyGHz);
    const frequencyRange = Math.max(...frequencies) - Math.min(...frequencies);
    const first = observations[0];
    return {
      id: `Scenario Emitter ${String(index + 1).padStart(2, '0')}`,
      observations,
      firstSeen: first.timestamp,
      centerFrequencyGHz: frequencies.reduce((sum, value) => sum + value, 0) / frequencies.length,
      frequencyMinGHz: Math.min(...frequencies),
      frequencyMaxGHz: Math.max(...frequencies),
      aoaDeg: observations.reduce((sum, observation) => sum + (observation.aoaDeg ?? 0), 0) / observations.length,
      estimatedPriMs: intervals.length ? intervals.reduce((sum, value) => sum + value, 0) / intervals.length : first.priMs,
      activityPercent: Math.min(100, observations.length * 12),
      patternType: classifyCluster(ordered, intervals, frequencyRange),
      statusTone: observations.length >= 4 ? 'teal' : 'amber',
      frequencyHistoryGHz: ordered.map(observation => observation.centerFrequencyGHz),
      activityHistory: ordered.map((_, observationIndex) => Math.min(100, (observationIndex + 1) * 12)),
      trace: ordered.map((observation, observationIndex) => ({ t: (pdwTimeMs(observation.timestamp) - times[0]) / 1000, freq: observation.centerFrequencyGHz, strength: observation.amplitudePercent })),
    };
  });
}

function EmitterActivityPage({ selectedEmitter, setSelectedEmitter }) {
  const pdws = useSimulationStore(s => s.pdwHistory);
  const metrics = useSimulationStore(s => s.operationalMetrics);
  const clusters = deriveObservedClusters(pdws);
  const selected = clusters.find(cluster => cluster.id === selectedEmitter) || clusters[0];
  const [filter, setFilter] = useState({ search: '', frequencyMin: '', frequencyMax: '', toaFrom: '', toaTo: '', aoaMin: '', aoaMax: '', amplitudeMin: '', amplitudeMax: '' });
  const [page, setPage] = useState(1);
  const filteredPdws = pdws.filter(pdw => (!filter.search || `${pdw.id} ${pdw.scenarioLabel || ''} ${pdw.classification}`.toLowerCase().includes(filter.search.toLowerCase())) && (!filter.frequencyMin || pdw.centerFrequencyGHz >= Number(filter.frequencyMin)) && (!filter.frequencyMax || pdw.centerFrequencyGHz <= Number(filter.frequencyMax)) && (!filter.toaFrom || pdw.timestamp >= filter.toaFrom) && (!filter.toaTo || pdw.timestamp <= filter.toaTo) && (!filter.aoaMin || (pdw.aoaDeg ?? 0) >= Number(filter.aoaMin)) && (!filter.aoaMax || (pdw.aoaDeg ?? 0) <= Number(filter.aoaMax)) && (!filter.amplitudeMin || pdw.amplitudeDbm >= Number(filter.amplitudeMin)) && (!filter.amplitudeMax || pdw.amplitudeDbm <= Number(filter.amplitudeMax)));
  const pageSize = 8;
  const pageCount = Math.max(1, Math.ceil(filteredPdws.length / pageSize));
  const pageRows = filteredPdws.slice((page - 1) * pageSize, page * pageSize);
  const updateFilter = (key, value) => { setPage(1); setFilter(current => ({ ...current, [key]: value })); };
  return <div className="emitter-page"><div className="emitter-summary"><div className="eyebrow">DERIVED CLUSTERS <b>{clusters.length}</b></div><div className="eyebrow">OBSERVED PDWS <b className="accent-green">{pdws.length}</b></div><div className="eyebrow">MATCHED TRACKS <b className="accent-amber">{metrics.trackedEmitterCount}</b></div></div>
    <div className="emitter-card-grid">{clusters.map(cluster => <button key={cluster.id} className={`emitter-card panel ${selected?.id === cluster.id ? 'emitter-card-selected' : ''}`} onClick={() => setSelectedEmitter(cluster.id)}><div className="emitter-card-top"><span className="emitter-icon"><Antenna size={15} /></span><Status tone={cluster.statusTone}>{cluster.patternType}</Status></div><div className="emitter-card-name"><b>{cluster.id}</b><span>{cluster.observations.length} observations</span></div><Sparkline values={cluster.activityHistory} color={cluster.statusTone === 'amber' ? '#d5a56a' : '#75c9bf'} /><div className="emitter-card-bottom"><span className="eyebrow">FREQUENCY RANGE</span><Mono>{cluster.frequencyMinGHz.toFixed(3)}–{cluster.frequencyMaxGHz.toFixed(3)} GHz</Mono><span className="eyebrow">EST. PRI</span><Mono>{cluster.estimatedPriMs.toFixed(0)} ms</Mono></div></button>)}</div>
    {selected ? <div className="emitter-analysis-grid"><Panel className="emitter-chart-panel"><div className="panel-heading compact"><div><div className="eyebrow">DERIVED TRACK · {selected.id}</div><h3>Frequency drift by time</h3></div><Status tone={selected.statusTone}>{selected.patternType}</Status></div><div className="chart-wrap"><Suspense fallback={<div className="chart-loading">LOADING SESSION TRACE…</div>}><DataChart kind="emitter" data={selected.trace} /></Suspense></div><div className="activity-timeline"><div><span className="eyebrow">PRI-LIKE ACTIVITY TIMELINE</span><Mono>{selected.estimatedPriMs.toFixed(0)} ms MEAN INTER-ARRIVAL</Mono></div><Sparkline values={selected.activityHistory} color="#d5a56a" /></div></Panel>
      <Panel className="pdw-panel"><div className="panel-heading compact"><div><div className="eyebrow">PDW INSPECTOR · {filteredPdws.length} MATCHES</div><h3>Observed pulse descriptors</h3></div><Mono>{page}/{pageCount}</Mono></div><div className="pdw-filter-grid"><input placeholder="Scenario / classification / ID" value={filter.search} onChange={event => updateFilter('search', event.target.value)} /><input placeholder="Freq min GHz" type="number" value={filter.frequencyMin} onChange={event => updateFilter('frequencyMin', event.target.value)} /><input placeholder="Freq max GHz" type="number" value={filter.frequencyMax} onChange={event => updateFilter('frequencyMax', event.target.value)} /><input placeholder="ToA from HH:MM:SS.mmm" value={filter.toaFrom} onChange={event => updateFilter('toaFrom', event.target.value)} /><input placeholder="ToA to HH:MM:SS.mmm" value={filter.toaTo} onChange={event => updateFilter('toaTo', event.target.value)} /><input placeholder="AoA min deg" type="number" value={filter.aoaMin} onChange={event => updateFilter('aoaMin', event.target.value)} /><input placeholder="AoA max deg" type="number" value={filter.aoaMax} onChange={event => updateFilter('aoaMax', event.target.value)} /><input placeholder="Amplitude min dBm" type="number" value={filter.amplitudeMin} onChange={event => updateFilter('amplitudeMin', event.target.value)} /><input placeholder="Amplitude max dBm" type="number" value={filter.amplitudeMax} onChange={event => updateFilter('amplitudeMax', event.target.value)} /></div><div className="table-head pdw-head"><span>TOA</span><span>FREQUENCY / AOA</span><span>AMPLITUDE</span><span>RESULT</span></div>{pageRows.map(pdw => <div className="pdw-row" key={pdw.id}><Mono>{pdw.timestamp}</Mono><Mono>{pdw.centerFrequencyGHz.toFixed(4)} GHz / {(pdw.aoaDeg ?? 0).toFixed(0)}°</Mono><Mono>{pdw.amplitudeDbm.toFixed(1)} dBm</Mono><Status tone={pdw.result === 'HIT' ? 'green' : pdw.result === 'MISS' ? 'quiet' : 'amber'}>{pdw.result}</Status></div>)}<div className="pdw-pagination"><button className="subtle-button" disabled={page <= 1} onClick={() => setPage(current => current - 1)}>PREVIOUS</button><Mono>{filteredPdws.length ? `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, filteredPdws.length)}` : '0'} / {filteredPdws.length}</Mono><button className="subtle-button" disabled={page >= pageCount} onClick={() => setPage(current => current + 1)}>NEXT</button></div></Panel></div> : <Panel className="empty-panel"><h3>Awaiting observed PDWs</h3><p>Start a scenario to build derived emitter clusters and populate the inspector.</p></Panel>}
  </div>;
}

function MiniSpectrum({ bursts }) { return <svg viewBox="0 0 160 52" className="mini-spectrum"><path d="M0 43H160M0 27H160M0 10H160" stroke="rgba(200,220,214,.1)" strokeDasharray="2 4" />{bursts.map((burst, i) => <rect key={i} x={burst.x} y={burst.y} width={burst.width} height="2" rx="1" fill={burst.tone === 'amber' ? '#d5a56a' : '#75c9bf'} opacity={burst.opacity} />)}</svg>; }
function ScenarioLabPage() {
  const scenarios = useSimulationStore(s => s.scenarios);
  const config = useSimulationStore(s => s.scenarioConfig);
  const updateConfig = useSimulationStore(s => s.setScenarioConfig);
  const resetSimulation = useSimulationStore(s => s.resetSimulation);
  const startSimulation = useSimulationStore(s => s.startSimulation);
  const simulationStatus = useSimulationStore(s => s.simulationStatus);
  const dataSource = useSimulationStore(s => s.dataSource);
  const selected = scenarios.find(s => s.id === config.scenarioId) || scenarios[0];
  const selectScenario = (scenario) => updateConfig({ scenarioId: scenario.id, emitterCount: scenario.defaultEmitterCount, durationSeconds: scenario.defaultDurationSeconds, seed: scenario.defaultSeed });
  const syncLiveState = async () => { const state = await startScenario(); useSimulationStore.getState().applyBackendDelta({ type: 'full_state', version: 1, ...state }); };
  const loadScenario = () => { if (dataSource === 'LIVE') void loadBackendScenario(config).then(getSimulationState).then(state => useSimulationStore.getState().applyBackendDelta({ type: 'full_state', version: 1, ...state })).catch(error => window.dispatchEvent(new CustomEvent('aegis-toast', { detail: error.message }))); else resetSimulation(false); };
  const startDemo = () => { if (dataSource === 'LIVE') { window.dispatchEvent(new CustomEvent('aegis-toast', { detail: 'Live mode replays the recorded TSRD pulse train. Use Start Dataset Replay.' })); return; } const demo = scenarios.find(scenario => scenario.id === 'adaptive-multi-emitter') || scenarios[0]; const demoConfig = { scenarioId: demo.id, emitterCount: demo.defaultEmitterCount, durationSeconds: demo.defaultDurationSeconds, seed: demo.defaultSeed }; selectScenario(demo); startSimulation(demoConfig); };
  return <div className="scenario-layout"><div className="scenario-main"><div className="scenario-intro"><div><div className="eyebrow">SIMULATION ENVIRONMENTS</div><h3>Select a scenario to configure</h3><p>{dataSource === 'LIVE' ? 'Replay the recorded TSRD pulse train as a paced live stream. No hardware receiver is connected.' : simulationStatus === 'IDLE' ? 'No active RF scenario. Start a scenario to begin spectrum monitoring.' : 'Choose a synthetic RF environment, then tune its emitter population and run conditions.'}</p></div><Status tone={simulationStatus === 'RUNNING' ? 'green' : simulationStatus === 'PAUSED' ? 'amber' : 'quiet'}>{simulationStatus === 'RUNNING' ? 'LIVE DATA' : simulationStatus === 'PAUSED' ? 'SIMULATION PAUSED' : 'NO LIVE DATA'}</Status></div><div className="scenario-grid">{scenarios.map((scenario, i) => <button className={`scenario-card panel ${selected.id === scenario.id ? 'scenario-selected' : ''}`} key={scenario.id} onClick={() => selectScenario(scenario)}><MiniSpectrum bursts={scenario.previewBursts} /><div className="scenario-card-meta"><span className="eyebrow">SCENARIO {String(i + 1).padStart(2, '0')}</span><span className="scenario-check">{selected.id === scenario.id ? 'SELECTED' : 'SELECT'}</span></div><b>{scenario.name}</b><span className="scenario-desc">{scenario.description}</span></button>)}</div></div>
    <aside className="scenario-config panel"><div className="eyebrow">SCENARIO CONFIGURATION</div><h3>Run parameters</h3><div className="config-selected"><span className="eyebrow">SELECTED ENVIRONMENT</span><b>{selected.name}</b></div>{dataSource === 'LIVE' ? <div className="dataset-note"><span className="eyebrow">SOURCE</span><b>TSRD recorded pulse descriptor dataset</b><small>Original pulse timing and measured fields are replayed at 2 updates per second.</small></div> : <><label className="config-control"><span>Emitter count <Mono>{config.emitterCount}</Mono></span><input type="range" min="1" max="24" value={config.emitterCount} onChange={e => updateConfig({ emitterCount: Number(e.target.value) })} /><small>1 <i /> 24 emitters</small></label><label className="config-control"><span>Duration <Mono>{config.durationSeconds} s</Mono></span><input type="range" min="60" max="900" step="30" value={config.durationSeconds} onChange={e => updateConfig({ durationSeconds: Number(e.target.value) })} /><small>1 min <i /> 15 min</small></label><label className="config-control seed-control"><span>Random seed</span><input type="number" value={config.seed} onChange={e => updateConfig({ seed: Number(e.target.value) })} /></label></>}<div className="config-foot"><span className="eyebrow">EST. RUN TIME</span><Mono>~{Math.max(8, Math.round(config.durationSeconds / 22))} SEC</Mono></div><div className="scenario-actions"><button className="subtle-button" onClick={loadScenario}>LOAD SCENARIO</button><button className="button-primary run-scenario" onClick={() => { if (dataSource === 'LIVE') void syncLiveState().catch(error => window.dispatchEvent(new CustomEvent('aegis-toast', { detail: error.message }))); else startSimulation(config); }}>{dataSource === 'LIVE' ? 'START DATASET REPLAY' : 'START SIMULATION'} <ChevronRight size={14} /></button><button className="subtle-button" onClick={() => { if (dataSource === 'LIVE') void resetScenario().catch(console.error); else resetSimulation(false); }}>RESET</button>{dataSource === 'OFFLINE' && <button className="text-action" onClick={startDemo}>START DEMO <ChevronRight size={13} /></button>}</div></aside>
  </div>;
}

function DecisionHistoryPage() {
  const [expanded, setExpanded] = useState(null);
  const decisions = useSimulationStore(s => s.decisionHistory);
  const rewards = useSimulationStore(s => s.decisionRewardTrace);
  const metrics = useSimulationStore(s => s.operationalMetrics);
  const source = useSimulationStore(s => s.dataSource);
  const [filterOpen, setFilterOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [resultFilter, setResultFilter] = useState('');
  const [bandFilter, setBandFilter] = useState('');
  const [page, setPage] = useState(0);
  const [remote, setRemote] = useState({ items: [], total: 0 });
  const [historyError, setHistoryError] = useState('');
  useEffect(() => {
    if (source !== 'LIVE') return;
    let cancelled = false;
    let timer;
    const refresh = () => getHistory({ limit: 50, offset: page * 50, result: resultFilter || undefined, band: bandFilter || undefined }).then(data => { if (!cancelled) { setRemote(data); setHistoryError(''); } }).catch(error => { if (!cancelled) setHistoryError(error.message); });
    refresh(); timer = window.setInterval(refresh, 5000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [source, page, resultFilter, bandFilter]);
  const visibleDecisions = source === 'LIVE' ? remote.items : decisions.filter(d => (!resultFilter || d.result === resultFilter) && (!bandFilter || d.band.toLowerCase().includes(bandFilter.toLowerCase()))).slice(page * 50, page * 50 + 50);
  const total = source === 'LIVE' ? remote.total : decisions.filter(d => (!resultFilter || d.result === resultFilter) && (!bandFilter || d.band.toLowerCase().includes(bandFilter.toLowerCase()))).length;
  const doExport = async format => { try { const blob = source === 'LIVE' ? await exportHistory(format, { result: resultFilter || undefined, band: bandFilter || undefined }) : new Blob([format === 'json' ? JSON.stringify(visibleDecisions, null, 2) : [Object.keys(visibleDecisions[0] || {}).join(','), ...visibleDecisions.map(row => Object.values(row).join(','))].join('\n')], { type: format === 'json' ? 'application/json' : 'text/csv' }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `aegis-decision-history.${format}`; link.click(); URL.revokeObjectURL(url); setExportOpen(false); } catch (error) { setHistoryError(error.message); } };
  return <div className="history-page"><Panel className="reward-strip"><div className="reward-strip-label"><div className="eyebrow">REWARD / OUTCOME TRACE</div><div><Mono>+{metrics.meanReward.toFixed(2)}</Mono><span>MEAN REWARD · LAST 60 DECISIONS</span></div></div><Sparkline values={rewards} color="#89b59b" /><div className="reward-strip-stat"><span className="eyebrow">HIT RATE</span><Mono>{metrics.hitRatePercent.toFixed(1)}%</Mono></div><div className="reward-strip-stat"><span className="eyebrow">POLICY VERSION</span><Mono>{metrics.policyVersion}</Mono></div></Panel>
    <Panel className="history-table-panel"><div className="panel-heading compact"><div><div className="eyebrow">DECISION LOG · {source === 'LIVE' ? remote.total : metrics.decisionCount.toLocaleString()} TOTAL</div><h3>Recent policy actions</h3></div><PageHeaderActions><button className="subtle-button" onClick={() => setFilterOpen(open => !open)}>FILTER <ChevronDown size={12} /></button><button className="subtle-button" onClick={() => setExportOpen(open => !open)}>EXPORT <ArrowDownRight size={12} /></button>{exportOpen && <div className="history-export-menu"><button onClick={() => void doExport('csv')}>DOWNLOAD CSV</button><button onClick={() => void doExport('json')}>DOWNLOAD JSON</button></div>}</PageHeaderActions></div>
      {filterOpen && <div className="history-filter-controls"><label>RESULT<select value={resultFilter} onChange={event => { setPage(0); setResultFilter(event.target.value); }}><option value="">ALL</option><option value="HIT">HIT</option><option value="MISS">MISS</option></select></label><label>BAND<input value={bandFilter} onChange={event => { setPage(0); setBandFilter(event.target.value); }} placeholder="Filter by band" /></label><button className="text-action" onClick={() => { setResultFilter(''); setBandFilter(''); setPage(0); }}>CLEAR</button></div>}
      {historyError && <div className="empty-table-state"><b>History query failed</b><span>{historyError}</span></div>}
      <div className="history-head"><span>DECISION / TIME</span><span>POLICY ACTION</span><span>TARGET BAND</span><span>OUTCOME REWARD</span><span>STATE</span></div>{!visibleDecisions.length && <div className="empty-table-state"><b>No decisions found</b><span>{source === 'LIVE' ? 'Run a live scenario to build persisted history.' : 'No decisions match these filters.'}</span></div>}{visibleDecisions.map(d => <React.Fragment key={d.id}><button className={`history-row ${expanded === d.id ? 'expanded' : ''}`} onClick={() => setExpanded(expanded === d.id ? null : d.id)}><span><Mono>{d.id}</Mono><small>{d.timestamp}Z</small></span><b>{d.action}</b><Mono>{d.band}</Mono><Status tone={d.result === 'HIT' ? 'green' : 'amber'}>{d.result} · {d.reward >= 0 ? '+' : ''}{d.reward.toFixed(2)}</Status><ChevronDown size={14} /></button><AnimatePresence>{expanded === d.id && <motion.div className="decision-drawer" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: .28, ease }}><div><span className="eyebrow">BELIEF SNAPSHOT</span><p>{(d.predictedActivity * 100).toFixed(1)}% predicted activity · {(d.uncertainty * 100).toFixed(1)}% uncertainty · {d.dwellMs} ms dwell</p></div><div><span className="eyebrow">REWARD FORMULA</span><p>+{d.rewardComponents.detectionBenefit.toFixed(2)} detection −{d.rewardComponents.delayPenalty.toFixed(2)} delay −{d.rewardComponents.scanCost.toFixed(2)} cost −{d.rewardComponents.missPenalty.toFixed(2)} miss −{d.rewardComponents.stalenessPenalty.toFixed(2)} stale = {d.reward.toFixed(2)}</p></div><div><span className="eyebrow">OUTCOME</span><p>{d.outcome}{d.interceptionTimeMs === null ? '' : ` Interception time ${d.interceptionTimeMs} ms.`}</p></div></motion.div>}</AnimatePresence></React.Fragment>)}
      <div className="pdw-pagination"><button className="subtle-button" disabled={!page} onClick={() => setPage(value => value - 1)}>PREVIOUS</button><Mono>{total ? `${page * 50 + 1}–${Math.min((page + 1) * 50, total)} / ${total}` : '0 / 0'}</Mono><button className="subtle-button" disabled={(page + 1) * 50 >= total} onClick={() => setPage(value => value + 1)}>NEXT</button></div>
    </Panel>
  </div>;
}

function PerformancePage() {
  const performanceSeries = useSimulationStore(s => s.performanceMetrics);
  const kpis = useSimulationStore(s => s.performanceKpis);
  const baselines = useSimulationStore(s => s.performanceBaselines);
  const metrics = useSimulationStore(s => s.operationalMetrics);
  return <div className="performance-page"><div className="performance-kpis">{kpis.map(([l, v, d]) => <div className="performance-kpi" key={l}><span className="eyebrow">{l}</span><div><Mono>{v}</Mono><small>{d}</small></div></div>)}</div>
    <div className="performance-chart-grid">{performanceSeries.map(series => <Panel key={series.key} className="performance-chart-card"><div className="perf-chart-head"><span className="eyebrow">{series.title}</span><button className="chart-menu" aria-label={`Export ${series.title} chart data`} title="Download chart data as CSV" onClick={() => { const csv = `metric,value\n${series.title},${series.values.join(";")}`; const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); link.download = `${series.key}-metrics.csv`; link.click(); URL.revokeObjectURL(link.href); }}>···</button></div><div className="perf-chart-value"><Mono>{series.values.at(-1)}{series.unit}</Mono><span>LAST 60 MIN</span></div><div className="perf-chart"><Suspense fallback={<div className="chart-loading">LOADING METRICS…</div>}><DataChart kind="area" data={series} /></Suspense></div></Panel>)}</div>
    <Panel className="benchmark-panel"><div className="panel-heading compact"><div><div className="eyebrow">BENCHMARK COMPARISON</div><h3>Policy performance by baseline</h3></div><span className="eyebrow">EVALUATION SET · N={metrics.evaluationSetSize.toLocaleString()}</span></div><div className="benchmark-head"><span>POLICY</span><span>DETECTION</span><span>MEDIAN TOI</span><span>COVERAGE</span><span>REWARD</span><span>STATUS</span></div>{baselines.map((r, i) => <div className="benchmark-row" key={r[0]} title={i === baselines.length - 1 ? 'Current live run' : 'Illustrative baseline'}>{r.map((c, j) => <span key={j}>{j === 0 ? <b>{c}</b> : j === 5 ? <Status tone={i === baselines.length - 1 ? 'green' : 'quiet'}>{c}</Status> : <Mono>{c}</Mono>}</span>)}</div>)}</Panel>
  </div>;
}

function ResearchModePage() {
  const [tab, setTab] = useState('Scheduler State');
  const [showGroundTruthOverlay, setShowGroundTruthOverlay] = useState(false);
  const [selectedBandId, setSelectedBandId] = useState('');
  const [authRole, setAuthRole] = useState(getAuthSession()?.role ?? null);
  const [researchMessage, setResearchMessage] = useState('');
  const [liveGroundTruth, setLiveGroundTruth] = useState(null);
  const snapshot = useSimulationStore(s => s.researchSnapshot);
  const currentTime = useSimulationStore(s => s.currentSimulationTime);
  const operational = useSimulationStore(s => s.operationalMetrics);
  const bands = useSimulationStore(s => s.bandBeliefs);
  const recommendation = useSimulationStore(s => s.currentRecommendation);
  const latestDecision = useSimulationStore(s => s.decisionHistory[0]);
  const baselines = useSimulationStore(s => s.performanceBaselines);
  const scenarioConfig = useSimulationStore(s => s.scenarioConfig);
  const scenarios = useSimulationStore(s => s.scenarios);
  const constraints = useSimulationStore(s => s.receiverConstraints);
  const pdws = useSimulationStore(s => s.pdwHistory);
  const truth = useSimulationStore(s => s.groundTruthEmitters);
  const source = useSimulationStore(s => s.dataSource);
  const runBaselines = useSimulationStore(s => s.runBaselineComparison);
  useEffect(() => { const syncAuth = () => setAuthRole(getAuthSession()?.role ?? null); window.addEventListener('aegis-auth-changed', syncAuth); return () => window.removeEventListener('aegis-auth-changed', syncAuth); }, []);
  const baselineAction = async () => { if (source !== 'LIVE') { runBaselines(); return; } try { const comparison = await runResearchBaselines(); setResearchMessage(`${comparison.disclaimer} · ${comparison.baselines.length} baselines returned.`); } catch (error) { setResearchMessage(error.message); } };
  const toggleTruthOverlay = async checked => { if (checked && source === 'LIVE') { try { const result = await getResearchGroundTruth(); setLiveGroundTruth(result.emitters); setShowGroundTruthOverlay(true); } catch (error) { setResearchMessage(error.message); setShowGroundTruthOverlay(false); } } else { setShowGroundTruthOverlay(checked); } };
  const overlayTruth = source === 'LIVE' ? (liveGroundTruth || []) : truth;
  const selectedBand = bands.find(band => band.bandId === selectedBandId) || bands.find(band => band.bandId === recommendation.bandId) || bands[0];
  const clusters = deriveObservedClusters(pdws);
  const frequencySpan = constraints.frequencyMaxGHz - constraints.frequencyMinGHz;
  const tabs = [...snapshot.tabs, 'Scenario Config'];
  const factorRows = selectedBand ? [['activityProbability', BELIEF_WEIGHTS.activityProbability * selectedBand.activityProbability], ['uncertainty', BELIEF_WEIGHTS.uncertainty * selectedBand.uncertainty], ['predictedActivityBoost', BELIEF_WEIGHTS.predictedActivityBoost * selectedBand.predictedActivityBoost], ['stalenessFactor', BELIEF_WEIGHTS.stalenessFactor * selectedBand.stalenessFactor], ['changeLevelBoost', BELIEF_WEIGHTS.changeLevelBoost * selectedBand.changeLevelBoost], ['scanCost', -BELIEF_WEIGHTS.scanCost * selectedBand.scanCost]] : [];
  const stateRows = selectedBand ? [['bandId', selectedBand.bandId], ['band', selectedBand.band], ['activityProbability', selectedBand.activityProbability.toFixed(4)], ['uncertainty', selectedBand.uncertainty.toFixed(4)], ['recentHits', String(selectedBand.recentHits)], ['recentMisses', String(selectedBand.recentMisses)], ['timeSinceLastScanMs', String(selectedBand.timeSinceLastScanMs)], ['predictedActivity', selectedBand.predictedActivity.toFixed(4)], ['changeLevel', selectedBand.changeLevel], ['coverageStatus', selectedBand.coverageStatus], ['observationValue', String(selectedBand.observationValue)]] : [];
  const rewardRows = latestDecision ? [['detectionBenefit', latestDecision.rewardComponents.detectionBenefit], ['delayPenalty', -latestDecision.rewardComponents.delayPenalty], ['scanCost', -latestDecision.rewardComponents.scanCost], ['missPenalty', -latestDecision.rewardComponents.missPenalty], ['stalenessPenalty', -latestDecision.rewardComponents.stalenessPenalty], ['total', latestDecision.reward]] : [];
  const renderTab = () => {
    if (tab === 'Scheduler State') return <Panel className="research-state-panel"><div className="research-panel-head"><div className="eyebrow">LIVE SCHEDULER STATE · {selectedBand?.bandId || 'NO BAND'}</div><Mono>TS {currentTime}.441</Mono></div><div className="research-band-select"><label>SELECT BAND<select value={selectedBand?.bandId || ''} onChange={event => setSelectedBandId(event.target.value)}>{bands.map(band => <option key={band.bandId} value={band.bandId}>{band.rank}. {band.band}</option>)}</select></label></div><div className="state-table">{stateRows.map(([key, value]) => <div key={key}><Mono className="state-key">{key}</Mono><Mono className="state-value">{value}</Mono><span className="state-type">LIVE</span></div>)}</div></Panel>;
    if (tab === 'PPO Decision') return <Panel className="research-state-panel"><div className="research-panel-head"><div className="eyebrow">POLICY / DECISION · LIVE COMPUTATION TRACE</div><Mono>{recommendation.bandId}</Mono></div><div className="research-decision-summary"><span className="eyebrow">RECOMMENDATION</span><b>{recommendation.title}</b><Mono>{recommendation.frequencyStartGHz.toFixed(3)}–{recommendation.frequencyEndGHz.toFixed(3)} GHz</Mono></div><div className="factor-list">{factorRows.map(([label, value]) => <div className="factor-row" key={label}><div><Mono>{label}</Mono><span>{value >= 0 ? '+' : ''}{value.toFixed(4)}</span></div><i style={{ width: `${Math.min(100, Math.abs(value) * 100)}%`, background: value < 0 ? '#d5a56a' : '#75c9bf' }} /></div>)}</div><div className="research-computation-foot"><span>REAL WEIGHTED SUM</span><Mono>{(factorRows.reduce((sum, [, value]) => sum + value, 0) * 100).toFixed(1)} / 100</Mono><span>STORED OBSERVATION VALUE</span><Mono>{selectedBand?.observationValue ?? 0} / 100</Mono></div></Panel>;
    if (tab === 'Reward') return <Panel className="research-state-panel"><div className="research-panel-head"><div className="eyebrow">REWARD BREAKDOWN · MOST RECENT DECISION</div><Mono>{latestDecision?.id || 'NO DECISION'}</Mono></div>{latestDecision ? <><div className="state-table">{rewardRows.map(([key, value]) => <div key={key}><Mono className="state-key">{key}</Mono><Mono className="state-value">{Number(value).toFixed(4)}</Mono><span className="state-type">{key === 'total' ? 'TOTAL' : 'TERM'}</span></div>)}</div><div className="decision-drawer reward-explanation"><div><span className="eyebrow">RESULT</span><p>{latestDecision.result} · {latestDecision.outcome}</p></div><div><span className="eyebrow">FORMULA</span><p>Detection benefit − delay − scan cost − miss − staleness = total reward.</p></div></div></> : <div className="empty-research">Complete a dwell to populate the real reward decomposition.</div>}</Panel>;
    if (tab === 'Baselines') return <Panel className="research-state-panel"><div className="research-panel-head"><div><div className="eyebrow">BASELINES · SAME LIVE SCENARIO</div><h3>Runnable alternative policies</h3></div><button className="subtle-button" onClick={baselineAction}>RUN COMPARISON</button></div><div className="research-disclosure">{researchMessage || 'Baseline comparison uses the current simulated belief state. Researcher role is required in Live Backend mode.'}</div><div className="benchmark-head"><span>POLICY</span><span>DETECTION</span><span>LATENCY</span><span>COVERAGE</span><span>REWARD</span><span>STATUS</span></div>{baselines.map(row => <div className="benchmark-row" key={row[0]} title={row[5] === 'ILLUSTRATIVE BASELINE' ? 'Illustrative baseline; not executed against this run' : 'Executed against the current live scenario'}>{row.map((value, index) => <span key={index}>{index === 0 ? <b>{value}</b> : index === 5 ? <Status tone={value === 'ILLUSTRATIVE BASELINE' ? 'quiet' : 'green'}>{value}</Status> : <Mono>{value}</Mono>}</span>)}</div>)}</Panel>;
    if (tab === 'Ablation') return <Panel className="research-state-panel"><div className="research-panel-head"><div className="eyebrow">PROTOTYPE EVALUATION · ILLUSTRATIVE</div><Mono>NOT LIVE POLICY RUNS</Mono></div><div className="research-disclosure">Prototype Evaluation — illustrative. Running five separate learned configurations is out of scope for this frontend-only prototype; these values are retained as reference presentation only.</div><div className="state-table">{[['baseline_id', 'ablation_03'], ['evaluation_n', '12,400'], ['mean_reward', '0.624'], ['std_reward', '0.118'], ['detection_rate', '0.782'], ['updated_at', '2026-09-28T04:00Z']].map(([key, value]) => <div key={key}><Mono className="state-key">{key}</Mono><Mono className="state-value">{value}</Mono><span className="state-type">ILLUSTRATIVE</span></div>)}</div></Panel>;
    return <Panel className="research-state-panel"><div className="research-panel-head"><div className="eyebrow">SCENARIO CONFIG · LIVE LOADED VALUES</div><Mono>{scenarioConfig.scenarioId}</Mono></div><div className="state-table">{[['scenario', scenarios.find(scenario => scenario.id === scenarioConfig.scenarioId)?.name || scenarioConfig.scenarioId], ['emitterCount', String(scenarioConfig.emitterCount)], ['durationSeconds', String(scenarioConfig.durationSeconds)], ['seed', String(scenarioConfig.seed)], ['frequencyMinGHz', constraints.frequencyMinGHz.toFixed(3)], ['frequencyMaxGHz', constraints.frequencyMaxGHz.toFixed(3)], ['bandwidthMHz', String(constraints.bandwidthMHz)], ['dwellUs', String(constraints.dwellUs)], ['retuningDelayUs', String(constraints.retuningDelayUs)]].map(([key, value]) => <div key={key}><Mono className="state-key">{key}</Mono><Mono className="state-value">{value}</Mono><span className="state-type">LIVE</span></div>)}</div></Panel>;
  };
  return <div className="research-page"><div className="research-warning"><Microscope size={15} /><span>RESEARCH SURFACE</span><i />OPERATOR PRESENTATION LAYER DISABLED</div><div className="research-disclosure research-disclosure-prominent">Frontend demonstration uses a simulated policy output modeled on PPO's decision structure. Production PPO model integration point is documented in System/Integration.</div>{latestDecision?.safetyOverride && <div className="inference-fallback-flag" role="status"><b>DETERMINISTIC FALLBACK ACTIVE</b><span>{latestDecision.fallbackReason || 'Trained policy inference was unavailable; the belief engine supplied this recommendation.'}</span></div>}<div className="research-tabs">{tabs.map(t => <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>{t}</button>)}</div>{renderTab()}<Panel className="research-overlay-panel"><div className="research-panel-head"><div><div className="eyebrow">INFERENCE VALIDATION · FREQUENCY / AOA</div><h3>Derived clusters and evaluation overlay</h3></div><label className="research-toggle"><input type="checkbox" checked={showGroundTruthOverlay} disabled={source === 'LIVE' && authRole !== 'RESEARCHER'} onChange={event => void toggleTruthOverlay(event.target.checked)} /><span>{source === 'LIVE' && authRole !== 'RESEARCHER' ? 'RESEARCHER SIGN-IN REQUIRED' : 'SHOW GROUND TRUTH OVERLAY'}</span></label></div><div className="overlay-legend"><span><i className="derived-mark" />DERIVED · OPERATOR VISIBLE</span><span><i className="truth-mark" />GROUND TRUTH · EVALUATION ONLY</span></div><div className="overlay-plot">{clusters.map(cluster => <div className="overlay-row" key={cluster.id}><Mono>{cluster.id}</Mono><div className="overlay-track"><i className="derived-marker" style={{ left: `${Math.max(0, Math.min(100, (cluster.centerFrequencyGHz - constraints.frequencyMinGHz) / frequencySpan * 100))}%` }} /><span>{cluster.centerFrequencyGHz.toFixed(3)} GHz · {cluster.patternType}</span>{showGroundTruthOverlay && overlayTruth.filter(emitter => emitter.active && Math.abs(emitter.currentFrequencyGHz - cluster.centerFrequencyGHz) < .25).map(emitter => <i key={emitter.emitterId} className="truth-marker" style={{ left: `${Math.max(0, Math.min(100, (emitter.currentFrequencyGHz - constraints.frequencyMinGHz) / frequencySpan * 100))}%` }} title={`${emitter.emitterId} ground truth`} />)}</div></div>)}</div></Panel></div>;
}

function WelcomeGate({ gate, setGate, name, setName, password, setPassword, onSubmit, busy, notice, setNotice, onDemo }) {
  return <main className="welcome-shell"><header className="welcome-nav"><div className="brand-mark"><Shield size={21}/></div><b>AEGIS <span>EW COMMAND</span></b><button className="subtle-button" onClick={() => { setNotice(""); setGate(gate === "login" ? "landing" : "login"); }}>{gate === "login" ? "BACK TO OVERVIEW" : "OPERATOR SIGN IN"} <ArrowRight size={14}/></button></header>
    {gate === "landing" ? <section className="welcome-hero"><div className="welcome-copy"><div className="eyebrow"><span className="small-live"/> ELECTRONIC WARFARE · DECISION SUPPORT</div><h1>See the signal.<br/><em>Choose the next move.</em></h1><p>AEGIS is a demonstrator command interface for exploring radio-frequency environments, pulse observations, emitter behavior, and adaptive scan recommendations.</p><div className="welcome-actions"><button className="button-primary" onClick={() => setGate("login")}>ENTER THE COMMAND CENTER <ArrowRight size={15}/></button><button className="button-secondary" onClick={() => onDemo("OPERATOR")}>EXPLORE OFFLINE DEMO <Play size={13}/></button></div><small className="welcome-note">Offline demo access is local to this browser session.</small></div><div className="welcome-orbit"><div className="orbit-ring orbit-a"/><div className="orbit-ring orbit-b"/><div className="orbit-core"><Radar size={44}/><span>AEGIS / RF</span></div><i className="orbit-point point-a"/><i className="orbit-point point-b"/><i className="orbit-point point-c"/><span className="orbit-label label-a">LIVE SPECTRUM</span><span className="orbit-label label-b">PDW STREAM</span><span className="orbit-label label-c">SCAN POLICY</span></div><div className="welcome-features"><article><AudioWaveform/><b>Observe</b><span>Waterfall spectrum, pulse descriptors, and emitter tracks in one operational picture.</span></article><article><SlidersHorizontal/><b>Plan</b><span>Rank scan opportunities and review the scheduler’s next recommended action.</span></article><article><Database/><b>Evaluate</b><span>Replay scripted or backend scenarios and inspect decision history and research metrics.</span></article></div><div className="welcome-disclaimer">PROTOTYPE DEMONSTRATION · Simulated and replay data only. Conceptual integration; not connected to operational sensors or a defense system.</div></section> : <section className="login-card"><div className="eyebrow">SECURE PILOT ACCESS</div><h1>Welcome back</h1><p>Sign in to a backend account or choose a local demo identity.</p><form onSubmit={onSubmit}><label>USERNAME<input required autoComplete="username" value={name} onChange={e => setName(e.target.value)} placeholder="operator or researcher"/></label><label>PASSWORD<input required autoComplete="current-password" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Backend account password"/></label><button className="button-primary" disabled={busy}>{busy ? "CONNECTING…" : "SIGN IN TO BACKEND"} <ArrowRight size={14}/></button></form><div className="login-divider"><span/> OR USE LOCAL DEMO <span/></div><div className="demo-accounts"><button className="button-secondary" onClick={() => onDemo("OPERATOR")}>OPERATOR DEMO <Play size={13}/></button><button className="button-secondary" onClick={() => onDemo("RESEARCHER")}>RESEARCH DEMO <Microscope size={13}/></button></div><small className="demo-hint">No password required · Offline Simulation only</small>{notice && <p className="gate-notice" role="status">{notice}</p>}</section>}
  </main>;
}

function ProfilePage({ session }) {
  const role = session?.role || 'OPERATOR';
  const isResearcher = role === 'RESEARCHER';
  return <div className="profile-page"><Panel className="profile-card"><div className="profile-avatar">{(session?.username || 'SK').slice(0, 2).toUpperCase()}</div><div><div className="eyebrow">SIGNED IN ACCOUNT</div><h2>{session?.username || 'Demo operator'}</h2><Status tone={isResearcher ? 'amber' : 'teal'}>{role}</Status></div></Panel><Panel className="profile-access"><div className="eyebrow">ROLE ACCESS</div><h3>{isResearcher ? 'Researcher access' : 'Operator access'}</h3><p>{isResearcher ? 'You can operate scenarios and view recommendations, plus access ground-truth overlays and baseline comparisons.' : 'You can start and stop scenarios and view operational recommendations. Research overlays and baseline comparisons require Researcher access.'}</p><div className="profile-access-grid"><div><b>Scenario control</b><Status tone="green">ENABLED</Status></div><div><b>Recommendations</b><Status tone="green">ENABLED</Status></div><div><b>Ground-truth overlays</b><Status tone={isResearcher ? 'green' : 'quiet'}>{isResearcher ? 'ENABLED' : 'RESEARCHER'}</Status></div><div><b>Baseline comparison</b><Status tone={isResearcher ? 'green' : 'quiet'}>{isResearcher ? 'ENABLED' : 'RESEARCHER'}</Status></div></div></Panel><Panel className="profile-access"><div className="eyebrow">SESSION SOURCE</div><h3>{session?.accessToken ? 'Backend authenticated' : 'Offline demo session'}</h3><p>{session?.accessToken ? 'Live Backend can replay the stored TSRD pulse descriptor dataset.' : 'Offline Simulation runs the local scripted demo. Sign in to a backend account to enable dataset replay.'}</p></Panel></div>;
}

export default function App() {
  const [active, setActive] = useState('Command center');
  const [gate, setGate] = useState('landing');
  const [notice, setNotice] = useState('');
  const [loginName, setLoginName] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [authSession, setAuthSession] = useState(getAuthSession);
  const [selectedEmitter, setSelectedEmitter] = useState('E-041');
  const seedSimulationOnce = useSimulationStore(s => s.seedSimulationOnce);
  const setMode = useSimulationStore(s => s.setMode);
  const theaterDateLabel = useSimulationStore(s => s.theaterDateLabel);
  const theaterName = useSimulationStore(s => s.theaterName);
  const timeWindowSeconds = useSimulationStore(s => s.timeWindowSeconds);
  const dataSource = useSimulationStore(s => s.dataSource);
  const applyBackendDelta = useSimulationStore(s => s.applyBackendDelta);
  const setSimulationStatus = useSimulationStore(s => s.setSimulationStatus);
  const setScenarios = useSimulationStore(s => s.setScenarios);
  const setDataSource = useSimulationStore(s => s.setDataSource);
  const setTimeWindow = useSimulationStore(s => s.setTimeWindowSeconds);
  useEffect(() => { seedSimulationOnce(); }, [seedSimulationOnce]);
  useEffect(() => { const show = event => setNotice(event.detail || ''); const authChanged = () => { const session = getAuthSession(); setAuthSession(session); if (active === 'Research mode' && session?.role !== 'RESEARCHER') setActive('Command center'); if (!session?.accessToken && useSimulationStore.getState().dataSource === 'LIVE') { void pauseScenario().catch(() => {}); setDataSource('OFFLINE'); } }; window.addEventListener('aegis-toast', show); window.addEventListener('aegis-auth-changed', authChanged); return () => { window.removeEventListener('aegis-toast', show); window.removeEventListener('aegis-auth-changed', authChanged); }; }, []);
  useEffect(() => {
    if (dataSource !== 'LIVE') return;
    let disposed = false;
    let disconnect = () => {};
    void listScenarios().then(async liveScenarios => {
      if (disposed) return;
      const replay = liveScenarios.find(scenario => scenario.id === 'tsrd-replay');
      if (!replay) throw new Error('Backend has no TSRD dataset replay scenario.');
      setScenarios([replay]);
      useSimulationStore.getState().setScenarioConfig({ scenarioId: replay.id, emitterCount: replay.defaultEmitterCount, durationSeconds: replay.defaultDurationSeconds, seed: replay.defaultSeed });
      await loadBackendScenario({ scenarioId: replay.id, emitterCount: replay.defaultEmitterCount, durationSeconds: replay.defaultDurationSeconds, seed: replay.defaultSeed });
      if (disposed) return;
      const initialState = await getSimulationState();
      if (disposed) return;
      applyBackendDelta({ type: 'full_state', version: 1, ...initialState });
      disconnect = connectStream(applyBackendDelta, connected => { if (!disposed && !connected) console.warn('Aegis live stream disconnected'); });
    }).catch(error => { console.error('Unable to initialize live backend', error); if (!disposed) { setSimulationStatus('IDLE'); window.dispatchEvent(new CustomEvent('aegis-toast', { detail: `Live dataset replay unavailable: ${error.message}` })); } });
    return () => { disposed = true; disconnect(); };
  }, [dataSource, applyBackendDelta, setScenarios, setSimulationStatus]);
  const changePage = (page) => { if (page === 'Research mode' && authSession?.role !== 'RESEARCHER') { setNotice('Research mode requires a Researcher account.'); return; } setActive(page); setMode(page === 'Research mode' ? 'RESEARCH' : 'OPERATOR'); };
  const demoAccess = role => { saveAuthSession({ accessToken: '', username: role.toLowerCase(), role }); window.dispatchEvent(new Event('aegis-auth-changed')); setDataSource('OFFLINE'); setNotice('Demo access is active in Offline Simulation. Backend controls stay locked until a backend account signs in.'); setGate('console'); };
  const signIn = async event => { event.preventDefault(); setNotice(''); const normalizedName = loginName.trim().toLowerCase(); if ((normalizedName === 'operator' && loginPassword === 'aegis-demo') || (normalizedName === 'researcher' && loginPassword === 'research-demo')) { demoAccess(normalizedName === 'researcher' ? 'RESEARCHER' : 'OPERATOR'); return; } setLoginBusy(true); try { const result = await login(loginName, loginPassword); window.dispatchEvent(new Event('aegis-auth-changed')); setDataSource('LIVE'); setGate('console'); setNotice(`${result.role} account connected to the backend.`); } catch (error) { setNotice(error?.message || 'Sign-in failed. Use demo access below for offline mode.'); } finally { setLoginBusy(false); } };
  const descriptions = {
    'Command center': 'Electronic environment overview and active signal intelligence.',
    'Live spectrum': 'Wideband receiver activity over time and frequency.',
    'Scan strategy': 'Allocate receiver time across ranked observation opportunities.',
    'Emitter activity': 'Track emitter behavior and inspect pulse descriptor history.',
    'Scenario lab': 'Configure a synthetic RF environment for simulation.',
    'Decision history': 'Review policy actions, outcomes, and reward history.',
    'Performance': 'Monitor policy performance across operational metrics.',
    'Research mode': 'Inspect scheduler state, policy decisions, and evaluation data.',
    'Profile': 'Account identity, assigned role, and available access.',
  };
  if (gate !== 'console') return <WelcomeGate gate={gate} setGate={setGate} name={loginName} setName={setLoginName} password={loginPassword} setPassword={setLoginPassword} onSubmit={signIn} busy={loginBusy} notice={notice} setNotice={setNotice} onDemo={demoAccess} />;
  let page;
  if (active === 'Command center') page = <><MetricRail /><div className="primary-grid"><div className="primary-column"><SpectrumPanel /><RecentActivity onNavigate={changePage} /></div><div className="side-column"><Observation onNavigate={changePage} /><Recommendation onNavigate={changePage} /><IntegrityNote /></div></div></>;
  else if (active === 'Live spectrum') page = <LiveSpectrumPage />;
  else if (active === 'Scan strategy') page = <ScanStrategyPage />;
  else if (active === 'Emitter activity') page = <EmitterActivityPage selectedEmitter={selectedEmitter} setSelectedEmitter={setSelectedEmitter} />;
  else if (active === 'Scenario lab') page = <ScenarioLabPage />;
  else if (active === 'Decision history') page = <DecisionHistoryPage />;
  else if (active === 'Performance') page = <PerformancePage />;
  else if (active === 'Profile') page = <ProfilePage session={authSession} />;
  else page = <ResearchModePage />;
  return <div className="app-shell"><Sidebar active={active} setActive={changePage} collapsed={collapsed} setCollapsed={setCollapsed} session={authSession} /><main className="main-content"><Header active={active} onNavigate={changePage} onSourceChange={next => { if (next === 'LIVE' && !getAuthSession()?.accessToken) { window.dispatchEvent(new CustomEvent('aegis-toast', { detail: 'Sign in with a backend account to enable dataset replay. Offline demo identities do not include backend access.' })); return; } if (dataSource === 'LIVE' && next === 'OFFLINE') void pauseScenario().catch(console.error); if (next === 'LIVE') { useSimulationStore.getState().setScenarioConfig({ scenarioId: 'tsrd-replay', emitterCount: 1, durationSeconds: 300, seed: 7419 }); } setDataSource(next); }} /><div className={`page-content page-${active.toLowerCase().replaceAll(' ', '-')}`}>
    <motion.div className="page-title-row" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .4, ease }}><div><div className="eyebrow page-kicker">{theaterDateLabel} <span>·</span> {theaterName}</div><h1>{active}</h1><p>{descriptions[active]}</p></div><div className="title-actions"><label className="range-select"><span className="eyebrow">TIME WINDOW</span><select aria-label="Time window" value={timeWindowSeconds} onChange={event => setTimeWindow(Number(event.target.value))}><option value="300">LAST 5 MIN</option><option value="900">LAST 15 MIN</option><option value="1800">LAST 30 MIN</option><option value="3600">LAST 60 MIN</option></select><ChevronDown size={14} /></label><button aria-label="Open settings" className="icon-button settings-action" onClick={() => setNotice("Display settings: choose a capture window above; simulation speed and source are available in the header.")}><SlidersHorizontal size={16} /></button></div></motion.div>
    {notice && <div className="app-notice" role="status"><span>{notice}</span><button aria-label="Dismiss message" onClick={() => setNotice('')}><X size={14}/></button></div>}
    {page}
    <footer className="page-footer"><span>AEGIS EW COMMAND <span className="footer-dot">·</span> BUILD 2.4.18</span><span>CLASSIFICATION <b>SECRET // REL TO USA, FVEY</b></span><span><span className="health-dot" /> ALL SYSTEMS OPERATIONAL</span></footer>
  </div></main></div>;
}
