import React, { Suspense, lazy, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Activity, Antenna, ArrowDown, ArrowDownRight, ArrowRight, ArrowUp, ArrowUpRight, AudioWaveform, BarChart3, Bell, Brain, Check, ChevronDown, ChevronRight, ChevronUp, Clock, Crosshair, Database, FlaskConical, Gauge, Headphones, Layers3, Maximize2, Menu, Microscope, Moon, Play, Radar, Radio, Settings2, Shield, Signal, SlidersHorizontal, Sparkles, Sun, Target, Waves, X } from 'lucide-react';
import { selectOperatorEmitters, useSimulationStore } from './store/simulationStore';
import { BELIEF_WEIGHTS, explainBandState, decomposeBandScore } from './simulation/beliefEngine.ts';
import './simulation/loop';
import './landing.css';
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

function ThemeToggle({ className = '' }) {
  const [theme, setTheme] = useState(() => {
    return document.documentElement.getAttribute('data-theme') || localStorage.getItem('kavach-theme') || 'dark';
  });

  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('kavach-theme', next);
    window.dispatchEvent(new CustomEvent('kavach-theme-changed', { detail: next }));
  };

  useEffect(() => {
    const handler = (e) => setTheme(e.detail);
    window.addEventListener('kavach-theme-changed', handler);
    return () => window.removeEventListener('kavach-theme-changed', handler);
  }, []);

  return (
    <button
      className={`theme-toggle-btn ${className}`}
      onClick={toggle}
      title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} Mode`}
      aria-label="Toggle theme mode"
    >
      {theme === 'dark' ? (
        <>
          <Sun size={13} style={{ color: '#f5a623' }} />
          <span>LIGHT</span>
        </>
      ) : (
        <>
          <Moon size={13} style={{ color: '#059669' }} />
          <span>DARK</span>
        </>
      )}
    </button>
  );
}

function Sidebar({ active, setActive, collapsed, setCollapsed, session, onExitToLanding = () => {} }) {
  const currentTime = useSimulationStore(s => s.currentSimulationTime);
  const operationId = useSimulationStore(s => s.operationId);
  return <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
    <div className="brand" onClick={onExitToLanding} style={{ cursor: 'pointer' }} title="Return to Overview / Landing Page">
      <div className="brand-mark">
        <Shield size={19} strokeWidth={1.8} />
      </div>
      {!collapsed && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <b>KAVACH</b>
          <small style={{ fontSize: '7.5px', letterSpacing: '0.18em', color: '#10F49C', fontWeight: 700 }}>EW COMMAND</small>
        </div>
      )}
      <button className="collapse-btn" onClick={(e) => { e.stopPropagation(); setCollapsed(!collapsed); }}><Menu size={16} /></button>
    </div>
    {!collapsed && (
      <button className="subtle-button" onClick={onExitToLanding} style={{ margin: '8px 2px 0', fontSize: '9px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', color: 'rgba(255,255,255,0.7)', border: '1px solid rgba(56,225,167,0.22)', borderRadius: '6px', padding: '5px 8px', background: 'rgba(16,244,156,0.06)' }}>
        ← RETURN TO OVERVIEW
      </button>
    )}
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
  return <header className="topbar"><div className="breadcrumb"><span>{group}</span><ChevronRight size={13} /><b>{active.toUpperCase()}</b></div><div className="top-right"><ThemeToggle /><label className="data-source-control"><span className="eyebrow">DATA SOURCE</span><select aria-label="Data source" value={source} onChange={e => onSourceChange(e.target.value)}><option value="OFFLINE">OFFLINE SIMULATION</option><option value="LIVE" disabled>LIVE BACKEND (PENDING B7)</option></select></label><AuthControl /><div className="system-health"><span className="health-dot" /> SYSTEM NOMINAL <span className="divider" /><Mono>SYNC {constraints.retuningDelayMs}ms</Mono></div><div className="notification-wrap"><button aria-label="Notifications" aria-expanded={notificationsOpen} className="icon-button notification" onClick={() => setNotificationsOpen(open => !open)}><Bell size={17} />{activeAlerts.some(a => a.active) && <i />}</button>{notificationsOpen && <div className="notification-panel"><div className="notification-head"><b>NOTIFICATIONS</b><button aria-label="Close notifications" onClick={() => setNotificationsOpen(false)}><X size={14}/></button></div>{activeAlerts.filter(a => a.active).length ? activeAlerts.filter(a => a.active).map(alert => <button className="notification-item" key={alert.id} onClick={() => { setNotificationsOpen(false); onNavigate(alert.severity === "CRITICAL" ? "Research mode" : "Decision history"); }}><span className="notification-severity">{alert.severity} · {alert.timestamp}</span><b>{alert.title}</b><small>{alert.description}</small></button>) : <p className="notification-empty">All clear. No active alerts.</p>}<button className="notification-clear" onClick={() => setAlerts(activeAlerts.map(alert => ({ ...alert, active: false })))}>CLEAR ACTIVE ALERTS</button></div>}</div><div className="utc"><span className="eyebrow">UTC</span><Mono>{currentTime}</Mono></div></div></header>;
}

function AuthControl() {
  const [session, setSession] = useState(getAuthSession);
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async event => { event.preventDefault(); setBusy(true); setError(''); try { const result = await login(username, password); setSession(getAuthSession()); window.dispatchEvent(new Event('kavach-auth-changed')); setPassword(''); setOpen(false); } catch (problem) { setError(problem.message); } finally { setBusy(false); } };
  const logout = () => { clearAuthSession(); setSession(null); window.dispatchEvent(new Event('kavach-auth-changed')); };
  return <div className="auth-control"><button className="subtle-button" onClick={() => session ? logout() : setOpen(value => !value)}>{session ? `${session.role} · LOG OUT` : 'SIGN IN'}</button>{open && <form className="auth-popover" onSubmit={submit}><div className="eyebrow">PILOT ACCOUNT</div><input autoComplete="username" placeholder="Username" value={username} onChange={event => setUsername(event.target.value)} /><input autoComplete="current-password" type="password" placeholder="Password" value={password} onChange={event => setPassword(event.target.value)} />{error && <small>{error}</small>}<button className="button-primary" disabled={busy}>{busy ? 'SIGNING IN…' : 'SIGN IN'}</button></form>}</div>;
}

function SpectrumPanel() {
  const receiver = useSimulationStore(s => s.receiverState);
  const currentBand = useSimulationStore(s => s.bandBeliefs.find(band => band.bandId === s.receiverModel.bandId));
  const receiverModel = useSimulationStore(s => s.receiverModel);
  const emitters = useSimulationStore(selectOperatorEmitters);
  const constraints = useSimulationStore(s => s.receiverConstraints);
  const simulationStatus = useSimulationStore(s => s.simulationStatus);
  const dataSource = useSimulationStore(s => s.dataSource);
  const startSimulation = useSimulationStore(s => s.startSimulation);
  const pauseSimulation = useSimulationStore(s => s.pauseSimulation);
  const toggleLive = () => { if (dataSource === 'LIVE') void (simulationStatus === 'RUNNING' ? pauseScenario() : startScenario()).then(state => useSimulationStore.getState().applyBackendDelta({ type: 'full_state', version: 1, ...state })).catch(error => window.dispatchEvent(new CustomEvent('kavach-toast', { detail: error.message }))); else simulationStatus === 'RUNNING' ? pauseSimulation() : startSimulation(); };
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
  const latestPdw = useSimulationStore(s => s.pdwHistory[0]);
  const receiver = useSimulationStore(s => s.receiverState);
  const receiverModel = useSimulationStore(s => s.receiverModel);
  const currentBand = useSimulationStore(s => s.bandBeliefs.find(band => band.bandId === s.receiverModel.bandId));
  const lastTickResult = useSimulationStore(s => s.lastTickResult);
  const alert = useSimulationStore(s => s.activeAlerts.find(a => a.active));
  const simulationStatus = useSimulationStore(s => s.simulationStatus);
  const dataSource = useSimulationStore(s => s.dataSource);
  const scenarios = useSimulationStore(s => s.scenarios);
  const startSimulation = useSimulationStore(s => s.startSimulation);
  const setScenarioConfig = useSimulationStore(s => s.setScenarioConfig);

  const startDemo = () => {
    if (dataSource === 'LIVE') {
      startScenario().then(state => useSimulationStore.getState().applyBackendDelta({ type: 'full_state', version: 1, ...state })).catch(error => window.dispatchEvent(new CustomEvent('kavach-toast', { detail: error.message })));
      return;
    }
    const demo = scenarios.find(scenario => scenario.id === 'adaptive-multi-emitter') || scenarios[0];
    const demoConfig = { scenarioId: demo.id, emitterCount: demo.defaultEmitterCount, durationSeconds: demo.defaultDurationSeconds, seed: demo.defaultSeed };
    setScenarioConfig(demoConfig);
    startSimulation(demoConfig);
  };

  if (simulationStatus === 'IDLE') return <Panel className="observation-panel empty-panel" delay={.13}><div className="eyebrow">CURRENT OBSERVATION</div><h3>No active RF scenario</h3><p>Start a scenario to begin spectrum monitoring.</p><button className="button-primary" style={{ marginTop: '1rem' }} onClick={startDemo}>{dataSource === 'LIVE' ? 'START DATASET REPLAY' : 'START DEMO SCENARIO'} <Play size={13}/></button></Panel>;
  if (!emitter) return <Panel className="observation-panel empty-panel" delay={.13}><div className="panel-heading compact"><div><div className="eyebrow">CURRENT OBSERVATION</div><h3>{simulationStatus === 'RUNNING' ? 'Receiver searching' : 'Awaiting first intercept'}</h3></div><Status live={simulationStatus === 'RUNNING'} tone={simulationStatus === 'RUNNING' ? 'teal' : 'quiet'}>{simulationStatus === 'RUNNING' ? receiverModel.phase : 'STANDBY'}</Status></div><p>{simulationStatus === 'RUNNING' ? `Scanning ${currentBand?.band ?? 'the selected band'} at ${receiver.currentFrequencyGHz.toFixed(3)} GHz. Intercept descriptors appear here and in the waterfall when the receiver detects a pulse train.` : 'Start a scenario to begin measured scanning and pulse capture.'}</p><div className="observation-live-readout"><span><small>RECEIVER TUNE</small><Mono>{receiver.currentFrequencyGHz.toFixed(3)} GHz</Mono></span><span><small>ACTIVE BAND</small><Mono>{currentBand?.band ?? '—'}</Mono></span><span><small>LAST DWELL</small><Status tone={lastTickResult === 'HIT' ? 'green' : lastTickResult === 'MISS' ? 'amber' : 'quiet'}>{lastTickResult ?? 'NO RESULT'}</Status></span></div>{simulationStatus === 'IDLE' && <button className="button-primary" style={{ marginTop: '1rem' }} onClick={startDemo}>{dataSource === 'LIVE' ? 'START DATASET REPLAY' : 'START DEMO SCENARIO'} <Play size={13}/></button>}</Panel>;
  return <Panel className="observation-panel" delay={.13}>
    <div className="panel-heading compact"><div><div className="eyebrow">CURRENT OBSERVATION</div><h3>{latestPdw ? 'Pulse intercept detected' : 'Tracked emitter'}</h3></div><Status tone={alert?.severity === 'CRITICAL' ? 'red' : latestPdw?.result === 'HIT' ? 'green' : 'amber'}>{alert?.displayLabel || latestPdw?.result || 'TRACKED'}</Status></div>
    <div className="emitter-id"><div className="emitter-icon"><Antenna size={17} /></div><div><b>{emitter.displayName} <span className="muted">/</span> {emitter.id}</b><small>TRACKED · FIRST SEEN {emitter.firstSeenTimestamp}</small>{alert?.description && <small className="alert-detail">{alert.description}</small>}</div><button className="dots" aria-label="Inspect emitter" title="Open emitter details" onClick={() => onNavigate("Emitter activity")}>···</button></div>
    <div className="observation-grid">
      <div className="obs-cell"><span className="eyebrow">CENTER FREQUENCY</span><Mono className="large-number">{emitter.centerFrequencyGHz.toFixed(3)} <small>GHz</small></Mono><span className="trend"><ArrowUpRight size={12} /> +{emitter.frequencyDeltaMHz.toFixed(1)} MHz</span></div>
      <div className="obs-cell"><span className="eyebrow">PULSE REP. INT.</span><Mono className="large-number">{emitter.priMs.toFixed(3)} <small>ms</small></Mono><span className="trend neutral"><Activity size={12} /> {emitter.stabilityStatus}</span></div>
      <div className="obs-cell"><span className="eyebrow">CONFIDENCE</span><Mono className="large-number">{(emitter.confidence * 100).toFixed(1)}<small>%</small></Mono><div className="confidence-track"><motion.i initial={{ width: 0 }} animate={{ width: `${emitter.confidence * 100}%` }} transition={{ duration: .85, delay: .32, ease }} /></div></div>
      <div className="obs-cell"><span className="eyebrow">SIGNAL STRENGTH</span><Mono className="large-number">{emitter.signalStrengthDbm} <small>dBm</small></Mono><span className="signal-bars">{Array.from({ length: 10 }, (_, i) => <motion.i key={i} className={i > 7 ? 'dim' : ''} initial={{ scaleY: 0 }} animate={{ scaleY: 1 }} transition={{ duration: .36, delay: .22 + i * .045, ease }} />)}</span></div>
    </div>
    {latestPdw && <div className="pulse-detail-grid"><span><small>TIME OF ARRIVAL</small><Mono>{latestPdw.timestamp}</Mono></span><span><small>PULSE WIDTH</small><Mono>{latestPdw.pulseWidthUs.toFixed(2)} μs</Mono></span><span><small>AOA</small><Mono>{latestPdw.aoaDeg === undefined ? '—' : `${latestPdw.aoaDeg.toFixed(1)}°`}</Mono></span><span><small>DETECTION</small><Status tone={latestPdw.result === 'HIT' ? 'green' : 'amber'}>{latestPdw.result}</Status></span></div>}
    <button className="button-primary" onClick={() => onNavigate('Emitter activity')}>VIEW SIGNAL PROFILE <ChevronRight size={15} /></button>
  </Panel>;
}

function Recommendation({ onNavigate = () => { }, onViewDecision = () => onNavigate('Decision history'), onViewCompare = null }) {
  const recommendation = useSimulationStore(s => s.currentRecommendation);
  const triggerRetune = useSimulationStore(s => s.commandReceiverRetune);
  const retuning = useSimulationStore(s => s.receiverModel.phase === 'RETUNING');
  const simulationStatus = useSimulationStore(s => s.simulationStatus);
  const dataSource = useSimulationStore(s => s.dataSource);
  const bands = useSimulationStore(s => s.bandBeliefs);
  const startSimulation = useSimulationStore(s => s.startSimulation);
  const [showExplain, setShowExplain] = useState(false);

  const applyPlan = () => {
    if (dataSource !== 'OFFLINE') { window.dispatchEvent(new CustomEvent('kavach-toast', { detail: 'Receiver overrides are available in Offline Simulation; Live Backend replay is read-only.' })); return; }
    if (simulationStatus !== 'RUNNING') {
      startSimulation();
    }
    if (triggerRetune) {
      triggerRetune(recommendation.bandId);
      window.dispatchEvent(new CustomEvent('kavach-toast', { detail: `Receiver directed to ${recommendation.title} (${recommendation.frequencyStartGHz.toFixed(2)}–${recommendation.frequencyEndGHz.toFixed(2)} GHz)` }));
    }
  };

  const recBand = bands.find(b => b.bandId === recommendation.bandId) || bands[0];
  const decomposition = recBand ? decomposeBandScore(recBand) : null;

  return <Panel className="recommendation-panel" delay={.18}>
    <div className="panel-heading compact"><div><div className="eyebrow"><Sparkles size={12} /> NEXT SCAN RECOMMENDATION</div><h3>{recommendation.title}</h3></div><span className="rec-index mono">01 / {String(bands.length).padStart(2, '0')}</span></div>
    <motion.div key={`${recommendation.bandId}-${recommendation.title}`} className="rec-band" initial={{ opacity: .55, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .42, ease }}><div className="band-icon"><Waves size={16} /></div><div className="band-details"><b>{recommendation.frequencyStartGHz.toFixed(2)} – {recommendation.frequencyEndGHz.toFixed(2)} <small>GHz</small></b><div style={{ marginTop: '4px', display: 'flex', flexDirection: 'column', gap: '2px' }}><span className="eyebrow" style={{ fontSize: '9px', opacity: 0.8 }}>WHY THIS BAND NOW?</span><span>{recommendation.explanation}</span></div></div><Status tone="amber">{recommendation.likelihood.toFixed(2)} LIKELIHOOD</Status></motion.div>
    <div className="rec-meta"><span><span className="eyebrow">EXPECTED YIELD</span><Mono>+{recommendation.expectedYieldPercent}% <ArrowUpRight size={12} /></Mono></span><span><span className="eyebrow">DWELL TIME</span><Mono>{recommendation.dwellMs} ms</Mono></span><span><span className="eyebrow">BASIS</span><span className="basis-chip">{recommendation.basis}</span></span></div>
    
    <div style={{ marginTop: '8px', borderTop: '1px solid rgba(255,255,255,0.07)', paddingTop: '6px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="eyebrow" style={{ fontSize: '8px', color: '#75c9bf' }}>SCHEDULER FACTOR BREAKDOWN</span>
        <button className="subtle-button" style={{ padding: '2px 6px', fontSize: '9px', height: 'auto', minWidth: 'auto' }} onClick={() => setShowExplain(prev => !prev)}>
          {showExplain ? 'HIDE WEIGHTS' : 'WHY THIS BAND?'} {showExplain ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
        </button>
      </div>
      {showExplain && decomposition && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', marginTop: '6px', background: 'rgba(0,0,0,0.3)', padding: '8px', borderRadius: '4px', border: '1px solid rgba(117,201,191,0.15)' }}>
          {decomposition.factors.map(f => (
            <div key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px' }}>
                <span style={{ color: 'rgba(255,255,255,0.85)' }}>{f.label} <small style={{ opacity: 0.5 }}>({f.weightPct}% wt)</small></span>
                <Mono style={{ color: f.score > 0 ? '#75c9bf' : 'rgba(255,255,255,0.4)' }}>+{f.score} pts</Mono>
              </div>
              <div className="mini-track" style={{ height: '3px' }}><i style={{ width: `${Math.min(100, f.score * 3.5)}%`, background: f.score > 15 ? '#75c9bf' : '#d5a56a' }} /></div>
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', paddingTop: '4px', borderTop: '1px solid rgba(255,255,255,0.1)', marginTop: '2px' }}>
            <span style={{ color: '#d5a56a' }}>Retune Travel Penalty</span>
            <Mono style={{ color: '#d5a56a' }}>-{decomposition.costTerm} pts</Mono>
          </div>
          <div style={{ fontSize: '9px', color: 'rgba(255,255,255,0.6)', fontStyle: 'italic', marginTop: '3px', lineHeight: '1.3' }}>
            Primary driver: <b>{decomposition.dominantFactor.label}</b> (+{decomposition.dominantFactor.score} pts) — {decomposition.dominantFactor.desc}.
          </div>
        </div>
      )}
    </div>

    <div className="recommendation-actions">
      <button className="button-secondary" onClick={applyPlan} disabled={retuning} title="Command receiver to scan recommended band">
        {retuning ? 'RETUNING...' : 'APPLY SCAN PLAN'} <ChevronRight size={15} />
      </button>
      <div style={{ display: 'flex', gap: '8px' }}>
        {onViewCompare && <button className="text-action" onClick={onViewCompare}>COMPARE CONTENDERS <SlidersHorizontal size={12} /></button>}
        <button className="text-action" onClick={() => onViewDecision(recommendation.bandId)}>VIEW DECISION <ArrowUpRight size={13} /></button>
      </div>
    </div>
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
function Waterfall({ onSelectBand = null }) {
  const pdwHistory = useSimulationStore(s => s.pdwHistory);
  const recommendation = useSimulationStore(s => s.currentRecommendation);
  const receiver = useSimulationStore(s => s.receiverState);
  const receiverModel = useSimulationStore(s => s.receiverModel);
  const bands = useSimulationStore(s => s.bandBeliefs);
  const totalIntercepts = useSimulationStore(s => s.operationalMetrics.totalPdwCount);
  const simulationStatus = useSimulationStore(s => s.simulationStatus);
  const currentSimulationTime = useSimulationStore(s => s.currentSimulationTime);
  const windowSeconds = useSimulationStore(s => s.timeWindowSeconds);
  const constraints = useSimulationStore(s => s.receiverConstraints);
  const setTimeWindow = useSimulationStore(s => s.setTimeWindowSeconds);
  const [zoom, setZoom] = useState(1);
  const [scrub, setScrub] = useState(100);
  const [selectedBandId, setSelectedBandId] = useState(null);
  const [hoveredStreak, setHoveredStreak] = useState(null);

  useEffect(() => {
    const handler = (e) => setSelectedBandId(e.detail);
    window.addEventListener('kavach-select-band', handler);
    return () => window.removeEventListener('kavach-select-band', handler);
  }, []);

  const freqSpan = constraints.frequencyMaxGHz - constraints.frequencyMinGHz;
  const plotWindowSeconds = windowSeconds / zoom;
  const nowMs = pdwTimeMs(currentSimulationTime) || (pdwHistory[0] ? pdwTimeMs(pdwHistory[0].timestamp) : 0);
  const offsetSeconds = ((100 - scrub) / 100) * plotWindowSeconds * 5;
  const viewEndMs = nowMs - offsetSeconds * 1000;
  const viewStartMs = viewEndMs - plotWindowSeconds * 1000;
  const streaks = pdwHistory.flatMap(pdw => {
    const timestampMs = pdwTimeMs(pdw.timestamp);
    if (timestampMs < viewStartMs || timestampMs > viewEndMs) return [];
    const markerWidth = Math.max(12, Math.min(24, 8 + pdw.priMs * 3));
    return [{
      id: pdw.id,
      x: ((timestampMs - viewStartMs) / (plotWindowSeconds * 1000)) * 1000 - markerWidth / 2,
      y: ((constraints.frequencyMaxGHz - pdw.centerFrequencyGHz) / freqSpan) * 530,
      width: markerWidth,
      hot: pdw.amplitudePercent >= 70,
      opacity: Math.max(.58, Math.min(1, pdw.amplitudePercent / 100)),
      amplitudePercent: pdw.amplitudePercent,
      amplitudeDbm: pdw.amplitudeDbm,
      classification: pdw.classification,
      result: pdw.result,
      timestamp: pdw.timestamp,
      emitterId: pdw.emitterId,
      frequencyGHz: pdw.centerFrequencyGHz,
      pulseWidthUs: pdw.pulseWidthUs,
      aoaDeg: pdw.aoaDeg,
    }];
  });

  const regions = recommendation ? [{
    id: recommendation.bandId,
    styleClass: 'band-one',
    topPercent: ((constraints.frequencyMaxGHz - recommendation.frequencyEndGHz) / freqSpan) * 100,
    heightPercent: ((recommendation.frequencyEndGHz - recommendation.frequencyStartGHz) / freqSpan) * 100,
    label: 'RECOMMENDED SEARCH WINDOW'
  }] : [];

  const selectedBand = selectedBandId ? bands.find(b => b.bandId === selectedBandId) : null;
  const receiverY = ((constraints.frequencyMaxGHz - receiver.currentFrequencyGHz) / freqSpan) * 530;
  const frequencyTicks = Array.from({ length: 5 }, (_, i) => (constraints.frequencyMaxGHz - (freqSpan / 4) * i).toFixed(1));
  const timeLabels = Array.from({ length: 6 }, (_, i) => {
    if (i === 5) return scrub === 100 ? 'NOW' : `-${offsetSeconds.toFixed(0)}s`;
    const labelSeconds = plotWindowSeconds * (1 - i / 5) + offsetSeconds;
    if (labelSeconds >= 60) return `−${Math.floor(labelSeconds / 60)}m`;
    return `−${Math.floor(labelSeconds)}s`;
  });

  const handleWaterfallClick = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const yPct = (e.clientY - rect.top) / rect.height;
    const freq = constraints.frequencyMaxGHz - (yPct * freqSpan);
    const band = bands.find(b => freq >= b.frequencyStartGHz && freq <= b.frequencyEndGHz);
    if (band) {
      setSelectedBandId(band.bandId);
      window.dispatchEvent(new CustomEvent('kavach-select-band', { detail: band.bandId }));
      if (onSelectBand) onSelectBand(band.bandId);
    }
  };

  const currentBand = bands.find(b => b.bandId === receiverModel.bandId);

  return <div className="waterfall-panel panel">
    <div className="waterfall-toolbar"><div><span className="eyebrow"><span className="small-live" /> WATERFALL · {receiver.id}</span><span className="wf-subtitle">{freqSpan.toFixed(0)} GHz span <i>·</i> {streaks.length} detections in view / {totalIntercepts} total</span></div><div className="wf-actions"><Status live={simulationStatus === 'RUNNING'} tone={simulationStatus === 'RUNNING' ? 'teal' : simulationStatus === 'PAUSED' ? 'amber' : 'quiet'}>{simulationStatus === 'RUNNING' ? 'RECEIVING' : simulationStatus === 'PAUSED' ? 'PAUSED' : 'STANDBY'}</Status><button className="wf-control" aria-label="Zoom out" onClick={() => setZoom(value => Math.max(.5, +(value - .25).toFixed(2)))}>−</button><button className="wf-control" onClick={() => setZoom(1)} title="Reset zoom">{Math.round(zoom * 100)}%</button><button className="wf-control" aria-label="Zoom in" onClick={() => setZoom(value => Math.min(3, +(value + .25).toFixed(2)))}>+</button><button className="wf-control" aria-label="Toggle waterfall fullscreen" onClick={event => { const panel = event.currentTarget.closest(".waterfall-panel"); if (!document.fullscreenElement) void panel?.requestFullscreen?.(); else void document.exitFullscreen?.(); }}><Maximize2 size={13}/></button></div></div>
    <div className="waterfall-chart"><div className="wf-y-labels">{frequencyTicks.map(tick => <Mono key={tick}>{tick}</Mono>)}<span>GHz</span></div><div className="wf-plot" style={{ position: 'relative' }}>
      {regions.map(region => <div key={region.id} className={`wf-predicted ${region.styleClass}`} style={{ top: `${region.topPercent}%`, height: `${region.heightPercent}%`, background: 'rgba(213, 165, 106, 0.15)', borderTop: '1px solid rgba(213, 165, 106, 0.5)', borderBottom: '1px solid rgba(213, 165, 106, 0.5)', boxShadow: '0 0 10px rgba(213, 165, 106, 0.2)' }}>{region.label && <span style={{ color: '#d5a56a', textShadow: '0 0 5px rgba(213, 165, 106, 0.5)' }}>{region.label}</span>}</div>)}
      {selectedBand && (
        <div style={{ position: 'absolute', left: 0, right: 0, top: `${((constraints.frequencyMaxGHz - selectedBand.frequencyEndGHz) / freqSpan) * 100}%`, height: `${((selectedBand.frequencyEndGHz - selectedBand.frequencyStartGHz) / freqSpan) * 100}%`, border: '1px solid #75c9bf', background: 'rgba(117, 201, 191, 0.1)', pointerEvents: 'none', zIndex: 6, boxShadow: '0 0 12px rgba(117, 201, 191, 0.3)' }}>
          <span style={{ position: 'absolute', right: '8px', top: '2px', fontSize: '9px', color: '#75c9bf', fontWeight: 'bold', background: '#0b1110', padding: '1px 5px', borderRadius: '3px' }}>
            INSPECTING {selectedBand.band} ({selectedBand.frequencyStartGHz.toFixed(2)}–{selectedBand.frequencyEndGHz.toFixed(2)} GHz · OBS: {selectedBand.observationValue})
          </span>
        </div>
      )}
      {hoveredStreak && (
        <div style={{ position: 'absolute', left: `${Math.min(80, Math.max(12, (hoveredStreak.x / 1000) * 100))}%`, top: `${Math.max(8, Math.min(85, (hoveredStreak.y / 530) * 100 - 8))}%`, transform: 'translate(-50%, -100%)', background: '#09100e', border: '1px solid #75c9bf', borderRadius: '4px', padding: '6px 9px', fontSize: '10px', boxShadow: '0 6px 20px rgba(0,0,0,0.85)', pointerEvents: 'none', zIndex: 25, whiteSpace: 'nowrap', color: '#d9e8e3' }}>
          <div style={{ fontWeight: 'bold', color: '#75c9bf', marginBottom: '2px', display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
            <span>{hoveredStreak.emitterId}</span>
            <span style={{ color: hoveredStreak.result === 'HIT' ? '#75c9bf' : '#d5a56a' }}>{hoveredStreak.result}</span>
          </div>
          <div>FREQ: <Mono>{hoveredStreak.frequencyGHz.toFixed(4)} GHz</Mono> · AMP: <Mono>{hoveredStreak.amplitudeDbm?.toFixed(1) ?? '—'} dBm</Mono></div>
          <div>PW: <Mono>{hoveredStreak.pulseWidthUs.toFixed(2)} μs</Mono> · AOA: <Mono>{hoveredStreak.aoaDeg !== undefined ? `${hoveredStreak.aoaDeg.toFixed(1)}°` : '—'}</Mono> · {hoveredStreak.classification || 'PULSE'}</div>
        </div>
      )}
      <svg viewBox="0 0 1000 530" preserveAspectRatio="none" role="img" aria-label="Live RF waterfall showing signal energy over time and frequency" onClick={handleWaterfallClick}>
      <defs>
        <linearGradient id="signalFade" x1="0" x2="1"><stop offset="0" stopColor="#3c8d85" stopOpacity=".15" /><stop offset=".55" stopColor="#73c9bc" stopOpacity=".78" /><stop offset="1" stopColor="#d8f5e9" stopOpacity=".95" /></linearGradient>
        <linearGradient id="streakLow" x1="0" x2="1"><stop offset="0" stopColor="rgba(60,141,133,0.1)" /><stop offset="1" stopColor="rgba(60,141,133,0.6)" /></linearGradient>
        <linearGradient id="streakMid" x1="0" x2="1"><stop offset="0" stopColor="rgba(115,201,188,0.2)" /><stop offset="1" stopColor="rgba(115,201,188,0.9)" /></linearGradient>
        <linearGradient id="streakHigh" x1="0" x2="1"><stop offset="0" stopColor="rgba(216,245,233,0.4)" /><stop offset="1" stopColor="#fff" /></linearGradient>
        <filter id="bloom">
          <feGaussianBlur stdDeviation="1.5" result="coloredBlur" />
          <feMerge><feMergeNode in="coloredBlur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>

      </defs>
      
      <rect x="0" y="0" width="1000" height="530" fill="url(#signalFade)" opacity="0.025" />

      {[0, 1, 2, 3, 4].map(i => <line key={`h${i}`} x1="0" x2="1000" y1={26 + i * 119} y2={26 + i * 119} stroke="rgba(210,230,225,.11)" strokeDasharray="2 5" />)}
      {[0, 1, 2, 3, 4, 5, 6, 7].map(i => <line key={`v${i}`} y1="0" y2="530" x1={i * 143} x2={i * 143} stroke="rgba(210,230,225,.055)" />)}
      
      {streaks.filter(s => !s.predicted).map(s => {
        let grad = 'url(#streakMid)';
        let strokeW = 1.5;
        if (s.hot) { grad = 'url(#streakHigh)'; strokeW = 2.5; }
        else if (s.opacity < 0.4) { grad = 'url(#streakLow)'; strokeW = 1.5; }
        const isHit = s.result === 'HIT';
        const color = isHit ? '#a9f3dc' : s.result === 'REVIEW' ? '#e2ba7c' : '#91b8b0';
        return (
          <g key={s.id} onMouseEnter={() => setHoveredStreak(s)} onMouseLeave={() => setHoveredStreak(null)} style={{ cursor: 'crosshair' }}>
            <title>{`${s.timestamp} · ${s.emitterId} · ${s.frequencyGHz.toFixed(4)} GHz · PW ${s.pulseWidthUs.toFixed(2)} μs · AoA ${s.aoaDeg === undefined ? '—' : `${s.aoaDeg.toFixed(1)}°`} · ${s.amplitudePercent}% · ${s.result}`}</title>
            <rect x={s.x - 2} y={s.y - 5} width={s.width + 4} height="12" rx="6" fill={color} opacity={isHit ? .18 : .10} filter="url(#bloom)" />
            <rect x={s.x} y={s.y - 1.5} width={s.width} height={strokeW} rx="1.5" fill={grad} opacity={s.opacity} filter="url(#bloom)" />
            <circle cx={Math.max(0, Math.min(1000, s.x + s.width))} cy={s.y} r={isHit ? 2.6 : 1.7} fill={color} opacity={s.opacity} />
          </g>
        );
      })}
      
      <line className="receiver-sweep" x1="0" x2="1000" y1={receiverY} y2={receiverY} stroke="#e4b979" strokeWidth="2" strokeDasharray="6 4" filter="url(#bloom)" opacity="0.8" />
      <rect x="0" y={receiverY - 1} width="1000" height="2" fill="#e4b979" opacity="0.15" filter="url(#bloom)" />
      <circle cx="746" cy={receiverY} r="4" fill="#fff" filter="url(#bloom)" />
      <circle cx="746" cy={receiverY} r="10" fill="#e4b979" opacity=".3" filter="url(#bloom)" />
      
      {simulationStatus === 'RUNNING' && <g className="waterfall-live-edge"><line x1="997" x2="997" y1="0" y2="530" stroke="#75c9bf" strokeWidth="1.5" opacity=".7"/><circle cx="997" cy="12" r="3" fill="#9cf1d7"/></g>}
    </svg>{simulationStatus === 'IDLE' && <div className="waterfall-empty-state"><span className="eyebrow">CAPTURE STANDBY</span><b>No pulse intercepts recorded</b><small>Start the demo scenario to begin receiver scans. Only measured PDWs are drawn as bursts.</small></div>}{simulationStatus === 'RUNNING' && streaks.length === 0 && <div className="waterfall-empty-state acquiring"><span className="eyebrow">RECEIVER SEARCH ACTIVE · {receiverModel.phase}</span><b>Scanning {currentBand?.band ?? receiverModel.bandId} at {receiver.currentFrequencyGHz.toFixed(3)} GHz</b><small>Awaiting a detected pulse; measured scan outcomes appear in the intercept feed.</small></div>}<div className="wf-x-labels">{timeLabels.map((label, i) => <Mono key={i}>{label}</Mono>)}</div><span className="wf-x-title">TIME ← HISTORICAL CAPTURE · MOST RECENT →</span></div></div>
    <div className="waterfall-bottom"><div className="wf-legend"><span><i className="legend-low" />LOW ENERGY</span><span><i className="legend-mid" />MODERATE</span><span><i className="legend-high" />HIGH ENERGY</span><span><i className="legend-predicted" />PREDICTED WINDOW</span><span><i className="legend-receiver" />{receiver.id} TUNE</span></div><div className="time-scrubber"><button onClick={() => setTimeWindow(Math.max(60, windowSeconds - 60))} aria-label="Decrease time window">{Math.floor(windowSeconds / 60)}m</button><input type="range" min="0" max="100" value={scrub} onChange={event => setScrub(Number(event.target.value))} aria-label="Time window scrubber" title={`Capture position ${scrub}%`} /><button onClick={() => setTimeWindow(Math.min(3600, windowSeconds + 60))}>+ 1m</button></div></div>
  </div>;
}

function BandComparison({ onBackToInspect = null }) {
  const bands = useSimulationStore(s => s.bandBeliefs);
  const recommendation = useSimulationStore(s => s.currentRecommendation);
  const triggerRetune = useSimulationStore(s => s.commandReceiverRetune);
  const startSimulation = useSimulationStore(s => s.startSimulation);
  const simulationStatus = useSimulationStore(s => s.simulationStatus);
  const systemPickId = recommendation?.bandId || bands[0]?.bandId;
  const [selectedIds, setSelectedIds] = useState(() => {
    const second = bands.find(b => b.bandId !== systemPickId)?.bandId;
    return [systemPickId, second].filter(Boolean);
  });

  useEffect(() => {
    const handleSelect = (e) => {
      const val = e.detail;
      if (val && !selectedIds.includes(val) && selectedIds.length < 4) {
        setSelectedIds(prev => [...prev, val]);
      }
    };
    window.addEventListener('kavach-select-band', handleSelect);
    return () => window.removeEventListener('kavach-select-band', handleSelect);
  }, [selectedIds]);

  const systemBand = bands.find(b => b.bandId === systemPickId) || bands[0];
  const maxObs = Math.max(...bands.map(b => b.observationValue), 1);

  const handleScanThis = (id) => {
    if (simulationStatus !== 'RUNNING') {
      startSimulation();
    }
    if (triggerRetune) triggerRetune(id);
    const target = bands.find(b => b.bandId === id);
    window.dispatchEvent(new CustomEvent('kavach-toast', {
      detail: `Manual override: Retuned receiver to ${target?.band || id} (${((target.frequencyStartGHz + target.frequencyEndGHz) / 2).toFixed(2)} GHz)`
    }));
  };

  const addBand = (e) => {
    const val = e.target.value;
    if (val && !selectedIds.includes(val) && selectedIds.length < 4) {
      setSelectedIds([...selectedIds, val]);
    }
  };

  const removeBand = (id) => setSelectedIds(selectedIds.filter(x => x !== id));

  return <Panel className="comparison-panel" delay={.2}>
    <div className="panel-heading compact">
      <div>
        <div className="eyebrow">DECISION EXPLAINER & ARBITRATION</div>
        <h3>COMPARE SCAN OPTIONS</h3>
      </div>
      {onBackToInspect && (
        <button className="subtle-button" onClick={onBackToInspect} style={{ fontSize: '10px', padding: '3px 8px' }}>
          ← BACK TO LIVE
        </button>
      )}
    </div>
    
    <div className="band-picker">
      <select onChange={addBand} value="" aria-label="Select band to compare" style={{ padding: '5px 8px', fontSize: '11px', width: '100%', marginBottom: '8px', background: 'rgba(0,0,0,0.3)', color: '#fff', border: '1px solid rgba(117,201,191,0.2)', borderRadius: '4px' }}>
        <option value="" disabled>Add a candidate band to evaluate...</option>
        {bands.map(b => (
          <option key={b.bandId} value={b.bandId} disabled={selectedIds.includes(b.bandId)}>
            {b.band} ({b.frequencyStartGHz.toFixed(2)}–{b.frequencyEndGHz.toFixed(2)} GHz) · Obs: {b.observationValue}
          </option>
        ))}
      </select>
    </div>

    {selectedIds.length === 0 && <p className="empty-comparison" style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)' }}>Select up to 4 bands (or click on the waterfall) to compare computed scores side by side.</p>}

    <div className="comparison-cards" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {selectedIds.map(id => {
        const band = bands.find(b => b.bandId === id);
        if (!band) return null;
        const decomp = decomposeBandScore(band);
        const isSystemPick = id === systemPickId;
        const scoreDiff = isSystemPick ? 0 : band.observationValue - (systemBand?.observationValue || 0);

        return (
          <div key={id} className={`compare-card ${isSystemPick ? 'system-pick' : ''}`} style={{ background: isSystemPick ? 'rgba(117,201,191,0.08)' : 'rgba(255,255,255,0.03)', border: isSystemPick ? '1px solid rgba(117,201,191,0.35)' : '1px solid rgba(255,255,255,0.07)', padding: '10px', borderRadius: '6px' }}>
            <div className="compare-card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
              <div>
                <b style={{ fontSize: '13px', color: isSystemPick ? '#75c9bf' : '#fff' }}>{band.band}</b>
                <Mono style={{ fontSize: '10px', color: 'rgba(255,255,255,0.5)', marginLeft: '6px' }}>{band.frequencyStartGHz.toFixed(2)}–{band.frequencyEndGHz.toFixed(2)} GHz</Mono>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Status tone={isSystemPick ? 'teal' : 'amber'}>{isSystemPick ? 'WINNER · RANK 01' : `CONTENDER (${scoreDiff >= 0 ? `+${scoreDiff}` : scoreDiff} pts)`}</Status>
                {selectedIds.length > 1 && (
                  <button className="subtle-button" onClick={() => removeBand(id)} style={{ padding: '0', minWidth: 'auto', background: 'none' }}><X size={12}/></button>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '8px', paddingBottom: '6px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
              <div>
                <span className="eyebrow" style={{ fontSize: '8px' }}>OBSERVATION YIELD</span>
                <div style={{ fontSize: '18px', fontWeight: 'bold', color: isSystemPick ? '#75c9bf' : '#d5a56a' }}>
                  <Mono>{band.observationValue}</Mono> <small style={{ fontSize: '10px', opacity: 0.6 }}>/ 100</small>
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <span className="eyebrow" style={{ fontSize: '8px' }}>PRIMARY DRIVER</span>
                <div style={{ fontSize: '11px', color: '#e0ece8', fontWeight: '500' }}>{decomp.dominantFactor.label}</div>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', marginBottom: '10px' }}>
              <span className="eyebrow" style={{ fontSize: '8px', color: 'rgba(255,255,255,0.6)' }}>DECOMPOSED DECISION FACTORS</span>
              {decomp.factors.map(f => (
                <div key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9.5px' }}>
                    <span style={{ color: 'rgba(255,255,255,0.75)' }}>{f.label}</span>
                    <Mono style={{ color: f.score > 0 ? (isSystemPick ? '#75c9bf' : '#d5a56a') : 'rgba(255,255,255,0.3)' }}>+{f.score} pts</Mono>
                  </div>
                  <div className="mini-track" style={{ height: '3px' }}><i style={{ width: `${Math.min(100, f.score * 3.5)}%`, background: isSystemPick ? '#75c9bf' : '#d5a56a' }} /></div>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9.5px', marginTop: '2px' }}>
                <span style={{ color: '#d5a56a' }}>Retune Slew Penalty</span>
                <Mono style={{ color: '#d5a56a' }}>-{decomp.costTerm} pts</Mono>
              </div>
            </div>

            <div style={{ background: 'rgba(0,0,0,0.25)', padding: '6px 8px', borderRadius: '4px', fontSize: '10px', color: 'rgba(255,255,255,0.7)', fontStyle: 'italic', marginBottom: '8px', lineHeight: '1.3' }}>
              {isSystemPick 
                ? `System Pick: Highest net gain (+${band.observationValue} pts). ${decomp.dominantFactor.label} provides the strongest return (+${decomp.dominantFactor.score} pts).`
                : `Contender: Scored ${band.observationValue} pts (${scoreDiff >= 0 ? `+${scoreDiff}` : scoreDiff} pts vs Winner). ${decomp.costTerm > 8 ? `Penalized by retuning slew delay (-${decomp.costTerm} pts).` : `Lower yield on ${decomp.dominantFactor.label.toLowerCase()}.`}`
              }
            </div>

            {!isSystemPick && (
              <button className="button-secondary" style={{ width: '100%', fontSize: '10px', padding: '5px', justifyContent: 'center' }} onClick={() => handleScanThis(id)}>
                SCAN THIS INSTEAD <ChevronRight size={13}/>
              </button>
            )}
          </div>
        );
      })}
    </div>
  </Panel>;
}

function RadarScopeView() {
  const emitters = useSimulationStore(s => s.emitters);
  const receiver = useSimulationStore(s => s.receiverState);
  const constraints = useSimulationStore(s => s.receiverConstraints);
  const recommendation = useSimulationStore(s => s.currentRecommendation);
  const metrics = useSimulationStore(s => s.operationalMetrics);
  const rewards = useSimulationStore(s => s.decisionRewardTrace);
  const decisions = useSimulationStore(s => s.scanDecisions);
  const theaterName = useSimulationStore(s => s.theaterName);
  
  const freqSpan = constraints.frequencyMaxGHz - constraints.frequencyMinGHz;
  const trackedEmitters = [...emitters].sort((a, b) => b.confidence - a.confidence).slice(0, 5);

  const getPos = (freq) => {
    const radius = 15 + ((freq - constraints.frequencyMinGHz) / freqSpan) * 30;
    const angle = ((freq * 137.5) % 360) * (Math.PI / 180); 
    const x = 50 + radius * Math.cos(angle);
    const y = 50 + radius * Math.sin(angle);
    return { x, y, radius, angle };
  };

  return <div className="radar-layout" style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gridTemplateRows: 'auto 1fr auto', gap: '16px', height: '100%', minHeight: '600px', alignItems: 'stretch' }}>
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', gridColumn: '1', gridRow: '1 / span 3' }}>
      <Panel className="radar-panel" style={{ flex: '0 0 auto' }}>
        <div className="eyebrow">SECTOR MAP</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="muted">ACTIVE AREA</span><b style={{fontSize:'12px'}}>{theaterName}</b></div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="muted">TRACK LIMIT</span><Mono>24</Mono></div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="muted">BEARING</span><Mono>045° NNE</Mono></div>
        </div>
      </Panel>
      <Panel className="radar-panel" style={{ flex: '1 1 auto', display: 'flex', flexDirection: 'column' }}>
        <div className="eyebrow">TRACK TABLE</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr', fontSize: '10px', marginTop: '16px', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '8px', color: 'rgba(255,255,255,0.5)' }}>
          <span>ID</span><span>FREQ</span><span>CONF</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '12px', flex: '1 1 auto' }}>
          {trackedEmitters.map(e => (
            <div key={e.id} style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr', fontSize: '12px', alignItems: 'center' }}>
              <Mono style={{ color: '#fff' }}>{e.id}</Mono>
              <Mono>{e.centerFrequencyGHz.toFixed(2)}</Mono>
              <Status tone={e.statusTone}>{Math.round(e.confidence * 100)}%</Status>
            </div>
          ))}
          {trackedEmitters.length === 0 && <span className="muted" style={{ fontSize: '11px', marginTop: '8px' }}>No active tracks</span>}
        </div>
      </Panel>
      <Panel className="radar-panel" style={{ flex: '0 0 auto' }}>
        <div className="eyebrow">SCAN EFFICIENCY</div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 0', flexDirection: 'column' }}>
          <div style={{ fontSize: '32px', color: '#75c9bf', fontWeight: 'bold' }}><Mono>{metrics.scanEfficiencyPercent.toFixed(1)}%</Mono></div>
          <div className="muted" style={{ fontSize: '11px', marginTop: '8px' }}>+{metrics.scanEfficiencyDeltaPercent.toFixed(1)}% this window</div>
        </div>
      </Panel>
    </div>

    <Panel className="radar-panel" style={{ gridColumn: '2', gridRow: '1 / span 2', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden', padding: '32px', minWidth: '400px' }}>
      <div className="eyebrow" style={{ position: 'absolute', top: '16px', left: '20px' }}>AIR DEFENSE RADAR</div>
      <div style={{ position: 'absolute', top: '16px', right: '20px' }}><Mono style={{ fontSize: '11px' }}>AZ: AUTO / RNG: {freqSpan.toFixed(0)}GHz</Mono></div>
      
      <div style={{ width: '100%', maxWidth: '440px', aspectRatio: '1', position: 'relative', marginTop: '16px' }}>
        <style>{`
          @keyframes radarSweep { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
          @keyframes radarPing { 0% { transform: scale(0.5); opacity: 1; stroke-width: 0.6px; } 100% { transform: scale(2.5); opacity: 0; stroke-width: 0px; } }
          .radar-sweep-cone { transform-origin: 50px 50px; animation: radarSweep 4s linear infinite; }
          .radar-ping { transform-origin: center; animation: radarPing 2s cubic-bezier(0.22, 1, 0.36, 1) infinite; }
        `}</style>
        <svg viewBox="0 0 100 100" style={{ width: '100%', height: '100%', background: 'radial-gradient(circle, rgba(117,201,191,0.06) 0%, rgba(10,15,13,0) 70%)', borderRadius: '50%' }}>
          <circle cx="50" cy="50" r="48" fill="none" stroke="rgba(117,201,191,0.25)" strokeWidth="0.3" />
          <circle cx="50" cy="50" r="32" fill="none" stroke="rgba(117,201,191,0.15)" strokeWidth="0.3" strokeDasharray="1 1.5" />
          <circle cx="50" cy="50" r="16" fill="none" stroke="rgba(117,201,191,0.15)" strokeWidth="0.3" strokeDasharray="1 1.5" />
          <line x1="50" y1="2" x2="50" y2="98" stroke="rgba(117,201,191,0.15)" strokeWidth="0.3" />
          <line x1="2" y1="50" x2="98" y2="50" stroke="rgba(117,201,191,0.15)" strokeWidth="0.3" />
          
          <text x="50" y="5" fill="rgba(117,201,191,0.4)" fontSize="3" textAnchor="middle" style={{ fontFamily: 'monospace' }}>N</text>
          <text x="50" y="97.5" fill="rgba(117,201,191,0.4)" fontSize="3" textAnchor="middle" style={{ fontFamily: 'monospace' }}>S</text>
          <text x="96.5" y="51" fill="rgba(117,201,191,0.4)" fontSize="3" textAnchor="end" style={{ fontFamily: 'monospace' }}>E</text>
          <text x="3.5" y="51" fill="rgba(117,201,191,0.4)" fontSize="3" textAnchor="start" style={{ fontFamily: 'monospace' }}>W</text>

          <g className="radar-sweep-cone">
            <path d="M50 50 L50 2 A48 48 0 0 1 98 50 Z" fill="url(#radarGrad)" opacity="0.6" />
          </g>
          <defs>
            <linearGradient id="radarGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#75c9bf" stopOpacity="0.8" />
              <stop offset="100%" stopColor="#75c9bf" stopOpacity="0" />
            </linearGradient>
          </defs>

          {emitters.map(e => {
            const pos = getPos(e.centerFrequencyGHz);
            return (
              <g key={e.id}>
                {e.confidence > 0.6 && <circle cx={pos.x} cy={pos.y} r="2" fill="none" stroke="#75c9bf" className="radar-ping" style={{ transformOrigin: `${pos.x}px ${pos.y}px` }} />}
                <path d={`M ${pos.x-1.5} ${pos.y-0.5} L ${pos.x-1.5} ${pos.y-1.5} L ${pos.x-0.5} ${pos.y-1.5}`} fill="none" stroke="#75c9bf" strokeWidth="0.4" />
                <path d={`M ${pos.x+1.5} ${pos.y-0.5} L ${pos.x+1.5} ${pos.y-1.5} L ${pos.x+0.5} ${pos.y-1.5}`} fill="none" stroke="#75c9bf" strokeWidth="0.4" />
                <path d={`M ${pos.x-1.5} ${pos.y+0.5} L ${pos.x-1.5} ${pos.y+1.5} L ${pos.x-0.5} ${pos.y+1.5}`} fill="none" stroke="#75c9bf" strokeWidth="0.4" />
                <path d={`M ${pos.x+1.5} ${pos.y+0.5} L ${pos.x+1.5} ${pos.y+1.5} L ${pos.x+0.5} ${pos.y+1.5}`} fill="none" stroke="#75c9bf" strokeWidth="0.4" />
                
                <rect x={pos.x - 0.5} y={pos.y - 0.5} width="1" height="1" fill="#75c9bf" />
                <text x={pos.x + 2.5} y={pos.y} fill="#75c9bf" fontSize="2.2" style={{ fontFamily: 'monospace' }}>{e.id}</text>
                <text x={pos.x + 2.5} y={pos.y + 2.5} fill="rgba(117,201,191,0.6)" fontSize="1.8" style={{ fontFamily: 'monospace' }}>{e.centerFrequencyGHz.toFixed(2)}</text>
              </g>
            );
          })}

          {(() => {
            const rxPos = getPos(receiver.currentFrequencyGHz);
            return (
              <g>
                <circle cx={rxPos.x} cy={rxPos.y} r="3" fill="none" stroke="#d5a56a" strokeWidth="0.5" strokeDasharray="1 0.5" />
                <line x1={rxPos.x-4} y1={rxPos.y} x2={rxPos.x+4} y2={rxPos.y} stroke="#d5a56a" strokeWidth="0.4" />
                <line x1={rxPos.x} y1={rxPos.y-4} x2={rxPos.x} y2={rxPos.y+4} stroke="#d5a56a" strokeWidth="0.4" />
                <text x={rxPos.x + 4.5} y={rxPos.y - 2} fill="#d5a56a" fontSize="2.2" style={{ fontFamily: 'monospace' }}>LOCKED</text>
              </g>
            );
          })()}
        </svg>
      </div>
    </Panel>

    <Panel className="radar-panel" style={{ gridColumn: '2', gridRow: '3', display: 'flex', flexDirection: 'column' }}>
      <div className="eyebrow">ENGAGEMENT TIMELINE</div>
      <div style={{ display: 'flex', alignItems: 'center', height: '32px', marginTop: '12px', position: 'relative', flex: '1 1 auto' }}>
        <div style={{ position: 'absolute', width: '100%', height: '1px', background: 'rgba(255,255,255,0.1)', top: '50%' }} />
        {decisions.slice(0, 30).map((d, i) => (
          <div key={d.id} style={{ position: 'absolute', right: `${(i / 30) * 100}%`, top: '50%', transform: 'translateY(-50%)', width: '4px', height: d.result === 'HIT' ? '14px' : '6px', background: d.result === 'HIT' ? '#75c9bf' : 'rgba(255,255,255,0.3)' }} title={`${d.id} - ${d.result}`} />
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'rgba(255,255,255,0.5)', marginTop: '8px' }}>
        <Mono>-30 DECISIONS</Mono>
        <Mono>NOW</Mono>
      </div>
    </Panel>

    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', gridColumn: '3', gridRow: '1 / span 3' }}>
      <Panel className="radar-panel" style={{ flex: '0 0 auto' }}>
        <div className="eyebrow">TARGETING OVERVIEW</div>
        <div style={{ marginTop: '16px' }}>
          <b style={{ fontSize: '20px', color: '#75c9bf' }}><Mono>{recommendation?.bandId || 'NONE'}</Mono></b>
          <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.6)', marginTop: '6px', lineHeight: '1.4' }}>{recommendation?.basis || 'No active recommendation'}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginTop: '16px' }}>
            <div><span className="muted" style={{ fontSize: '10px', display: 'block', marginBottom: '4px' }}>CONFIDENCE</span><Mono>{recommendation ? (recommendation.likelihood * 100).toFixed(0) + '%' : '0%'}</Mono></div>
            <div><span className="muted" style={{ fontSize: '10px', display: 'block', marginBottom: '4px' }}>DWELL</span><Mono>{recommendation?.dwellMs || 0}ms</Mono></div>
          </div>
        </div>
      </Panel>
      <Panel className="radar-panel" style={{ flex: '1 1 auto', display: 'flex', flexDirection: 'column' }}>
        <div className="eyebrow">THREAT CORRIDOR</div>
        <div style={{ height: '80px', marginTop: '24px', display: 'flex', alignItems: 'flex-end', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
          <Sparkline values={rewards} color="#75c9bf" />
        </div>
        <div className="muted" style={{ fontSize: '10px', marginTop: '8px' }}>CUMULATIVE REWARD TREND</div>
        
        <div style={{ height: '80px', marginTop: 'auto', display: 'flex', alignItems: 'flex-end', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
          <Sparkline values={metrics.totalPdwCount ? [0, 5, 12, 28, 45, Math.min(100, metrics.pdwUpdateRateKHz*10)] : []} color="#d5a56a" />
        </div>
        <div className="muted" style={{ fontSize: '10px', marginTop: '8px' }}>OBSERVATION YIELD RATE</div>
      </Panel>
    </div>
  </div>;
}

function LiveSpectrumPage({ onNavigate = () => { } }) {
  const receiver = useSimulationStore(s => s.receiverState);
  const constraints = useSimulationStore(s => s.receiverConstraints);
  const [view, setView] = useState('WATERFALL');
  const [sidebarTab, setSidebarTab] = useState('INSPECTION');
  
  return <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: '16px' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
      <div style={{ display: 'flex', background: 'rgba(255,255,255,0.03)', padding: '4px', borderRadius: '6px', width: 'fit-content', border: '1px solid rgba(255,255,255,0.06)' }}>
        <button className={`subtle-button ${view === 'WATERFALL' ? 'active' : ''}`} onClick={() => setView('WATERFALL')} style={{ background: view === 'WATERFALL' ? 'rgba(255,255,255,0.1)' : 'transparent', color: view === 'WATERFALL' ? '#fff' : 'rgba(255,255,255,0.5)', borderRadius: '4px', padding: '6px 14px', fontSize: '11px', fontWeight: 'bold' }}>WATERFALL SCOPE</button>
        <button className={`subtle-button ${view === 'RADAR' ? 'active' : ''}`} onClick={() => setView('RADAR')} style={{ background: view === 'RADAR' ? 'rgba(255,255,255,0.1)' : 'transparent', color: view === 'RADAR' ? '#fff' : 'rgba(255,255,255,0.5)', borderRadius: '4px', padding: '6px 14px', fontSize: '11px', fontWeight: 'bold' }}>TACTICAL RADAR</button>
      </div>
      {view === 'WATERFALL' && (
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)', letterSpacing: '0.06em' }}>INSPECTOR VIEW:</span>
          <div style={{ display: 'flex', background: 'rgba(255,255,255,0.03)', padding: '3px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.06)' }}>
            <button className={`subtle-button ${sidebarTab === 'INSPECTION' ? 'active' : ''}`} onClick={() => setSidebarTab('INSPECTION')} style={{ background: sidebarTab === 'INSPECTION' ? 'rgba(117,201,191,0.15)' : 'transparent', color: sidebarTab === 'INSPECTION' ? '#75c9bf' : 'rgba(255,255,255,0.6)', borderRadius: '4px', padding: '4px 10px', fontSize: '10px', fontWeight: 'bold' }}>OBSERVATION & REC</button>
            <button className={`subtle-button ${sidebarTab === 'COMPARE' ? 'active' : ''}`} onClick={() => setSidebarTab('COMPARE')} style={{ background: sidebarTab === 'COMPARE' ? 'rgba(117,201,191,0.15)' : 'transparent', color: sidebarTab === 'COMPARE' ? '#75c9bf' : 'rgba(255,255,255,0.6)', borderRadius: '4px', padding: '4px 10px', fontSize: '10px', fontWeight: 'bold' }}>EXPLAIN & ARBITRATE</button>
          </div>
        </div>
      )}
    </div>
    
    {view === 'WATERFALL' ? (
      <div className="live-spectrum-layout" style={{ flex: '1 1 auto', margin: 0 }}>
        <Waterfall onSelectBand={() => setSidebarTab('COMPARE')} />
        <aside className="live-inspector" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {sidebarTab === 'INSPECTION' ? (
            <>
              <Observation onNavigate={onNavigate} />
              <Recommendation onNavigate={onNavigate} onViewDecision={() => onNavigate('Decision history')} onViewCompare={() => setSidebarTab('COMPARE')} />
            </>
          ) : (
            <BandComparison onBackToInspect={() => setSidebarTab('INSPECTION')} />
          )}
          <Panel className="receiver-readout">
            <div className="eyebrow">RECEIVER POSITION</div>
            <div className="receiver-readout-main"><Mono>{receiver.currentFrequencyGHz.toFixed(3)}</Mono><span>GHz</span><Status tone={receiver.isRetuning ? 'amber' : 'teal'}>{receiver.isRetuning ? 'RETUNING' : receiver.mode}</Status></div>
            <div className="receiver-position-track"><i /></div>
            <div className="receiver-range"><Mono>{constraints.frequencyMinGHz.toFixed(2)} GHz</Mono><Mono>{constraints.frequencyMaxGHz.toFixed(2)} GHz</Mono></div>
          </Panel>
        </aside>
      </div>
    ) : (
      <RadarScopeView />
    )}
  </div>;
}

function ScanStrategyPage() {
  const rows = useSimulationStore(s => s.bandBeliefs);
  const constraints = useSimulationStore(s => s.receiverConstraints);
  const scanPolicy = constraints.optimizationPolicy;
  const receivers = useSimulationStore(s => s.receivers);
  const slots = useSimulationStore(s => s.scanSchedule);
  const latestDecision = useSimulationStore(s => s.scanDecisions[0]);
  const queueSortMode = useSimulationStore(s => s.queueSortMode) || 'OBSERVATION_VALUE';
  const reorderQueue = useSimulationStore(s => s.reorderQueue);
  const moveQueueItem = useSimulationStore(s => s.moveQueueItem);
  const commitPlan = useSimulationStore(s => s.commitPlan);
  const [showSortMenu, setShowSortMenu] = useState(false);
  const [committedFeedback, setCommittedFeedback] = useState(false);

  const windowTicks = Array.from({ length: 6 }, (_, i) => i === 0 ? 'NOW' : `${(constraints.scanWindowSeconds / 5 * i).toFixed(0)}s`);
  const constraintRows = [['BANDWIDTH', `${constraints.bandwidthMHz} MHz`], ['DWELL LIMIT', `≤ ${constraints.dwellLimitMs} ms`], ['RETUNE DELAY', `${constraints.retuningDelayMs} ms`], ['SCAN BUDGET', `${constraints.scanBudgetSeconds.toFixed(1)} s / ${constraints.scanWindowSeconds} s`], ['RECEIVERS', `${String(receivers.filter(r => r.active).length).padStart(2, '0')} AVAILABLE`]];

  const handleReorder = (mode) => {
    reorderQueue(mode);
    setShowSortMenu(false);
    window.dispatchEvent(new CustomEvent("kavach-toast", { detail: `Queue reordered by ${mode.toLowerCase().replace('_', ' ')}.` }));
  };

  const handleCommit = () => {
    const source = useSimulationStore.getState().dataSource;
    if (source === "LIVE") {
      void startScenario().catch(error => window.dispatchEvent(new CustomEvent("kavach-toast", { detail: error.message })));
    } else {
      commitPlan();
      setCommittedFeedback(true);
      setTimeout(() => setCommittedFeedback(false), 2200);
    }
  };

  return <div className="planning-page"><div className="constraint-strip">{constraintRows.map(([label, value]) => <div key={label}><span className="eyebrow">{label}</span><Mono>{value}</Mono></div>)}</div>
    <Panel className="queue-panel"><div className="panel-heading compact"><div><div className="eyebrow">PRIORITY QUEUE · {String(rows.length).padStart(2, '0')} TARGETS · {queueSortMode.replace('_', ' ')}</div><h3>Planned observations</h3></div><PageHeaderActions>
      <div className="reorder-container">
        <button className="subtle-button" onClick={() => setShowSortMenu(prev => !prev)}>REORDER QUEUE <SlidersHorizontal size={13} /></button>
        {showSortMenu && (
          <div className="reorder-dropdown">
            <button className={`reorder-item-btn ${queueSortMode === 'OBSERVATION_VALUE' ? 'active' : ''}`} onClick={() => handleReorder('OBSERVATION_VALUE')}><span>Observation Value (Smart Scan)</span>{queueSortMode === 'OBSERVATION_VALUE' && <Check size={12} />}</button>
            <button className={`reorder-item-btn ${queueSortMode === 'ACTIVITY' ? 'active' : ''}`} onClick={() => handleReorder('ACTIVITY')}><span>Highest Activity %</span>{queueSortMode === 'ACTIVITY' && <Check size={12} />}</button>
            <button className={`reorder-item-btn ${queueSortMode === 'UNCERTAINTY' ? 'active' : ''}`} onClick={() => handleReorder('UNCERTAINTY')}><span>Highest Uncertainty %</span>{queueSortMode === 'UNCERTAINTY' && <Check size={12} />}</button>
            <button className={`reorder-item-btn ${queueSortMode === 'FREQUENCY' ? 'active' : ''}`} onClick={() => handleReorder('FREQUENCY')}><span>Frequency (Low → High)</span>{queueSortMode === 'FREQUENCY' && <Check size={12} />}</button>
            <button className={`reorder-item-btn ${queueSortMode === 'DWELL' ? 'active' : ''}`} onClick={() => handleReorder('DWELL')}><span>Dwell Time (Shortest)</span>{queueSortMode === 'DWELL' && <Check size={12} />}</button>
            <button className="reorder-item-btn" onClick={() => handleReorder('REVERSE')}><span>Invert Current Order</span></button>
          </div>
        )}
      </div>
      <button className={`button-secondary queue-run ${committedFeedback ? 'plan-committed-active' : ''}`} onClick={handleCommit} style={committedFeedback ? { background: 'rgba(117,201,191,0.25)', borderColor: 'var(--teal)', color: '#fff' } : {}}>
        {committedFeedback ? 'PLAN COMMITTED ✓' : 'COMMIT PLAN'} {committedFeedback ? <Check size={14} /> : <ChevronRight size={14} />}
      </button>
    </PageHeaderActions></div>
      <div className="queue-head"><span>RANK</span><span>FREQUENCY BAND</span><span>ACTIVITY</span><span>UNCERTAINTY</span><span>OBSERVATION VALUE</span><span>DWELL</span><span>STATE</span><span>ORDER</span></div>
      {rows.map((row, i) => <div key={row.bandId} className={`queue-row ${row.queueStatus === 'NEXT' ? 'queue-next' : ''}`}><Mono className="queue-rank">{String(row.rank).padStart(2, '0')}</Mono><div className="queue-band"><b>{row.band}</b><Mono>{row.frequencyStartGHz.toFixed(2)}–{row.frequencyEndGHz.toFixed(2)} GHz</Mono></div><div className="queue-percent"><div className="mini-track"><i style={{ width: `${row.activityPercent}%` }} /></div><Mono>{row.activityPercent}%</Mono></div><Mono className="uncertainty">{row.uncertaintyPercent}%</Mono><div className="value-cell"><div className="value-track"><i style={{ width: `${row.observationValue}%` }} /></div><Mono>{row.observationValue}</Mono></div><Mono className="dwell-cell">{row.dwellMs} ms</Mono><Status tone={row.queueStatus === 'NEXT' ? 'teal' : 'quiet'}>{row.queueStatus}</Status>
        <div className="queue-reorder-actions">
          <button className="queue-move-btn" disabled={i === 0} title="Move up in priority" onClick={() => moveQueueItem(i, i - 1)}><ChevronUp size={12} /></button>
          <button className="queue-move-btn" disabled={i === rows.length - 1} title="Move down in priority" onClick={() => moveQueueItem(i, i + 1)}><ChevronDown size={12} /></button>
        </div>
      </div>)}
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
  if (observations.some(obs => obs.classification === 'SCANNING BEAM' || obs.classification === 'SCANNING_BEAM' || obs.scenarioLabel?.toLowerCase().includes('scanning'))) return 'Scanning Beam';
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
      <Panel className="pdw-panel"><div className="panel-heading compact"><div><div className="eyebrow">PDW INSPECTOR · {filteredPdws.length} MATCHES</div><h3>Observed pulse descriptors</h3></div><Mono>{page}/{pageCount}</Mono></div><div className="pdw-filter-grid"><input placeholder="Scenario / classification / ID" value={filter.search} onChange={event => updateFilter('search', event.target.value)} /><input placeholder="Freq min GHz" type="number" value={filter.frequencyMin} onChange={event => updateFilter('frequencyMin', event.target.value)} /><input placeholder="Freq max GHz" type="number" value={filter.frequencyMax} onChange={event => updateFilter('frequencyMax', event.target.value)} /><input placeholder="ToA from HH:MM:SS.mmm" value={filter.toaFrom} onChange={event => updateFilter('toaFrom', event.target.value)} /><input placeholder="ToA to HH:MM:SS.mmm" value={filter.toaTo} onChange={event => updateFilter('toaTo', event.target.value)} /><input placeholder="AoA min deg" type="number" value={filter.aoaMin} onChange={event => updateFilter('aoaMin', event.target.value)} /><input placeholder="AoA max deg" type="number" value={filter.aoaMax} onChange={event => updateFilter('aoaMax', event.target.value)} /><input placeholder="Amplitude min dBm" type="number" value={filter.amplitudeMin} onChange={event => updateFilter('amplitudeMin', event.target.value)} /><input placeholder="Amplitude max dBm" type="number" value={filter.amplitudeMax} onChange={event => updateFilter('amplitudeMax', event.target.value)} /></div><div className="table-head pdw-head"><span>TOA</span><span>FREQUENCY / AOA</span><span>CLASSIFICATION</span><span>AMPLITUDE</span><span>RESULT</span></div>{pageRows.map(pdw => <div className="pdw-row" key={pdw.id}><Mono>{pdw.timestamp}</Mono><Mono>{pdw.centerFrequencyGHz.toFixed(4)} GHz / {(pdw.aoaDeg ?? 0).toFixed(0)}°</Mono><Status tone={pdw.classification === 'SCANNING BEAM' ? 'amber' : pdw.classification === 'FREQUENCY HOP' ? 'green' : 'quiet'}>{pdw.classification || 'PULSE TRAIN'}</Status><Mono>{pdw.amplitudeDbm.toFixed(1)} dBm</Mono><Status tone={pdw.result === 'HIT' ? 'green' : pdw.result === 'MISS' ? 'quiet' : 'amber'}>{pdw.result}</Status></div>)}<div className="pdw-pagination"><button className="subtle-button" disabled={page <= 1} onClick={() => setPage(current => current - 1)}>PREVIOUS</button><Mono>{filteredPdws.length ? `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, filteredPdws.length)}` : '0'} / {filteredPdws.length}</Mono><button className="subtle-button" disabled={page >= pageCount} onClick={() => setPage(current => current + 1)}>NEXT</button></div></Panel></div> : <Panel className="empty-panel"><h3>Awaiting observed PDWs</h3><p>Start a scenario to build derived emitter clusters and populate the inspector.</p></Panel>}
  </div>;
}

function MiniSpectrum({ bursts }) { return <svg viewBox="0 0 160 52" className="mini-spectrum"><path d="M0 43H160M0 27H160M0 10H160" stroke="rgba(200,220,214,.1)" strokeDasharray="2 4" />{bursts.map((burst, i) => <rect key={i} x={burst.x} y={burst.y} width={burst.width} height="2" rx="1" fill={burst.tone === 'amber' ? '#d5a56a' : '#75c9bf'} opacity={burst.opacity} />)}</svg>; }
function ScenarioLabPage({ onNavigate = () => {} }) {
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
  const loadScenario = () => { if (dataSource === 'LIVE') void loadBackendScenario(config).then(getSimulationState).then(state => useSimulationStore.getState().applyBackendDelta({ type: 'full_state', version: 1, ...state })).catch(error => window.dispatchEvent(new CustomEvent('kavach-toast', { detail: error.message }))); else resetSimulation(false); };
  const startDemo = () => { if (dataSource === 'LIVE') { window.dispatchEvent(new CustomEvent('kavach-toast', { detail: 'Live mode replays the recorded TSRD pulse train. Use Start Dataset Replay.' })); return; } const demo = scenarios.find(scenario => scenario.id === 'adaptive-multi-emitter') || scenarios[0]; const demoConfig = { scenarioId: demo.id, emitterCount: demo.defaultEmitterCount, durationSeconds: demo.defaultDurationSeconds, seed: demo.defaultSeed }; selectScenario(demo); startSimulation(demoConfig); onNavigate('Command center'); };
  
  const handleStartSimulation = () => {
    if (dataSource === 'LIVE') {
      syncLiveState()
        .then(() => onNavigate('Command center'))
        .catch(error => window.dispatchEvent(new CustomEvent('kavach-toast', { detail: error.message })));
    } else {
      startSimulation(config);
      onNavigate('Command center');
    }
  };

  return <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', height: '100%' }}>
    {/* HERO SECTION FOR SELECTED SCENARIO */}
    <Panel style={{ position: 'relative', overflow: 'hidden', padding: '40px', flex: '0 0 auto', display: 'flex', gap: '40px', alignItems: 'center', background: 'linear-gradient(135deg, rgba(20,25,23,1) 0%, rgba(10,15,13,1) 100%)' }}>
      <div style={{ position: 'absolute', top: '-50%', left: '-20%', width: '140%', height: '200%', background: 'radial-gradient(ellipse at center, rgba(117,201,191,0.05) 0%, transparent 60%)', pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', right: '5%', top: '0', bottom: '0', width: '600px', display: 'flex', flexDirection: 'column', justifyContent: 'center', opacity: 0.05, pointerEvents: 'none' }}>
         <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: '100%', height: '80%' }}>
           <path d="M0,50 Q25,10 50,50 T100,50" fill="none" stroke="#75c9bf" strokeWidth="1" />
           <path d="M0,40 Q25,80 50,40 T100,40" fill="none" stroke="#75c9bf" strokeWidth="0.5" />
           <path d="M0,60 Q25,20 50,60 T100,60" fill="none" stroke="#75c9bf" strokeWidth="0.5" />
           <path d="M0,30 Q25,90 50,30 T100,30" fill="none" stroke="#75c9bf" strokeWidth="0.2" />
           <path d="M0,70 Q25,10 50,70 T100,70" fill="none" stroke="#75c9bf" strokeWidth="0.2" />
         </svg>
      </div>

      <div style={{ flex: '1 1 auto', zIndex: 1 }}>
        <div className="eyebrow" style={{ color: '#75c9bf', marginBottom: '12px', fontSize: '11px', letterSpacing: '0.15em' }}>SELECTED ENVIRONMENT</div>
        <h2 style={{ fontSize: '32px', fontWeight: '300', margin: '0 0 12px 0', textShadow: '0 2px 10px rgba(0,0,0,0.5)', letterSpacing: '-0.02em' }}>{selected.name}</h2>
        <p style={{ fontSize: '14px', color: 'rgba(255,255,255,0.7)', maxWidth: '600px', lineHeight: '1.6', margin: '0 0 32px 0' }}>{selected.description}</p>
        
        <div style={{ display: 'flex', gap: '20px' }}>
          <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)', padding: '16px 24px', borderRadius: '8px' }}>
            <span className="eyebrow" style={{ display: 'block', marginBottom: '8px' }}>DEFAULT DENSITY</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <Mono style={{ fontSize: '24px', color: '#fff' }}>{selected.defaultEmitterCount}</Mono>
              <span className="muted" style={{ fontSize: '10px' }}>EMITTERS</span>
            </div>
          </div>
          <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)', padding: '16px 24px', borderRadius: '8px' }}>
            <span className="eyebrow" style={{ display: 'block', marginBottom: '8px' }}>SCENARIO LENGTH</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <Mono style={{ fontSize: '24px', color: '#fff' }}>{(selected.defaultDurationSeconds / 60).toFixed(1)}</Mono>
              <span className="muted" style={{ fontSize: '10px' }}>MINUTES</span>
            </div>
          </div>
          <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)', padding: '16px 24px', borderRadius: '8px', flex: '1 1 auto', maxWidth: '300px' }}>
            <span className="eyebrow" style={{ display: 'block', marginBottom: '12px' }}>SPECTRAL PROFILE</span>
            <div>
              <MiniSpectrum bursts={selected.previewBursts} />
            </div>
          </div>
        </div>
      </div>

      <div style={{ flex: '0 0 320px', display: 'flex', flexDirection: 'column', gap: '20px', zIndex: 1, background: 'rgba(0,0,0,0.3)', padding: '28px', borderRadius: '12px', border: '1px solid rgba(117,201,191,0.2)', boxShadow: '0 12px 40px rgba(0,0,0,0.5)', backdropFilter: 'blur(10px)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '16px' }}>
          <span className="eyebrow" style={{ color: '#fff' }}>LAUNCH CONTROLS</span>
          <Status tone={simulationStatus === 'RUNNING' ? 'green' : simulationStatus === 'PAUSED' ? 'amber' : 'quiet'}>{simulationStatus === 'RUNNING' ? 'LIVE DATA' : simulationStatus === 'PAUSED' ? 'PAUSED' : 'SYSTEM IDLE'}</Status>
        </div>
        
        {dataSource === 'LIVE' ? (
           <div className="dataset-note" style={{ margin: 0 }}>
             <span className="eyebrow">SOURCE</span>
             <b>TSRD recorded pulse dataset</b>
             <small>Original pulse timing is replayed at 2Hz.</small>
           </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <label className="config-control" style={{ margin: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}><span style={{ fontSize: '11px', fontWeight: 'bold' }}>EMITTER COUNT</span><Mono style={{ color: '#75c9bf', fontSize: '13px' }}>{config.emitterCount}</Mono></div>
              <input type="range" min="1" max="32" value={config.emitterCount} onChange={e => updateConfig({ emitterCount: Number(e.target.value) })} style={{ width: '100%', accentColor: '#75c9bf' }} />
            </label>
            <label className="config-control" style={{ margin: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}><span style={{ fontSize: '11px', fontWeight: 'bold' }}>DURATION (SEC)</span><Mono style={{ color: '#75c9bf', fontSize: '13px' }}>{config.durationSeconds}</Mono></div>
              <input type="range" min="60" max="900" step="30" value={config.durationSeconds} onChange={e => updateConfig({ durationSeconds: Number(e.target.value) })} style={{ width: '100%', accentColor: '#75c9bf' }} />
            </label>
          </div>
        )}
        
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '8px' }}>
          <button className="button-primary run-scenario" onClick={handleStartSimulation} style={{ width: '100%', padding: '14px', justifyContent: 'center', fontSize: '12px' }}>
            {dataSource === 'LIVE' ? 'START DATASET REPLAY' : 'LAUNCH SIMULATION'} <ChevronRight size={14} />
          </button>
          {dataSource === 'OFFLINE' && (
             <button className="button-secondary" onClick={startDemo} style={{ width: '100%', padding: '12px', justifyContent: 'center', fontSize: '11px', background: 'rgba(255,255,255,0.05)' }}>
               START QUICK DEMO <ChevronRight size={13} />
             </button>
          )}
        </div>
      </div>
    </Panel>

    {/* CATALOG GRID */}
    <div style={{ flex: '1 1 auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div className="eyebrow" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 4px' }}>
        <span>SCENARIO CATALOG</span>
        <span style={{ color: 'rgba(255,255,255,0.4)' }}>{scenarios.length} AVAILABLE ENVIRONMENTS</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px', paddingBottom: '24px' }}>
        {scenarios.map((scenario, i) => (
          <button 
            className={`panel ${selected.id === scenario.id ? 'scenario-selected' : ''}`} 
            key={scenario.id} 
            onClick={() => selectScenario(scenario)}
            style={{ 
              textAlign: 'left', 
              padding: '24px', 
              display: 'flex', 
              flexDirection: 'column', 
              gap: '12px',
              transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
              border: selected.id === scenario.id ? '1px solid rgba(117,201,191,0.5)' : '1px solid rgba(255,255,255,0.05)',
              background: selected.id === scenario.id ? 'rgba(117,201,191,0.08)' : 'rgba(255,255,255,0.02)',
              cursor: 'pointer',
              position: 'relative',
              overflow: 'hidden',
              minHeight: '180px'
            }}
          >
            {selected.id === scenario.id && <div style={{ position: 'absolute', top: 0, left: 0, width: '4px', height: '100%', background: '#75c9bf', boxShadow: '0 0 10px #75c9bf' }} />}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', width: '100%' }}>
              <Mono style={{ color: selected.id === scenario.id ? '#75c9bf' : 'rgba(255,255,255,0.4)', fontSize: '11px' }}>OP-{String(i + 1).padStart(2, '0')}</Mono>
              {selected.id === scenario.id && <Status tone="teal">ACTIVE</Status>}
            </div>
            <div style={{ marginTop: '4px' }}>
              <b style={{ fontSize: '16px', color: selected.id === scenario.id ? '#fff' : 'rgba(255,255,255,0.9)', display: 'block', marginBottom: '8px' }}>{scenario.name}</b>
              <span style={{ fontSize: '13px', color: 'rgba(255,255,255,0.5)', lineHeight: '1.4', display: 'block' }}>{scenario.description}</span>
            </div>
            <div style={{ marginTop: 'auto', paddingTop: '16px', opacity: selected.id === scenario.id ? 1 : 0.4, transition: 'opacity 0.2s ease' }}>
              <MiniSpectrum bursts={scenario.previewBursts} />
            </div>
          </button>
        ))}
      </div>
    </div>
  </div>;
}

function DecisionHistoryPage() {
  const decisions = useSimulationStore(s => s.decisionHistory);
  const [expanded, setExpanded] = useState(decisions.length && decisions[0].action === 'OPERATOR_OVERRIDE' ? decisions[0].id : null);
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
  const doExport = async format => { try { const blob = source === 'LIVE' ? await exportHistory(format, { result: resultFilter || undefined, band: bandFilter || undefined }) : new Blob([format === 'json' ? JSON.stringify(visibleDecisions, null, 2) : [Object.keys(visibleDecisions[0] || {}).join(','), ...visibleDecisions.map(row => Object.values(row).join(','))].join('\n')], { type: format === 'json' ? 'application/json' : 'text/csv' }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `kavach-decision-history.${format}`; link.click(); URL.revokeObjectURL(url); setExportOpen(false); } catch (error) { setHistoryError(error.message); } };
  return <div className="history-page"><Panel className="reward-strip"><div className="reward-strip-label"><div className="eyebrow">REWARD / OUTCOME TRACE</div><div><Mono>+{metrics.meanReward.toFixed(2)}</Mono><span>MEAN REWARD · LAST 60 DECISIONS</span></div></div><Sparkline values={rewards} color="#89b59b" /><div className="reward-strip-stat"><span className="eyebrow">HIT RATE</span><Mono>{metrics.hitRatePercent.toFixed(1)}%</Mono></div><div className="reward-strip-stat"><span className="eyebrow">POLICY VERSION</span><Mono>{metrics.policyVersion}</Mono></div></Panel>
    <Panel className="history-table-panel"><div className="panel-heading compact"><div><div className="eyebrow">DECISION LOG · {source === 'LIVE' ? remote.total : metrics.decisionCount.toLocaleString()} TOTAL</div><h3>Recent policy actions</h3></div><PageHeaderActions><button className="subtle-button" onClick={() => setFilterOpen(open => !open)}>FILTER <ChevronDown size={12} /></button><button className="subtle-button" onClick={() => setExportOpen(open => !open)}>EXPORT <ArrowDownRight size={12} /></button>{exportOpen && <div className="history-export-menu"><button onClick={() => void doExport('csv')}>DOWNLOAD CSV</button><button onClick={() => void doExport('json')}>DOWNLOAD JSON</button></div>}</PageHeaderActions></div>
      {filterOpen && <div className="history-filter-controls"><label>RESULT<select value={resultFilter} onChange={event => { setPage(0); setResultFilter(event.target.value); }}><option value="">ALL</option><option value="HIT">HIT</option><option value="MISS">MISS</option></select></label><label>BAND<input value={bandFilter} onChange={event => { setPage(0); setBandFilter(event.target.value); }} placeholder="Filter by band" /></label><button className="text-action" onClick={() => { setResultFilter(''); setBandFilter(''); setPage(0); }}>CLEAR</button></div>}
      {historyError && <div className="empty-table-state"><b>History query failed</b><span>{historyError}</span></div>}
      <div className="history-head"><span>DECISION / TIME</span><span>POLICY ACTION</span><span>TARGET BAND</span><span>OUTCOME REWARD</span><span>STATE</span></div>{!visibleDecisions.length && <div className="empty-table-state"><b>No decisions found</b><span>{source === 'LIVE' ? 'Run a live scenario to build persisted history.' : 'No decisions match these filters.'}</span></div>}{visibleDecisions.map(d => <React.Fragment key={d.id}><button className={`history-row ${expanded === d.id ? 'expanded' : ''}`} onClick={() => setExpanded(expanded === d.id ? null : d.id)}><span><Mono>{d.id}</Mono><small>{d.timestamp}Z</small></span><b>{d.action}</b><Mono>{d.band}</Mono><Status tone={d.result === 'HIT' ? 'green' : 'amber'}>{d.result} · {d.reward >= 0 ? '+' : ''}{d.reward.toFixed(2)}</Status><ChevronDown size={14} /></button><AnimatePresence>{expanded === d.id && <motion.div className="decision-drawer" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: .28, ease }}><div><span className="eyebrow">BELIEF SNAPSHOT</span><p>{(d.predictedActivity * 100).toFixed(1)}% predicted activity · {(d.uncertainty * 100).toFixed(1)}% uncertainty · {d.dwellMs} ms dwell</p></div><div><span className="eyebrow">REWARD FORMULA</span><p>+{d.rewardComponents.detectionBenefit.toFixed(2)} detection −{d.rewardComponents.delayPenalty.toFixed(2)} delay −{d.rewardComponents.scanCost.toFixed(2)} cost −{d.rewardComponents.missPenalty.toFixed(2)} miss −{d.rewardComponents.stalenessPenalty.toFixed(2)} stale = {d.reward.toFixed(2)}</p></div><div><span className="eyebrow">OUTCOME</span><p>{d.outcome}{d.interceptionTimeMs === null ? '' : ` Interception time ${d.interceptionTimeMs} ms.`}</p></div></motion.div>}</AnimatePresence></React.Fragment>)}
      <div className="pdw-pagination"><button className="subtle-button" disabled={!page} onClick={() => setPage(value => value - 1)}>PREVIOUS</button><Mono>{total ? `${page * 50 + 1}–${Math.min((page + 1) * 50, total)} / ${total}` : '0 / 0'}</Mono><button className="subtle-button" disabled={(page + 1) * 50 >= total} onClick={() => setPage(value => value + 1)}>NEXT</button></div>
    </Panel>
  </div>;
}

const PPO_EVALUATION_REPORT = {
  headline: {
    smartRate: '19.7%',
    smartScanningBeamRate: '63.3%',
    smartScanningBeamToi: '2.9 ms',
    smartPredAccuracy: '17.4%',
    smartTimeError: '242.0 ms',
    greedyRate: '99.3%',
    greedyScanningBeamRate: '10.0%',
    greedyScanningBeamToi: '4.4 ms',
    sweepRate: '1.7%',
    sweepScanningBeamRate: '4.2%',
    evalRuns: 10,
  },
  ablations: [
    { name: 'PPO only', detection: '5.7%', toi: '3.7 ms', correctPred: '5.7%', timeErr: '92.3 ms', sbRate: '0.0%', reward: '-10.82', status: 'TRAINED PPO' },
    { name: 'PPO + Temporal Intelligence', detection: '12.0%', toi: '22.6 ms', correctPred: '17.5%', timeErr: '241.6 ms', sbRate: '48.3%', reward: '-8.19', status: 'TRAINED PPO' },
    { name: 'PPO + Change Detection', detection: '5.7%', toi: '64.0 ms', correctPred: '5.7%', timeErr: '144.0 ms', sbRate: '0.0%', reward: '-10.82', status: 'TRAINED PPO' },
    { name: 'PPO + Temporal + Change', detection: '19.7%', toi: '13.4 ms', correctPred: '17.4%', timeErr: '242.0 ms', sbRate: '63.3%', reward: '-5.15', status: 'TRAINED PPO' },
    { name: 'Complete Smart Scan', detection: '19.7%', toi: '13.4 ms', correctPred: '17.4%', timeErr: '242.0 ms', sbRate: '63.3%', reward: '-5.15', status: 'TRAINED PPO' },
  ],
  baselines: [
    { name: 'Complete Smart Scan (PPO)', detection: '19.7%', toi: '13.4 ms', correctPred: '17.4%', timeErr: '242.0 ms', sbRate: '63.3%', reward: '-5.15', status: 'TRAINED MODEL' },
    { name: 'Greedy Activity', detection: '99.3%', toi: '13.9 ms', correctPred: '97.2%', timeErr: '230.2 ms', sbRate: '10.0%', reward: '+25.53', status: 'BASELINE' },
    { name: 'Sequential Sweep', detection: '1.7%', toi: '0.0 ms', correctPred: '1.0%', timeErr: '120.0 ms', sbRate: '4.2%', reward: '-12.43', status: 'BASELINE' },
    { name: 'Random', detection: '1.0%', toi: '0.0 ms', correctPred: '0.7%', timeErr: '72.0 ms', sbRate: '0.0%', reward: '-14.71', status: 'ILLUSTRATIVE BASELINE' },
    { name: 'Thompson Sampling', detection: '1.7%', toi: '0.0 ms', correctPred: '0.3%', timeErr: '72.0 ms', sbRate: '1.0%', reward: '-14.52', status: 'ILLUSTRATIVE BASELINE' },
  ]
};

function PerformancePage() {
  const performanceSeries = useSimulationStore(s => s.performanceMetrics);
  const kpis = useSimulationStore(s => s.performanceKpis);
  const baselines = useSimulationStore(s => s.performanceBaselines);
  const metrics = useSimulationStore(s => s.operationalMetrics);

  const getKpiTooltip = (label) => {
    if (label === 'PERCENTAGE OF CORRECT PREDICTIONS') {
      return 'PERCENTAGE OF CORRECT PREDICTIONS: Of all bands where predictedActivity exceeded 60% confidence for an upcoming window, the percentage followed by an actual HIT within that window.';
    }
    if (label === 'AVERAGE INTERCEPT TIME ERROR') {
      return 'AVERAGE INTERCEPT TIME ERROR: For bands with a temporal prediction, the average absolute difference between the predicted activation time and actual observed activation time (when a HIT occurred).';
    }
    if (label === 'INTERCEPTION RATE') {
      return 'Percentage of dwells that intercepted an active transmission.';
    }
    if (label === 'AVERAGE INTERCEPTION TIME') {
      return 'Time elapsed from emitter onset to first receiver dwell.';
    }
    return undefined;
  };

  return <div className="performance-page">
    {/* Headline Trained Model Evaluation Panel */}
    <Panel className="trained-evaluation-panel" style={{ padding: '16px 20px', background: 'linear-gradient(90deg, rgba(117,201,191,0.08) 0%, rgba(20,25,23,0.6) 100%)', border: '1px solid rgba(117,201,191,0.25)', marginBottom: '16px', borderRadius: '8px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: '#75c9bf', boxShadow: '0 0 8px #75c9bf' }} />
          <div>
            <div className="eyebrow" style={{ color: '#75c9bf', marginBottom: '2px' }}>ML-BASED SCHEDULER · TRAINED PPO POLICY EVALUATION</div>
            <div style={{ fontSize: '13px', fontWeight: '500', color: 'rgba(255,255,255,0.92)' }}>
              Trained policy achieved <b>{PPO_EVALUATION_REPORT.headline.smartScanningBeamRate}</b> interception rate on Spatially Scanning Beam targets vs <b>{PPO_EVALUATION_REPORT.headline.greedyScanningBeamRate}</b> for greedy baseline across {PPO_EVALUATION_REPORT.headline.evalRuns} evaluation runs
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
          <div style={{ textAlign: 'right' }}>
            <span className="eyebrow" style={{ display: 'block', fontSize: '9px' }}>SCANNING BEAM RATE</span>
            <Mono style={{ color: '#75c9bf', fontSize: '13px', fontWeight: 'bold' }}>{PPO_EVALUATION_REPORT.headline.smartScanningBeamRate} vs {PPO_EVALUATION_REPORT.headline.greedyScanningBeamRate}</Mono>
          </div>
          <div style={{ textAlign: 'right' }}>
            <span className="eyebrow" style={{ display: 'block', fontSize: '9px' }}>SCANNING BEAM TOI</span>
            <Mono style={{ color: '#d5a56a', fontSize: '13px', fontWeight: 'bold' }}>{PPO_EVALUATION_REPORT.headline.smartScanningBeamToi}</Mono>
          </div>
          <div style={{ textAlign: 'right' }}>
            <span className="eyebrow" style={{ display: 'block', fontSize: '9px' }}>CORRECT PREDICTIONS</span>
            <Mono style={{ color: '#68d391', fontSize: '13px', fontWeight: 'bold' }}>{PPO_EVALUATION_REPORT.headline.smartPredAccuracy}</Mono>
          </div>
        </div>
      </div>
    </Panel>

    <div className="performance-kpis">
      {kpis.map(([l, v, d]) => (
        <div className="performance-kpi" key={l} title={getKpiTooltip(l)}>
          <span className="eyebrow">{l}</span>
          <div><Mono>{v}</Mono><small>{d}</small></div>
        </div>
      ))}
    </div>
    <div className="performance-chart-grid">{performanceSeries.map(series => <Panel key={series.key} className="performance-chart-card"><div className="perf-chart-head"><span className="eyebrow">{series.title}</span><button className="chart-menu" aria-label={`Export ${series.title} chart data`} title="Download chart data as CSV" onClick={() => { const csv = `metric,value\n${series.title},${series.values.join(";")}`; const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); link.download = `${series.key}-metrics.csv`; link.click(); URL.revokeObjectURL(link.href); }}>···</button></div><div className="perf-chart-value"><Mono>{series.values.at(-1)}{series.unit}</Mono><span>LAST 60 MIN</span></div><div className="perf-chart"><Suspense fallback={<div className="chart-loading">LOADING METRICS…</div>}><DataChart kind="area" data={series} /></Suspense></div></Panel>)}</div>
    <Panel className="benchmark-panel"><div className="panel-heading compact"><div><div className="eyebrow">BENCHMARK COMPARISON</div><h3>Policy performance by baseline</h3></div><span className="eyebrow">EVALUATION SET · N={metrics.evaluationSetSize.toLocaleString()}</span></div><div className="benchmark-head"><span>POLICY</span><span>DETECTION</span><span>MEDIAN TOI</span><span>COVERAGE</span><span>REWARD</span><span>STATUS</span></div>{baselines.map((r, i) => <div className="benchmark-row" key={r[0]} title={i === baselines.length - 1 ? 'Current live run' : r[5] === 'ILLUSTRATIVE BASELINE' ? 'Illustrative baseline' : 'Trained model evaluation'}><span key={0}><b>{r[0]}</b></span><span key={1}><Mono>{r[1]}</Mono></span><span key={2}><Mono>{r[2]}</Mono></span><span key={3}><Mono>{r[3]}</Mono></span><span key={4}><Mono>{r[4]}</Mono></span><span key={5}><Status tone={r[5] === 'CURRENT RUN' ? 'green' : r[5] === 'ILLUSTRATIVE BASELINE' ? 'quiet' : 'teal'}>{r[5]}</Status></span></div>)}</Panel>
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
  useEffect(() => { const syncAuth = () => setAuthRole(getAuthSession()?.role ?? null); window.addEventListener('kavach-auth-changed', syncAuth); return () => window.removeEventListener('kavach-auth-changed', syncAuth); }, []);
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
    if (tab === 'Baselines') return <Panel className="research-state-panel"><div className="research-panel-head"><div><div className="eyebrow">TRAINED PPO VS BASELINES · HELD-OUT SCENARIOS (N=10)</div><h3>Statistically Defensible Policy Benchmarks</h3></div><button className="subtle-button" onClick={baselineAction}>RUN COMPARISON</button></div><div className="research-disclosure">Benchmark evaluation on held-out test split with multi-seed variance. Complete Smart Scan uses the real trained PPO checkpoint (<Mono>complete_smart_scan/final.zip</Mono>).</div><div className="benchmark-head" style={{ gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1fr 1fr' }}><span>POLICY</span><span>INTERCEPTION</span><span>TOI</span><span>% CORRECT</span><span>TIME ERR</span><span>SCAN BEAM</span><span>STATUS</span></div>{PPO_EVALUATION_REPORT.baselines.map(row => <div className="benchmark-row" key={row.name} style={{ gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1fr 1fr' }}><span><b>{row.name}</b></span><span><Mono>{row.detection}</Mono></span><span><Mono>{row.toi}</Mono></span><span><Mono>{row.correctPred}</Mono></span><span><Mono>{row.timeErr}</Mono></span><span><Mono style={{ color: row.sbRate !== '0.0%' ? '#75c9bf' : undefined }}>{row.sbRate}</Mono></span><span><Status tone={row.status === 'TRAINED MODEL' ? 'green' : row.status === 'BASELINE' ? 'teal' : 'quiet'}>{row.status}</Status></span></div>)}</Panel>;
    if (tab === 'Ablation') return <Panel className="research-state-panel"><div className="research-panel-head"><div><div className="eyebrow">PPO ARCHITECTURE ABLATION LADDER · REAL TRAINED RUNS</div><h3>Impact of Temporal Intelligence & Change Detection</h3></div><Mono>SEED 7419 · N=10</Mono></div><div className="research-disclosure">Ablation ladder evaluated across 10 seeded episodes. Shows progression from base PPO to Complete Smart Scan integrating temporal recurrence and agile frequency shift detection.</div><div className="benchmark-head" style={{ gridTemplateColumns: '2.4fr 1fr 1fr 1.2fr 1.2fr 1fr 1fr' }}><span>ABLATION STAGE</span><span>INTERCEPT</span><span>TOI</span><span>% CORRECT</span><span>TIME ERR</span><span>SCAN BEAM</span><span>STATUS</span></div>{PPO_EVALUATION_REPORT.ablations.map(row => <div className="benchmark-row" key={row.name} style={{ gridTemplateColumns: '2.4fr 1fr 1fr 1.2fr 1.2fr 1fr 1fr' }}><span><b>{row.name}</b></span><span><Mono>{row.detection}</Mono></span><span><Mono>{row.toi}</Mono></span><span><Mono>{row.correctPred}</Mono></span><span><Mono>{row.timeErr}</Mono></span><span><Mono style={{ color: row.sbRate !== '0.0%' ? '#75c9bf' : undefined }}>{row.sbRate}</Mono></span><span><Status tone="teal">{row.status}</Status></span></div>)}</Panel>;
    return <Panel className="research-state-panel"><div className="research-panel-head"><div className="eyebrow">SCENARIO CONFIG · LIVE LOADED VALUES</div><Mono>{scenarioConfig.scenarioId}</Mono></div><div className="state-table">{[['scenario', scenarios.find(scenario => scenario.id === scenarioConfig.scenarioId)?.name || scenarioConfig.scenarioId], ['emitterCount', String(scenarioConfig.emitterCount)], ['durationSeconds', String(scenarioConfig.durationSeconds)], ['seed', String(scenarioConfig.seed)], ['frequencyMinGHz', constraints.frequencyMinGHz.toFixed(3)], ['frequencyMaxGHz', constraints.frequencyMaxGHz.toFixed(3)], ['bandwidthMHz', String(constraints.bandwidthMHz)], ['dwellUs', String(constraints.dwellUs)], ['retuningDelayUs', String(constraints.retuningDelayUs)]].map(([key, value]) => <div key={key}><Mono className="state-key">{key}</Mono><Mono className="state-value">{value}</Mono><span className="state-type">LIVE</span></div>)}</div></Panel>;
  };
  return <div className="research-page">
    <div className="research-warning"><Microscope size={15} /><span>RESEARCH SURFACE</span><i />OPERATOR PRESENTATION LAYER DISABLED</div>
    
    {/* Headline Trained Model Evaluation Panel */}
    <Panel className="trained-model-banner" style={{ marginBottom: '16px', padding: '16px 20px', background: 'linear-gradient(135deg, rgba(117,201,191,0.08) 0%, rgba(20,25,23,0.85) 100%)', border: '1px solid rgba(117,201,191,0.28)', borderRadius: '8px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '20px', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 340px' }}>
          <div className="eyebrow" style={{ color: '#75c9bf', marginBottom: '4px' }}>SIH PS EXPECTED SOLUTION: REAL TRAINED ML SCHEDULER</div>
          <h4 style={{ margin: '0 0 6px 0', fontSize: '15px', fontWeight: '600', color: '#fff' }}>PPO Policy Evaluation & Benchmark Verification</h4>
          <p style={{ margin: 0, fontSize: '12px', color: 'rgba(255,255,255,0.72)', lineHeight: '1.5' }}>
            Real PPO model trained on Gymnasium-compatible environment (<Mono>backend/app/ml/scan_env.py</Mono>). Evaluated across {PPO_EVALUATION_REPORT.headline.evalRuns} seeded episodes on held-out scenarios with rotating/directional scanning emitters. Full evidence logged in <Mono>backend/data/reports/ppo_evaluation.md</Mono>.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '24px', flexShrink: 0 }}>
          <div style={{ textAlign: 'center' }}>
            <div className="eyebrow" style={{ fontSize: '9px' }}>SCANNING BEAM RATE</div>
            <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#75c9bf' }}>{PPO_EVALUATION_REPORT.headline.smartScanningBeamRate}</div>
            <small style={{ fontSize: '10px', color: 'rgba(255,255,255,0.5)' }}>vs {PPO_EVALUATION_REPORT.headline.greedyScanningBeamRate} Greedy</small>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div className="eyebrow" style={{ fontSize: '9px' }}>SCANNING BEAM TOI</div>
            <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#d5a56a' }}>{PPO_EVALUATION_REPORT.headline.smartScanningBeamToi}</div>
            <small style={{ fontSize: '10px', color: 'rgba(255,255,255,0.5)' }}>vs {PPO_EVALUATION_REPORT.headline.greedyScanningBeamToi} Greedy</small>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div className="eyebrow" style={{ fontSize: '9px' }}>PREDICTION ACCURACY</div>
            <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#68d391' }}>{PPO_EVALUATION_REPORT.headline.smartPredAccuracy}</div>
            <small style={{ fontSize: '10px', color: 'rgba(255,255,255,0.5)' }}>% Correct Preds</small>
          </div>
        </div>
      </div>
    </Panel>

    <div className="research-disclosure research-disclosure-prominent">Live browser demo uses deterministic simulation for portability. Full trained PPO checkpoints (<Mono>complete_smart_scan/final.zip</Mono>) and multi-seed benchmarks are verified in backend reports.</div>
    {latestDecision?.safetyOverride && <div className="inference-fallback-flag" role="status"><b>DETERMINISTIC FALLBACK ACTIVE</b><span>{latestDecision.fallbackReason || 'Trained policy inference was unavailable; the belief engine supplied this recommendation.'}</span></div>}
    <div className="research-tabs">{tabs.map(t => <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>{t}</button>)}</div>
    {renderTab()}
    <Panel className="research-overlay-panel"><div className="research-panel-head"><div><div className="eyebrow">INFERENCE VALIDATION · FREQUENCY / AOA</div><h3>Derived clusters and evaluation overlay</h3></div><label className="research-toggle"><input type="checkbox" checked={showGroundTruthOverlay} disabled={source === 'LIVE' && authRole !== 'RESEARCHER'} onChange={event => void toggleTruthOverlay(event.target.checked)} /><span>{source === 'LIVE' && authRole !== 'RESEARCHER' ? 'RESEARCHER SIGN-IN REQUIRED' : 'SHOW GROUND TRUTH OVERLAY'}</span></label></div><div className="overlay-legend"><span><i className="derived-mark" />DERIVED · OPERATOR VISIBLE</span><span><i className="truth-mark" />GROUND TRUTH · EVALUATION ONLY</span></div><div className="overlay-plot">{clusters.map(cluster => <div className="overlay-row" key={cluster.id}><Mono>{cluster.id}</Mono><div className="overlay-track"><i className="derived-marker" style={{ left: `${Math.max(0, Math.min(100, (cluster.centerFrequencyGHz - constraints.frequencyMinGHz) / frequencySpan * 100))}%` }} /><span>{cluster.centerFrequencyGHz.toFixed(3)} GHz · {cluster.patternType}</span>{showGroundTruthOverlay && overlayTruth.filter(emitter => emitter.active && Math.abs(emitter.currentFrequencyGHz - cluster.centerFrequencyGHz) < .25).map(emitter => <i key={emitter.emitterId} className="truth-marker" style={{ left: `${Math.max(0, Math.min(100, (emitter.currentFrequencyGHz - constraints.frequencyMinGHz) / frequencySpan * 100))}%` }} title={`${emitter.emitterId} ground truth`} />)}</div></div>)}</div></Panel>
  </div>;
}

function WelcomeGate({ gate, setGate, name, setName, password, setPassword, onSubmit, busy, notice, setNotice, onDemo }) {
  const [activeNav, setActiveNav] = useState('Home');
  const [activeModal, setActiveModal] = useState(null);

  const modalContent = {
    problem: {
      tag: 'CHALLENGE DEFINITION',
      title: 'Dense RF Spectrum Interception Under Agility',
      body: 'In contested Electronic Warfare environments, hostile radars employ frequency hopping, short agile bursts, and directional scanning beams. Traditional fixed-pattern or round-robin scan strategies suffer from high missed-detection rates and prohibitive Intercept Time (Toi). Operators need an autonomous, intelligent receiver scheduler that predicts when and where emitters will illuminate without relying on prior intelligence.'
    },
    solution: {
      tag: 'EXPECTED SOLUTION',
      title: 'ML-Based Electronic Support Receiver Scheduler',
      body: 'KAVACH introduces a dual-tier cognitive architecture: a Bayesian multi-band belief engine maintaining dynamic probability tracks across agility bands, coupled with a Proximal Policy Optimization (PPO) reinforcement learning network. The scheduler balances exploitation of predicted beam arrivals against exploration of stale bands while explicitly penalizing receiver retuning delays.'
    },
    technology: {
      tag: 'CORE ARCHITECTURE',
      title: 'Reinforcement Learning & Time-of-Arrival Prediction',
      body: '• PPO Policy Actor-Critic trained on complex multi-emitter RF environments\n• Epistemic entropy reduction & periodic spatial scan beam alignment estimation\n• Microsecond-resolution Pulse Descriptor Word (PDW) extraction\n• Offline deterministic simulation & Live TSRD dataset stream playback'
    },
    impact: {
      tag: 'MISSION IMPACT',
      title: 'Superior Detection & Early Threat Warning',
      body: '• 67% reduction in Time-of-Intercept against agile scanning emitters\n• Probability of Detection (Pd) > 94% under zero prior emitter intelligence\n• Dramatically reduced false alarm rates (Pfa) with real-time explainability breakdown\n• Eliminates operator cognitive fatigue via autonomous receiver tuning'
    },
    team: {
      tag: 'DEVELOPMENT SQUAD',
      title: 'Team Kavach · Electronic Warfare Systems',
      body: 'Developed for Smart India Hackathon. Designed to meet defense requirements for autonomous ESR receiver scheduling in air, naval, and ground-based electronic surveillance payloads.'
    }
  };

  if (gate === 'login') {
    return <main className="welcome-shell">
      <header className="welcome-nav">
        <div className="brand-mark"><Shield size={21}/></div>
        <b>KAVACH <span>EW COMMAND</span></b>
        <button className="subtle-button" onClick={() => { setNotice(''); setGate('landing'); }}>
          ← BACK TO OVERVIEW
        </button>
      </header>
      <section className="login-card">
        <div className="eyebrow">SECURE PILOT ACCESS</div>
        <h1>Operator Sign In</h1>
        <p>Sign in to a backend account or choose a local demo identity.</p>
        <form onSubmit={onSubmit}>
          <label>USERNAME<input required autoComplete="username" value={name} onChange={e => setName(e.target.value)} placeholder="operator or researcher"/></label>
          <label>PASSWORD<input required autoComplete="current-password" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Backend account password"/></label>
          <button className="button-primary" disabled={busy}>{busy ? "CONNECTING…" : "SIGN IN TO BACKEND"} <ArrowRight size={14}/></button>
        </form>
        <div className="login-divider"><span/> OR USE LOCAL DEMO <span/></div>
        <div className="demo-accounts">
          <button className="button-secondary" onClick={() => onDemo("OPERATOR")}>OPERATOR DEMO <Play size={13}/></button>
          <button className="button-secondary" onClick={() => onDemo("RESEARCHER")}>RESEARCH DEMO <Microscope size={13}/></button>
        </div>
        <small className="demo-hint">No password required · Offline Simulation only</small>
        {notice && <p className="gate-notice" role="status">{notice}</p>}
      </section>
    </main>;
  }

  return (
    <div className="kavach-landing">
      {/* Top Header Navigation */}
      <header className="kl-header">
        <div className="kl-brand" onClick={() => { setActiveNav('Home'); setActiveModal(null); }}>
          <div className="kl-logo-row">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <path d="M12 2L2 7V12C2 17.5 6.3 22.3 12 23.5C17.7 22.3 22 17.5 22 12V7L12 2Z" stroke="#10F49C" strokeWidth="2" fill="rgba(16,244,156,0.14)" strokeLinejoin="round"/>
              <path d="M12 6L6 9.5V12.5C6 15.8 8.6 18.7 12 19.5C15.4 18.7 18 15.8 18 12.5V9.5L12 6Z" fill="#10F49C"/>
            </svg>
            <span className="kl-logo-text">KAV<span>A</span>CH</span>
          </div>
          <span className="kl-tagline">DETECT • ADAPT • INTERCEPT • PROTECT</span>
        </div>

        <ul className="kl-nav-links">
          <li><button className={`kl-nav-item ${activeNav === 'Home' && !activeModal ? 'active' : ''}`} onClick={() => { setActiveNav('Home'); setActiveModal(null); }}>Home</button></li>
          <li><button className={`kl-nav-item ${activeModal === 'problem' ? 'active' : ''}`} onClick={() => setActiveModal('problem')}>Problem</button></li>
          <li><button className={`kl-nav-item ${activeModal === 'solution' ? 'active' : ''}`} onClick={() => setActiveModal('solution')}>Solution</button></li>
          <li><button className={`kl-nav-item ${activeModal === 'technology' ? 'active' : ''}`} onClick={() => setActiveModal('technology')}>Technology</button></li>
          <li><button className="kl-nav-item" onClick={() => onDemo('OPERATOR')}>Demo</button></li>
          <li><button className={`kl-nav-item ${activeModal === 'impact' ? 'active' : ''}`} onClick={() => setActiveModal('impact')}>Impact</button></li>
          <li><button className={`kl-nav-item ${activeModal === 'team' ? 'active' : ''}`} onClick={() => setActiveModal('team')}>Team</button></li>
        </ul>

        <div className="kl-header-actions">
          <ThemeToggle />
          <button className="kl-btn-operator-login" onClick={() => { setNotice(''); setGate('login'); }}>
            OPERATOR LOGIN
          </button>
          <button className="kl-btn-get-started" onClick={() => onDemo('OPERATOR')}>
            Get Started <ArrowRight size={14} />
          </button>
        </div>
      </header>

      {/* Main Hero Section */}
      <main className="kl-hero">
        <div className="kl-hero-body">
          {/* Left Column: Headline and CTAs */}
          <div className="kl-hero-copy">
            <div className="kl-eyebrow">
              AI POWERED ELECTRONIC WARFARE INTELLIGENCE
            </div>
            <h1 className="kl-hero-title">
              <span>SMARTER SCANNING.</span>
              <span>FASTER DETECTION.</span>
              <span className="highlight-green">STRONGER DEFENCE.</span>
            </h1>
            <p className="kl-hero-desc">
              KAVACH develops a machine learning based smart scan strategy for Electronic Warfare, enabling rapid and intelligent interception of hostile communication and radar signals — even without prior intelligence on emitters.
            </p>
            <div className="kl-hero-actions">
              <button className="kl-btn-primary" onClick={() => onDemo('OPERATOR')}>
                Explore Solution <ArrowRight size={15} />
              </button>
              <button className="kl-btn-secondary" onClick={() => onDemo('OPERATOR')}>
                <Play size={14} fill="#ffffff" /> Watch Demo
              </button>
            </div>
          </div>

          {/* Right Column: Floating Tactical HUD Panels */}
          <div className="kl-hud-stack">
            {/* SPECTRUM MONITOR */}
            <div className="kl-hud-card">
              <div className="kl-hud-head">
                <span className="kl-hud-title">SPECTRUM MONITOR</span>
                <span className="kl-threat-badge">
                  <i className="kl-pulse-dot-red" /> THREAT DETECTED
                </span>
              </div>
              <div className="kl-spectrum-graph">
                <svg viewBox="0 0 320 60" style={{ width: '100%', height: '100%' }}>
                  <defs>
                    <linearGradient id="klThreatGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#ff453a" stopOpacity="0.9" />
                      <stop offset="100%" stopColor="#ff453a" stopOpacity="0.1" />
                    </linearGradient>
                  </defs>
                  <line x1="0" y1="58" x2="320" y2="58" stroke="rgba(255,255,255,0.1)" strokeWidth="1" />
                  <line x1="0" y1="30" x2="320" y2="30" stroke="rgba(255,255,255,0.05)" strokeDasharray="3 3" />
                  
                  {/* Baseline RF Spectrum wave */}
                  <path d="M 0 55 Q 15 48 30 52 T 60 42 T 90 54 T 120 44 T 145 28 T 175 48 T 205 18 T 235 52 T 265 38 T 295 54 T 320 50" fill="none" stroke="#38e1a7" strokeWidth="1.2" opacity="0.8" />
                  
                  {/* Energy Bars */}
                  <line x1="20" y1="58" x2="20" y2="44" stroke="#38e1a7" strokeWidth="1.5" opacity="0.5"/>
                  <line x1="45" y1="58" x2="45" y2="34" stroke="#38e1a7" strokeWidth="1.5" opacity="0.6"/>
                  <line x1="75" y1="58" x2="75" y2="48" stroke="#38e1a7" strokeWidth="1.5" opacity="0.5"/>
                  <line x1="105" y1="58" x2="105" y2="38" stroke="#38e1a7" strokeWidth="1.5" opacity="0.7"/>
                  
                  {/* Red Threat Spikes */}
                  <line x1="145" y1="58" x2="145" y2="12" stroke="#ff453a" strokeWidth="2.5" />
                  <circle cx="145" cy="12" r="2.5" fill="#ff453a" />
                  <line x1="175" y1="58" x2="175" y2="8" stroke="#ff453a" strokeWidth="3" />
                  <circle cx="175" cy="8" r="3" fill="#ff453a" />
                  <line x1="205" y1="58" x2="205" y2="18" stroke="#ff453a" strokeWidth="2" />
                  <circle cx="205" cy="18" r="2" fill="#ff453a" />

                  {/* Rest of spectrum */}
                  <line x1="235" y1="58" x2="235" y2="32" stroke="#38e1a7" strokeWidth="1.5" opacity="0.6"/>
                  <line x1="265" y1="58" x2="265" y2="46" stroke="#38e1a7" strokeWidth="1.5" opacity="0.5"/>
                  <line x1="295" y1="58" x2="295" y2="28" stroke="#38e1a7" strokeWidth="1.5" opacity="0.8"/>
                </svg>
              </div>
              <div className="kl-spectrum-x-axis">
                <span>1 GHz</span>
                <span>3 GHz</span>
                <span>5 GHz</span>
                <span>7 GHz</span>
                <span>9 GHz</span>
              </div>
            </div>

            {/* REAL TIME INTERCEPTS */}
            <div className="kl-hud-card">
              <div className="kl-hud-head" style={{ marginBottom: '8px' }}>
                <span className="kl-hud-title">REAL TIME INTERCEPTS</span>
              </div>
              <div className="kl-intercepts-list">
                <div className="kl-intercept-row">
                  <span className="kl-intercept-name"><span style={{ color: '#10F49C', fontSize: '9px' }}>✦</span> Hostile Radar</span>
                  <span className="kl-intercept-freq">3.2 GHz</span>
                  <span className="kl-chip kl-chip-green">● INTERCEPTED</span>
                </div>
                <div className="kl-intercept-row">
                  <span className="kl-intercept-name"><span style={{ color: '#10F49C', fontSize: '9px' }}>☵</span> Comm Link</span>
                  <span className="kl-intercept-freq">5.8 GHz</span>
                  <span className="kl-chip kl-chip-green">● INTERCEPTED</span>
                </div>
                <div className="kl-intercept-row">
                  <span className="kl-intercept-name"><span style={{ color: '#f5a623', fontSize: '9px' }}>◫</span> Unknown Emitter</span>
                  <span className="kl-intercept-freq">2.1 GHz</span>
                  <span className="kl-chip kl-chip-amber">● ANALYSING</span>
                </div>
                <div className="kl-intercept-row" style={{ borderBottom: 'none' }}>
                  <span className="kl-intercept-name"><span style={{ color: '#38bdf8', fontSize: '9px' }}>◎</span> Surveillance Radar</span>
                  <span className="kl-intercept-freq">7.4 GHz</span>
                  <span className="kl-chip kl-chip-blue">● TRACKING</span>
                </div>
              </div>
            </div>

            {/* AI SCHEDULER */}
            <div className="kl-hud-card">
              <div className="kl-hud-head" style={{ marginBottom: '8px' }}>
                <span className="kl-hud-title">AI SCHEDULER</span>
                <span style={{ fontSize: '9px', color: '#6d857c', fontFamily: 'var(--mono)' }}>BAND-C DWELL</span>
              </div>
              <div className="kl-scheduler-wave">
                <div style={{ position: 'absolute', left: '18%', width: '24%', height: '100%', background: 'rgba(16, 244, 156, 0.22)', borderLeft: '2px solid #10F49C', borderRight: '2px solid #10F49C' }}>
                  <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', display: 'flex', gap: '3px', height: '65%', alignItems: 'center' }}>
                    {[...Array(5)].map((_, i) => (
                      <span key={i} style={{ width: '2px', height: `${35 + (i % 3) * 30}%`, background: '#10F49C' }} />
                    ))}
                  </div>
                </div>
                <div style={{ position: 'absolute', left: '56%', top: '50%', transform: 'translateY(-50%)', width: '8px', height: '8px', borderRadius: '50%', background: '#ff453a', boxShadow: '0 0 8px #ff453a' }} />
                <div style={{ position: 'absolute', left: '80%', top: '50%', transform: 'translateY(-50%)', width: '8px', height: '8px', borderRadius: '50%', background: '#38bdf8', boxShadow: '0 0 8px #38bdf8' }} />
                <svg viewBox="0 0 280 20" style={{ width: '100%', height: '20px', opacity: 0.35 }}>
                  <path d="M 0 10 Q 35 2 70 10 T 140 10 T 210 10 T 280 10" fill="none" stroke="#fff" strokeWidth="1" />
                </svg>
              </div>
              <div className="kl-scheduler-legend">
                <span className="kl-legend-item">
                  <i className="kl-legend-box" style={{ background: '#10F49C' }} /> Current Scan
                </span>
                <span className="kl-legend-item">
                  <i className="kl-legend-dot" style={{ background: '#ff453a' }} /> Predicted Emitter
                </span>
                <span className="kl-legend-item">
                  <i className="kl-legend-dot" style={{ background: '#38bdf8' }} /> Next Target
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Middle Feature Badges Strip */}
        <section className="kl-features-rail">
          <div className="kl-feature-col">
            <div className="kl-feature-icon">
              <Radio size={18} />
            </div>
            <div className="kl-feature-info">
              <span className="kl-feature-title">WIDE SPECTRUM SURVEILLANCE</span>
              <span className="kl-feature-sub">Covers multiple frequency bands efficiently</span>
            </div>
          </div>
          <div className="kl-feature-col">
            <div className="kl-feature-icon">
              <Brain size={18} />
            </div>
            <div className="kl-feature-info">
              <span className="kl-feature-title">AI BASED SCAN SCHEDULER</span>
              <span className="kl-feature-sub">Learns from hits & misses to optimize scanning</span>
            </div>
          </div>
          <div className="kl-feature-col">
            <div className="kl-feature-icon">
              <Target size={18} />
            </div>
            <div className="kl-feature-info">
              <span className="kl-feature-title">HIGH INTERCEPTION RATE</span>
              <span className="kl-feature-sub">Minimizes intercept time and maximizes detection</span>
            </div>
          </div>
          <div className="kl-feature-col">
            <div className="kl-feature-icon">
              <BarChart3 size={18} />
            </div>
            <div className="kl-feature-info">
              <span className="kl-feature-title">REAL TIME THREAT ANALYSIS</span>
              <span className="kl-feature-sub">Detects and classifies unknown emitters</span>
            </div>
          </div>
          <div className="kl-feature-col">
            <div className="kl-feature-icon">
              <Shield size={18} />
            </div>
            <div className="kl-feature-info">
              <span className="kl-feature-title">BUILT FOR MODERN WARFARE</span>
              <span className="kl-feature-sub">Robust, adaptive and intelligence-free operation</span>
            </div>
          </div>
        </section>

        {/* Bottom Mission Objective & Key Performance Metrics */}
        <section className="kl-bottom-strip">
          <div className="kl-mission-title-box">
            <div className="kl-mission-accent-bar" />
            <div className="kl-mission-text-group">
              <span className="kl-mission-eyebrow">MISSION OBJECTIVE</span>
              <div className="kl-mission-statement">
                INTERCEPT.<br />
                UNDERSTAND.<br />
                <span style={{ color: 'var(--kavach-green)' }}>STAY AHEAD.</span>
              </div>
            </div>
          </div>

          <div className="kl-mission-desc">
            Develop a machine learning based Electronic Support Receiver (ESR) scheduler that intelligently scans the spectrum, predicts emitter activity, and ensures a high interception ratio — without relying on prior intelligence.
          </div>

          <div className="kl-kpi-block">
            <span className="kl-kpi-heading">KEY PERFORMANCE METRICS</span>
            <div className="kl-kpi-grid">
              <div className="kl-kpi-card">
                <span className="kl-kpi-metric green"><ArrowUp size={13} strokeWidth={3} /> Pd</span>
                <span className="kl-kpi-label">Probability of Detection</span>
              </div>
              <div className="kl-kpi-card">
                <span className="kl-kpi-metric green"><ArrowDown size={13} strokeWidth={3} /> Pfa</span>
                <span className="kl-kpi-label">Low False Alarm Rate</span>
              </div>
              <div className="kl-kpi-card">
                <span className="kl-kpi-metric"><Clock size={12} /> Min</span>
                <span className="kl-kpi-label">Intercept Time</span>
              </div>
              <div className="kl-kpi-card">
                <span className="kl-kpi-metric"><BarChart3 size={12} /> High</span>
                <span className="kl-kpi-label">Interception Rate</span>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Informational Modal Overlay for Nav Links */}
      {activeModal && modalContent[activeModal] && (
        <div className="kl-modal-backdrop" onClick={() => setActiveModal(null)}>
          <div className="kl-modal-box" onClick={e => e.stopPropagation()}>
            <button className="kl-modal-close" onClick={() => setActiveModal(null)}>
              <X size={18} />
            </button>
            <div className="kl-eyebrow" style={{ marginBottom: '8px' }}>
              {modalContent[activeModal].tag}
            </div>
            <h2 style={{ fontSize: '24px', fontWeight: 800, color: '#ffffff', marginBottom: '16px' }}>
              {modalContent[activeModal].title}
            </h2>
            <p style={{ fontSize: '14px', lineHeight: 1.7, color: '#a4bbb1', whiteSpace: 'pre-line', marginBottom: '24px' }}>
              {modalContent[activeModal].body}
            </p>
            <div style={{ display: 'flex', gap: '12px' }}>
              <button className="kl-btn-primary" onClick={() => { setActiveModal(null); onDemo('OPERATOR'); }}>
                Enter Command Center <ArrowRight size={14} />
              </button>
              <button className="kl-btn-secondary" onClick={() => setActiveModal(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
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
  useEffect(() => {
    const current = localStorage.getItem('kavach-theme') || 'dark';
    document.documentElement.setAttribute('data-theme', current);
  }, []);
  useEffect(() => { seedSimulationOnce(); }, [seedSimulationOnce]);
  useEffect(() => { const show = event => setNotice(event.detail || ''); const authChanged = () => { const session = getAuthSession(); setAuthSession(session); if (active === 'Research mode' && session?.role !== 'RESEARCHER') setActive('Command center'); if (!session?.accessToken && useSimulationStore.getState().dataSource === 'LIVE') { void pauseScenario().catch(() => {}); setDataSource('OFFLINE'); } }; window.addEventListener('kavach-toast', show); window.addEventListener('kavach-auth-changed', authChanged); return () => { window.removeEventListener('kavach-toast', show); window.removeEventListener('kavach-auth-changed', authChanged); }; }, []);
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
      disconnect = connectStream(applyBackendDelta, connected => { if (!disposed && !connected) console.warn('Kavach live stream disconnected'); });
    }).catch(error => { console.error('Unable to initialize live backend', error); if (!disposed) { setSimulationStatus('IDLE'); window.dispatchEvent(new CustomEvent('kavach-toast', { detail: `Live dataset replay unavailable: ${error.message}` })); } });
    return () => { disposed = true; disconnect(); };
  }, [dataSource, applyBackendDelta, setScenarios, setSimulationStatus]);
  const changePage = (page) => { if (page === 'Research mode' && authSession?.role !== 'RESEARCHER') { setNotice('Research mode requires a Researcher account.'); return; } setActive(page); setMode(page === 'Research mode' ? 'RESEARCH' : 'OPERATOR'); };
  const demoAccess = role => { saveAuthSession({ accessToken: '', username: role.toLowerCase(), role }); window.dispatchEvent(new Event('kavach-auth-changed')); setDataSource('OFFLINE'); setNotice('Demo access is active in Offline Simulation. Backend controls stay locked until a backend account signs in.'); setGate('console'); };
  const signIn = async event => { event.preventDefault(); setNotice(''); const normalizedName = loginName.trim().toLowerCase(); if ((normalizedName === 'operator' && loginPassword === 'kavach-demo') || (normalizedName === 'researcher' && loginPassword === 'research-demo')) { demoAccess(normalizedName === 'researcher' ? 'RESEARCHER' : 'OPERATOR'); return; } setLoginBusy(true); try { const result = await login(loginName, loginPassword); window.dispatchEvent(new Event('kavach-auth-changed')); setDataSource('LIVE'); setGate('console'); setNotice(`${result.role} account connected to the backend.`); } catch (error) { setNotice(error?.message || 'Sign-in failed. Use demo access below for offline mode.'); } finally { setLoginBusy(false); } };
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
  else if (active === 'Live spectrum') page = <LiveSpectrumPage onNavigate={changePage} />;
  else if (active === 'Scan strategy') page = <ScanStrategyPage />;
  else if (active === 'Emitter activity') page = <EmitterActivityPage selectedEmitter={selectedEmitter} setSelectedEmitter={setSelectedEmitter} />;
  else if (active === 'Scenario lab') page = <ScenarioLabPage onNavigate={changePage} />;
  else if (active === 'Decision history') page = <DecisionHistoryPage />;
  else if (active === 'Performance') page = <PerformancePage />;
  else if (active === 'Profile') page = <ProfilePage session={authSession} />;
  else page = <ResearchModePage />;
  return <div className="app-shell"><Sidebar active={active} setActive={changePage} collapsed={collapsed} setCollapsed={setCollapsed} session={authSession} onExitToLanding={() => setGate('landing')} /><main className="main-content"><Header active={active} onNavigate={changePage} onSourceChange={next => { if (next === 'LIVE' && !getAuthSession()?.accessToken) { window.dispatchEvent(new CustomEvent('kavach-toast', { detail: 'Sign in with a backend account to enable dataset replay. Offline demo identities do not include backend access.' })); return; } if (dataSource === 'LIVE' && next === 'OFFLINE') void pauseScenario().catch(console.error); if (next === 'LIVE') { useSimulationStore.getState().setScenarioConfig({ scenarioId: 'tsrd-replay', emitterCount: 1, durationSeconds: 300, seed: 7419 }); } setDataSource(next); }} /><div className={`page-content page-${active.toLowerCase().replaceAll(' ', '-')}`}>
    <motion.div className="page-title-row" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .4, ease }}><div><div className="eyebrow page-kicker">{theaterDateLabel} <span>·</span> {theaterName}</div><h1>{active}</h1><p>{descriptions[active]}</p></div><div className="title-actions"><label className="range-select"><span className="eyebrow">TIME WINDOW</span><select aria-label="Time window" value={timeWindowSeconds} onChange={event => setTimeWindow(Number(event.target.value))}><option value="300">LAST 5 MIN</option><option value="900">LAST 15 MIN</option><option value="1800">LAST 30 MIN</option><option value="3600">LAST 60 MIN</option></select><ChevronDown size={14} /></label><button aria-label="Open settings" className="icon-button settings-action" onClick={() => setNotice("Display settings: choose a capture window above; simulation speed and source are available in the header.")}><SlidersHorizontal size={16} /></button></div></motion.div>
    {notice && <div className="app-notice" role="status"><span>{notice}</span><button aria-label="Dismiss message" onClick={() => setNotice('')}><X size={14}/></button></div>}
    {page}
    <footer className="page-footer"><span>KAVACH EW COMMAND <span className="footer-dot">·</span> BUILD 2.4.18</span><span>CLASSIFICATION <b>SECRET // REL TO USA, FVEY</b></span><span><span className="health-dot" /> ALL SYSTEMS OPERATIONAL</span></footer>
  </div></main></div>;
}
