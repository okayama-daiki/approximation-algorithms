const canvas = document.querySelector('#board');
const ctx = canvas.getContext('2d');
const facilityCountInput = document.querySelector('#facilityCount');
const clientCountInput = document.querySelector('#clientCount');
const openingCostInput = document.querySelector('#openingCostRange');
const seedInput = document.querySelector('#seed');
const generateBtn = document.querySelector('#generateBtn');
const randomSeedBtn = document.querySelector('#randomSeedBtn');
const stepBtn = document.querySelector('#stepBtn');
const runBtn = document.querySelector('#runBtn');
const resetBtn = document.querySelector('#resetBtn');
const optimalBtn = document.querySelector('#optimalBtn');
const toggleViewBtn = document.querySelector('#toggleViewBtn');
const iterationEl = document.querySelector('#iteration');
const totalCostEl = document.querySelector('#totalCost');
const openCostEl = document.querySelector('#openCost');
const assignCostEl = document.querySelector('#assignCost');
const lastMoveEl = document.querySelector('#lastMove');
const logList = document.querySelector('#logList');

const MAX_LOG_ITEMS = 20;
const TOLERANCE = 1e-6;
const OPTIMAL_FACILITY_LIMIT = 15;

const state = {
  facilities: [],
  clients: [],
  openSet: new Set(),
  initialOpenSet: new Set(),
  assignments: [],
  iteration: 0,
  costs: { totalCost: 0, openCost: 0, assignCost: 0 },
  lastMove: '-',
  logEntries: [],
  running: false,
  optimalSolution: null,
  viewMode: 'current',
};

generateBtn.addEventListener('click', () => {
  generateInstance();
});

randomSeedBtn.addEventListener('click', () => {
  const randomSeed = Math.floor(Math.random() * 100000);
  seedInput.value = randomSeed;
  generateInstance();
});

resetBtn.addEventListener('click', () => {
  if (!state.facilities.length) return;
  state.openSet = new Set(state.initialOpenSet);
  state.iteration = 0;
  const evaluation = evaluateCurrentSolution();
  updateStateAfterEvaluation(evaluation, '初期解にリセット');
  appendLog('初期解にリセットしました。');
});

stepBtn.addEventListener('click', () => {
  performSingleStep();
});

runBtn.addEventListener('click', async () => {
  if (state.running) {
    state.running = false;
    return;
  }
  await runUntilLocalOptimum();
});

optimalBtn.addEventListener('click', () => {
  computeOptimalSolution();
});

toggleViewBtn.addEventListener('click', () => {
  toggleViewMode();
});

function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomBetween(rng, min, max) {
  return min + (max - min) * rng();
}

