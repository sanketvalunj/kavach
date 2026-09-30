import type { AlertEvent, OperationalMetrics, PDW, ScanDecision, Scenario, ScenarioConfig, SchedulerState, SimulationState, SpectrumSample } from '../types';
import { getAccessToken, saveAuthSession, type UserRole } from './auth';

const baseUrl = (import.meta as ImportMeta & { env?: Record<string, string> }).env?.VITE_API_BASE_URL ?? 'http://localhost:8000';
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getAccessToken();
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init?.headers } });
  if (!response.ok) throw new Error(`Aegis API ${path}: ${response.status} ${response.statusText}`);
  return response.json() as Promise<T>;
}
export async function login(username: string, password: string): Promise<{ username: string; role: UserRole; expires_in: number }> {
  const data = await request<{ access_token: string; username: string; role: UserRole; expires_in: number }>('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
  saveAuthSession({ accessToken: data.access_token, username: data.username, role: data.role });
  return data;
}
export const runResearchBaselines = () => request<{ scenarioId: string; baselines: Array<{ name: string; nextBand: string; predictedActivity: number; status: string }>; disclaimer: string }>('/research/baselines', { method: 'POST' });
export const getResearchGroundTruth = () => request<{ source: string; emitters: Array<{ emitterId: string; active: boolean; currentFrequencyGHz: number }>; disclaimer: string }>('/research/ground-truth');
export interface HealthResponse { status: 'ok'; service: string; mode: string; version: string }
export type ApiSimulationState = Pick<SimulationState, 'currentSimulationTime' | 'timeWindowSeconds' | 'theaterDateLabel' | 'theaterName' | 'operationId' | 'receiverState' | 'receivers' | 'bandBeliefs' | 'emitters' | 'pdws' | 'pdwHistory' | 'scanDecisions' | 'decisionHistory' | 'activeAlerts' | 'simulationStatus' | 'simulationSpeed' | 'scenarioConfig'>;
export const getHealth = () => request<HealthResponse>('/health');
export const getSimulationState = () => request<ApiSimulationState>('/simulation/state');
export const getSpectrum = () => request<SpectrumSample[]>('/spectrum');
export const getSchedulerDecision = () => request<ScanDecision>('/scheduler/decision');
export const getMetrics = () => request<OperationalMetrics>('/metrics');
export interface HistoryFilters { limit?: number; offset?: number; run_id?: string; result?: 'HIT' | 'MISS'; band?: string }
export interface HistoryResponse { items: ScanDecision[]; total: number; limit: number; offset: number }
export const getHistory = (filters: HistoryFilters = {}) => {
  const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value !== undefined && value !== '').map(([key, value]) => [key, String(value)]));
  return request<HistoryResponse>(`/history${query.toString() ? `?${query}` : ''}`);
};
export const exportHistory = async (format: 'csv' | 'json', filters: HistoryFilters = {}) => {
  const query = new URLSearchParams(Object.entries(filters).filter(([key, value]) => key !== 'limit' && key !== 'offset' && value !== undefined && value !== '').map(([key, value]) => [key, String(value)]));
  query.set('format', format);
  const response = await fetch(`${baseUrl}/history/export?${query}`);
  if (!response.ok) throw new Error(`History export failed: ${response.status}`);
  return response.blob();
};
export const listScenarios = () => request<Scenario[]>('/scenario/list');
export const loadScenario = (config: ScenarioConfig) => request<Scenario>('/scenario/load', { method: 'POST', body: JSON.stringify(config) });
export const startScenario = () => request<ApiSimulationState>('/scenario/start', { method: 'POST' });
export const pauseScenario = () => request<ApiSimulationState>('/scenario/pause', { method: 'POST' });
export const resetScenario = () => request<ApiSimulationState>('/scenario/reset', { method: 'POST' });
export interface FullStateMessage extends ApiSimulationState { type: 'full_state'; version: 1 }
export interface TickDelta {
  type: 'tick_delta'; version: 1; sequence: number; simTime: string;
  receiverState?: SimulationState['receiverState'];
  changedBands?: Array<Pick<SchedulerState, 'bandId'> & Partial<SchedulerState>>;
  newPdws?: PDW[]; newDecision?: ScanDecision; newAlerts?: AlertEvent[];
}
export type StreamMessage = FullStateMessage | TickDelta;
