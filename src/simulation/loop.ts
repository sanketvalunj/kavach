import { useSimulationStore } from '../store/simulationStore';

const BASE_STEP_MS = 50;
const RETUNE_STEP_MS = 4;
let timer: ReturnType<typeof setInterval> | undefined;

function syncLoop() {
  const { simulationStatus, simulationSpeed, dataSource, receiverModel } = useSimulationStore.getState();
  if (dataSource !== 'OFFLINE') { if (timer) clearInterval(timer); timer = undefined; return; }
  if (simulationStatus !== 'RUNNING') {
    if (timer) clearInterval(timer);
    timer = undefined;
    return;
  }
  if (timer) clearInterval(timer);
  const stepMs = receiverModel.phase === 'RETUNING' ? RETUNE_STEP_MS : BASE_STEP_MS;
  timer = setInterval(() => useSimulationStore.getState().tick(stepMs), stepMs / simulationSpeed);
}

useSimulationStore.subscribe((state, previous) => {
  if (state.simulationStatus !== previous.simulationStatus || state.simulationSpeed !== previous.simulationSpeed || state.dataSource !== previous.dataSource || state.receiverModel.phase !== previous.receiverModel.phase) syncLoop();
});

syncLoop();