function readOptions() {
  const facilityCount = clamp(parseInt(facilityCountInput.value, 10) || 10, 2, 50);
  const clientCount = clamp(parseInt(clientCountInput.value, 10) || 20, 1, 200);
  const openingCostRange = clamp(parseInt(openingCostInput.value, 10) || 50, 10, 500);
  const seed = parseInt(seedInput.value, 10) || 1;
  facilityCountInput.value = facilityCount;
  clientCountInput.value = clientCount;
  openingCostInput.value = openingCostRange;
  seedInput.value = seed;
  return { facilityCount, clientCount, openingCostRange, seed };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function generateInstance() {
  state.running = false;
  runBtn.textContent = '局所最適まで進める';
  const { facilityCount, clientCount, openingCostRange, seed } = readOptions();
  const rng = mulberry32(seed >>> 0);
  const padding = 30;
  const facilities = Array.from({ length: facilityCount }, (_, idx) => ({
    id: idx,
    x: randomBetween(rng, padding, canvas.width - padding),
    y: randomBetween(rng, padding, canvas.height - padding),
    openingCost: Math.round(randomBetween(rng, 20, 20 + openingCostRange)),
  }));

  const clients = Array.from({ length: clientCount }, (_, idx) => ({
    id: idx,
    x: randomBetween(rng, padding, canvas.width - padding),
    y: randomBetween(rng, padding, canvas.height - padding),
  }));

  const startCount = Math.max(1, Math.round(facilityCount * 0.4));
  const openSet = new Set(pickRandomIds(facilityCount, startCount, rng));

  state.facilities = facilities;
  state.clients = clients;
  state.openSet = openSet;
  state.initialOpenSet = new Set(openSet);
  state.iteration = 0;
  state.logEntries = [];
  logList.innerHTML = '';
  clearOptimalSolution();
  const evaluation = evaluateCurrentSolution();
  updateStateAfterEvaluation(evaluation, '新しいインスタンスを生成');
  appendLog(`インスタンス生成 (seed=${seed})`);
}

function pickRandomIds(size, count, rng) {
  const ids = Array.from({ length: size }, (_, idx) => idx);
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return ids.slice(0, count);
}

function evaluateCurrentSolution(customSet) {
  const workingSet = customSet ? new Set(customSet) : new Set(state.openSet);
  const openCost = [...workingSet].reduce(
    (acc, id) => acc + state.facilities[id].openingCost,
    0
  );
  const assignmentResult = assignClients(workingSet);
  const totalCost = openCost + assignmentResult.assignCost;
  return {
    totalCost,
    openCost,
    assignCost: assignmentResult.assignCost,
    assignments: assignmentResult.assignments,
    openSet: workingSet,
  };
}

function assignClients(openSet) {
  if (openSet.size === 0) {
    throw new Error('少なくとも1つの施設を開設する必要があります');
  }
  const openFacilities = [...openSet].map((id) => state.facilities[id]);
  const assignments = state.clients.map((client) => {
    let best = { facilityId: openFacilities[0].id, distance: Infinity };
    for (const facility of openFacilities) {
      const distance = euclidean(client, facility);
      if (distance < best.distance) {
        best = { facilityId: facility.id, distance };
      }
    }
    return { clientId: client.id, facilityId: best.facilityId, distance: best.distance };
  });
  const assignCost = assignments.reduce((acc, item) => acc + item.distance, 0);
  return { assignments, assignCost };
}

function euclidean(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

function updateStateAfterEvaluation(evaluation, moveText) {
  state.costs = evaluation;
  state.assignments = evaluation.assignments;
  state.lastMove = moveText;
  refreshDisplay(moveText);
}

function getDisplaySolution() {
  if (state.viewMode === 'optimal' && state.optimalSolution) {
    return { solution: state.optimalSolution, showingOptimal: true };
  }
  return { solution: state.costs, showingOptimal: false };
}

function refreshDisplay(moveText) {
  const { solution, showingOptimal } = getDisplaySolution();
  updateMetrics(solution, moveText, showingOptimal);
  drawBoard(solution.openSet, solution.assignments);
}

function updateMetrics(solution, moveText, showingOptimal) {
  iterationEl.textContent = state.iteration;
  totalCostEl.textContent = solution.totalCost.toFixed(1);
  openCostEl.textContent = solution.openCost.toFixed(1);
  assignCostEl.textContent = solution.assignCost.toFixed(1);
  if (showingOptimal) {
    lastMoveEl.textContent = '最適解を表示中';
  } else {
    lastMoveEl.textContent = moveText || state.lastMove || '-';
  }
}

function drawBoard(openSetForDisplay, assignmentsForDisplay) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(15, 23, 42, 0.25)';

  const facilityMap = new Map(state.facilities.map((f) => [f.id, f]));

  // draw assignment lines first
  ctx.beginPath();
  for (const assignment of assignmentsForDisplay) {
    const client = state.clients[assignment.clientId];
    const facility = facilityMap.get(assignment.facilityId);
    ctx.moveTo(client.x, client.y);
    ctx.lineTo(facility.x, facility.y);
  }
  ctx.stroke();

  // draw clients
  for (const client of state.clients) {
    ctx.fillStyle = '#059669';
    ctx.beginPath();
    ctx.arc(client.x, client.y, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  // draw facilities
  for (const facility of state.facilities) {
    const open = openSetForDisplay.has(facility.id);
    ctx.fillStyle = open ? '#f97316' : '#94a3b8';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(facility.x, facility.y, open ? 8 : 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#111827';
    ctx.font = '12px sans-serif';
    ctx.fillText(`F${facility.id}`, facility.x + 10, facility.y - 6);
    ctx.fillText(`f=${facility.openingCost}`, facility.x + 10, facility.y + 8);
  }
}

function appendLog(text) {
  const time = new Date().toLocaleTimeString();
  state.logEntries.unshift(`[${time}] ${text}`);
  if (state.logEntries.length > MAX_LOG_ITEMS) {
    state.logEntries.pop();
  }
  logList.innerHTML = '';
  for (const entry of state.logEntries) {
    const li = document.createElement('li');
    li.textContent = entry;
    logList.appendChild(li);
  }
}

function clearOptimalSolution() {
  state.optimalSolution = null;
  state.viewMode = 'current';
  updateViewToggleButton();
}

function updateViewToggleButton() {
  const showingOptimal = state.viewMode === 'optimal' && state.optimalSolution;
  toggleViewBtn.disabled = !state.optimalSolution;
  toggleViewBtn.textContent = showingOptimal ? '現在解を表示' : '最適解を表示';
}

function computeOptimalSolution() {
  if (!state.facilities.length) return;
  const facilityCount = state.facilities.length;
  if (facilityCount > OPTIMAL_FACILITY_LIMIT) {
    appendLog(
      `施設数が${facilityCount}のため厳密最適解の計算を省略しました（上限${OPTIMAL_FACILITY_LIMIT}）。`
    );
    return;
  }
  appendLog('最適解を計算しています...');
  const facilityIds = state.facilities.map((f) => f.id);
  const totalSubsets = 1 << facilityCount;
  let bestEvaluation = null;
  for (let mask = 1; mask < totalSubsets; mask++) {
    const openSet = new Set();
    for (let bit = 0; bit < facilityCount; bit++) {
      if (mask & (1 << bit)) {
        openSet.add(facilityIds[bit]);
      }
    }
    const evaluation = evaluateCurrentSolution(openSet);
    if (!bestEvaluation || evaluation.totalCost < bestEvaluation.totalCost - TOLERANCE) {
      bestEvaluation = evaluation;
    }
  }
  if (bestEvaluation) {
    state.optimalSolution = bestEvaluation;
    state.viewMode = 'optimal';
    updateViewToggleButton();
    refreshDisplay('最適解');
    appendLog(`最適解を計算完了 (cost=${bestEvaluation.totalCost.toFixed(2)})`);
  }
}

function toggleViewMode() {
  if (!state.optimalSolution) return;
  state.viewMode = state.viewMode === 'optimal' ? 'current' : 'optimal';
  updateViewToggleButton();
  refreshDisplay();
  appendLog(state.viewMode === 'optimal' ? '最適解を表示中' : '局所探索解を表示中');
}

function describeMove(move) {
  if (!move) return '改善なし';
  switch (move.type) {
    case 'add':
      return `追加: F${move.addId}`;
    case 'remove':
      return `削除: F${move.removeId}`;
    case 'swap':
      return `交換: F${move.removeId} ⇄ F${move.addId}`;
    default:
      return '操作';
  }
}

function performSingleStep() {
  if (!state.facilities.length) return;
  const move = findBestMove();
  if (!move) {
    appendLog('局所最適に到達しました。');
    state.lastMove = '局所最適';
    refreshDisplay(state.lastMove);
    return;
  }
  applyMove(move);
}

function findBestMove() {
  const currentCost = state.costs.totalCost;
  const openFacilities = [...state.openSet];
  const closedFacilities = state.facilities
    .map((f) => f.id)
    .filter((id) => !state.openSet.has(id));

  let best = null;

  // try add operations
  for (const addId of closedFacilities) {
    const newSet = new Set(state.openSet);
    newSet.add(addId);
    const evaluation = evaluateCurrentSolution(newSet);
    const delta = evaluation.totalCost - currentCost;
    if (delta < -TOLERANCE && (!best || delta < best.delta)) {
      best = { type: 'add', addId, delta, evaluation, newSet };
    }
  }

  // try remove operations
  if (state.openSet.size > 1) {
    for (const removeId of openFacilities) {
      const newSet = new Set(state.openSet);
      newSet.delete(removeId);
      const evaluation = evaluateCurrentSolution(newSet);
      const delta = evaluation.totalCost - currentCost;
      if (delta < -TOLERANCE && (!best || delta < best.delta)) {
        best = { type: 'remove', removeId, delta, evaluation, newSet };
      }
    }
  }

  // try swap operations
  for (const removeId of openFacilities) {
    for (const addId of closedFacilities) {
      const newSet = new Set(state.openSet);
      newSet.delete(removeId);
      newSet.add(addId);
      const evaluation = evaluateCurrentSolution(newSet);
      const delta = evaluation.totalCost - currentCost;
      if (delta < -TOLERANCE && (!best || delta < best.delta)) {
        best = { type: 'swap', removeId, addId, delta, evaluation, newSet };
      }
    }
  }

  return best;
}

function applyMove(move) {
  state.openSet = move.newSet;
  state.iteration += 1;
  const description = `${describeMove(move)} (Δ=${move.delta.toFixed(2)})`;
  updateStateAfterEvaluation(move.evaluation, description);
  appendLog(description);
}

async function runUntilLocalOptimum() {
  if (!state.facilities.length) return;
  state.running = true;
  runBtn.textContent = '停止';
  let guard = 0;
  const limit = 800;
  while (state.running && guard < limit) {
    const move = findBestMove();
    if (!move) {
      appendLog('局所最適に到達しました。');
      state.lastMove = '局所最適';
      refreshDisplay(state.lastMove);
      break;
    }
    applyMove(move);
    guard += 1;
    await waitFrame();
  }
  if (guard >= limit) {
    appendLog('反復上限に達したため停止しました。');
  }
  state.running = false;
  runBtn.textContent = '局所最適まで進める';
}

function waitFrame() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

generateInstance();
