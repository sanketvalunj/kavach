import { useSimulationStore } from '../store/simulationStore';

const BASE_STEP_MS = 50;
let timer: ReturnType<typeof setInterval> | undefined;

function syncLoop() {
  const { simulationStatus, simulationSpeed, dataSource } = useSimulationStore.getState();
  if (dataSource !== 'OFFLINE') { if (timer) clearInterval(timer); timer = undefined; return; }
  if (simulationStatus !== 'RUNNING') {
    if (timer) clearInterval(timer);
    timer = undefined;
    return;
  }
  if (timer) clearInterval(timer);
  timer = setInterval(() => useSimulationStore.getState().tick(BASE_STEP_MS), BASE_STEP_MS / simulationSpeed);
}

useSimulationStore.subscribe((state, previous) => {
  if (state.simulationStatus !== previous.simulationStatus || state.simulationSpeed !== previous.simulationSpeed || state.dataSource !== previous.dataSource) syncLoop();
});

syncLoop();
