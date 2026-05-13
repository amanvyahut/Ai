/* ============================================================
   TSCRIC-LoRa Dashboard — app.js FINAL v3.0 PRODUCTION
   ============================================================
   Systems:
   - Firebase Realtime Database (live listener)
   - OpenWeatherMap integration (display alongside local)
   - Soil Calibration Panel
   - Water Balance Analytics
   - Rainfall Analytics (local + OWM + estimated)
   - Sensor Health Status
   - Offline/Online Mode Banner
   - Cloud vs Local Comparison
   - Remaining Irrigation Analytics
   - Safe Mode Banner
   - Rain Probability Analytics
   - Irrigation Efficiency Analytics
   - Offline Store-and-Sync status
   - Adaptive Root-Zone Mode display
   - Login system (session-based)
   - Connection watchdog
   ============================================================ */

// ============================================================
// DASHBOARD LOGIN
// ============================================================
const DASHBOARD_PASSWORD = "Aman";

function doLogin() {
  const passEl = document.getElementById('loginPass');
  const errEl  = document.getElementById('loginError');
  if (!passEl) return;
  if (passEl.value.trim() === DASHBOARD_PASSWORD) {
    ['loginScreen'].forEach(id => setDisplay(id, 'none'));
    ['mainHeader','mainContent'].forEach(id => setDisplay(id, 'block'));
    if (errEl) errEl.style.display = 'none';
    sessionStorage.setItem('tscric_auth', '1');
    initFirebase();
  } else {
    if (errEl) errEl.style.display = 'block';
    passEl.value = '';
    passEl.focus();
  }
}

function doLogout() {
  sessionStorage.removeItem('tscric_auth');
  ['mainHeader','mainContent'].forEach(id => setDisplay(id, 'none'));
  setDisplay('loginScreen', 'flex');
  const p = document.getElementById('loginPass');
  if (p) p.value = '';
}

// ============================================================
// FIREBASE CONFIGURATION
// ============================================================
const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyDtWF8l4QCBdwmojwClGfd32AVNuf8alAk",
  authDomain:        "ai-irrigation-system-1e112.firebaseapp.com",
  databaseURL:       "https://ai-irrigation-system-1e112-default-rtdb.firebaseio.com",
  projectId:         "ai-irrigation-system-1e112",
  storageBucket:     "ai-irrigation-system-1e112.firebasestorage.app",
  messagingSenderId: "1052849462072",
  appId:             "1:1052849462072:web:a1062de83ec2f869a8ffcd"
};

// ============================================================
// CONSTANTS
// ============================================================
const BIGHA_TO_M2  = 1333.33;
const MAX_HISTORY  = 50;
const OWM_STALE_MS = 1800000; // 30 min — OWM data considered stale

const OWM_DIRECT_KEY = "e4efeb48999d7e673042ae4700395ed2";
let owmDirectData = null;


const CROP_DATA = [
  { name: "Wheat",     delta: 450,  fc: 38, pwp: 13 },
  { name: "Rice",      delta: 1200, fc: 50, pwp: 28 },
  { name: "Maize",     delta: 550,  fc: 38, pwp: 13 },
  { name: "Cotton",    delta: 750,  fc: 37, pwp: 13 },
  { name: "Soybean",   delta: 500,  fc: 37, pwp: 13 },
  { name: "Chickpea",  delta: 350,  fc: 35, pwp: 12 },
  { name: "Mustard",   delta: 380,  fc: 34, pwp: 12 },
  { name: "Sugarcane", delta: 1800, fc: 42, pwp: 16 }
];

const WEATHER_LOCATIONS = {
  bhopal:      { label:"Bhopal",      lat:23.26,lon:77.41,alt:527  },
  indore:      { label:"Indore",      lat:22.72,lon:75.86,alt:553  },
  jabalpur:    { label:"Jabalpur",    lat:23.18,lon:79.94,alt:412  },
  gwalior:     { label:"Gwalior",     lat:26.22,lon:78.18,alt:197  },
  ujjain:      { label:"Ujjain",      lat:23.18,lon:75.78,alt:491  },
  sagar:       { label:"Sagar",       lat:23.84,lon:78.74,alt:523  },
  rewa:        { label:"Rewa",        lat:24.53,lon:81.30,alt:327  },
  satna:       { label:"Satna",       lat:24.60,lon:80.83,alt:318  },
  chhindwara:  { label:"Chhindwara",  lat:22.06,lon:78.93,alt:682  },
  vidisha:     { label:"Vidisha",     lat:23.52,lon:77.81,alt:430  },
  hoshangabad: { label:"Hoshangabad", lat:22.75,lon:77.72,alt:310  },
  narsinghpur: { label:"Narsinghpur", lat:22.95,lon:79.19,alt:363  },
  delhi:       { label:"New Delhi",   lat:28.61,lon:77.20,alt:216  },
  mumbai:      { label:"Mumbai",      lat:19.08,lon:72.88,alt:14   },
  pune:        { label:"Pune",        lat:18.52,lon:73.86,alt:560  },
  nagpur:      { label:"Nagpur",      lat:21.15,lon:79.09,alt:310  },
  lucknow:     { label:"Lucknow",     lat:26.85,lon:80.95,alt:111  },
  patna:       { label:"Patna",       lat:25.60,lon:85.12,alt:55   },
  jaipur:      { label:"Jaipur",      lat:26.91,lon:75.79,alt:431  },
  chandigarh:  { label:"Chandigarh",  lat:30.73,lon:76.78,alt:321  },
  hyderabad:   { label:"Hyderabad",   lat:17.38,lon:78.47,alt:536  },
  bangalore:   { label:"Bengaluru",   lat:12.97,lon:77.59,alt:920  },
  ahmedabad:   { label:"Ahmedabad",   lat:23.03,lon:72.58,alt:55   },
  kolkata:     { label:"Kolkata",     lat:22.57,lon:88.36,alt:9    },
  amritsar:    { label:"Amritsar",    lat:31.63,lon:74.87,alt:234  },
  varanasi:    { label:"Varanasi",    lat:25.32,lon:83.00,alt:80   },
  agra:        { label:"Agra",        lat:27.18,lon:78.01,alt:169  }
};

// ============================================================
// STATE
// ============================================================
let firebaseApp  = null;
let firebaseDB   = null;
let irrigHistory = [];
let lastData     = null;
let isConnected  = false;
let selectedWeatherLocation = 'bhopal';
let watchdogTimer = null;
let lastDataTime  = 0;

let localConfig = {
  plotArea_m2: 6.0,
  plotArea_bigha: 6.0 / BIGHA_TO_M2,
  crop: 0,
  weatherLocation: 'bhopal'
};
let updatingM2 = false, updatingBigha = false;

// Calibration state
let calibData = [
  { adc_dry:850, adc_fc:600, adc_pwp:750, vwc_fc:0.35, vwc_pwp:0.12 },
  { adc_dry:845, adc_fc:595, adc_pwp:745, vwc_fc:0.35, vwc_pwp:0.12 },
  { adc_dry:855, adc_fc:605, adc_pwp:755, vwc_fc:0.35, vwc_pwp:0.12 }
];

// ============================================================
// INIT
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  if (sessionStorage.getItem('tscric_auth') === '1') {
    setDisplay('loginScreen', 'none');
    setDisplay('mainHeader',  'block');
    setDisplay('mainContent', 'block');
    loadHistory();
    updatePreviewCard(0, 6.0);
    initFirebase();
  } else {
    setTimeout(() => { const el = document.getElementById('loginPass'); if (el) el.focus(); }, 300);
  }
});

// ============================================================
// FIREBASE INIT
// ============================================================
function initFirebase() {
  loadHistory();
  updatePreviewCard(localConfig.crop, localConfig.plotArea_m2);

  loadScript('https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js', () => {
    loadScript('https://www.gstatic.com/firebasejs/9.23.0/firebase-database-compat.js', () => {
      try {
        if (!firebaseApp) firebaseApp = firebase.initializeApp(FIREBASE_CONFIG);
        firebaseDB = firebase.database();
        startSensorsListener();
        startConfigListener();
        fetchOWMDirect();
        setInterval(fetchOWMDirect, 600000);
        setConnectionStatus('online');
        // Start watchdog
        if (watchdogTimer) clearInterval(watchdogTimer);
        watchdogTimer = setInterval(connectionWatchdog, 10000);
      } catch(e) {
        console.error(e);
        setConnectionStatus('error');
        showAlert('Firebase init failed: ' + e.message);
      }
    });
  });
}

function loadScript(src, cb) {
  const s = document.createElement('script');
  s.src = src;
  s.onload = cb;
  s.onerror = () => { setConnectionStatus('error'); showAlert('Failed to load Firebase SDK'); };
  document.head.appendChild(s);
}

// ============================================================
// FIREBASE LISTENERS
// ============================================================
function startSensorsListener() {
  firebaseDB.ref('tscric/sensors').on('value', snap => {
    const data = snap.val();
    if (data) {
      lastData     = data;
      isConnected  = true;
      lastDataTime = Date.now();
      setConnectionStatus('online');
      updateDashboard(data);
      updateLastUpdateTime();
    }
  }, err => {
    console.error(err);
    isConnected = false;
    setConnectionStatus('error');
  });
}

function startConfigListener() {
  firebaseDB.ref('tscric/config').on('value', snap => {
    const cfg = snap.val();
    if (!cfg) return;
    if (cfg.plotArea !== undefined) {
      const area = parseFloat(cfg.plotArea);
      if (area >= 1 && area <= 100000) {
        localConfig.plotArea_m2    = area;
        localConfig.plotArea_bigha = area / BIGHA_TO_M2;
        silentFill('plotAreaM2',    area.toFixed(2));
        silentFill('plotAreaBigha', (area / BIGHA_TO_M2).toFixed(6));
        updatePreviewCard(localConfig.crop, area);
        updateLiveAreaBanner(area);
      }
    }
    if (cfg.crop !== undefined) {
      const c = parseInt(cfg.crop);
      if (c >= 0 && c <= 7) {
        localConfig.crop = c;
        const sel = document.getElementById('cropSelectMain');
        if (sel) sel.value = c;
        updatePreviewCard(c, localConfig.plotArea_m2);
      }
    }
    if (cfg.weatherLocation !== undefined && WEATHER_LOCATIONS[cfg.weatherLocation]) {
      selectedWeatherLocation = cfg.weatherLocation;
      localConfig.weatherLocation = cfg.weatherLocation;
      const sel = document.getElementById('weatherLocation');
      if (sel) sel.value = cfg.weatherLocation;
      onWeatherLocationChange(cfg.weatherLocation);
    }
  });
}

// ============================================================
// SAVE CONFIG
// ============================================================
function saveConfig() {
  if (!firebaseDB) { showAlert("Firebase not connected"); return; }
  const m2  = localConfig.plotArea_m2;
  const loc = WEATHER_LOCATIONS[localConfig.weatherLocation] || WEATHER_LOCATIONS.bhopal;
  firebaseDB.ref('tscric/config').set({
    plotArea:             parseFloat(m2.toFixed(2)),
    plotArea_bigha:       parseFloat((m2 / BIGHA_TO_M2).toFixed(6)),
    crop:                 localConfig.crop,
    cropName:             CROP_DATA[localConfig.crop].name,
    weatherLocation:      localConfig.weatherLocation,
    weatherLocationLabel: loc.label,
    weatherLat:           loc.lat,
    weatherLon:           loc.lon,
    weatherAlt:           loc.alt,
    updatedAt:            Date.now()
  }).then(() => {
    showSavedBadge();
    updateLiveAreaBanner(m2);
  }).catch(e => showAlert("Save failed: " + e.message));
}

// ============================================================
// COMMANDS
// ============================================================
function sendCmd(cmd) {
  if (!firebaseDB) { showAlert("Firebase not connected"); return; }
  const MAP = {
    pump_on:   { pumpOn:true,  pumpOff:false },
    pump_off:  { pumpOn:false, pumpOff:true  },
    auto_on:   { auto:true  },
    manual_on: { auto:false }
  };
  firebaseDB.ref('tscric/commands').update(MAP[cmd])
    .catch(e => showAlert("Command error: " + e.message));
}

// ============================================================
// SAVE SOIL CALIBRATION TO FIREBASE
// ============================================================
function saveCalibration() {
  if (!firebaseDB) { showAlert("Firebase not connected"); return; }
  const payload = { soilCalib: {} };
  for (let i = 0; i < 3; i++) {
    const adc_dry = parseInt(document.getElementById(`calib_dry_${i}`)?.value) || calibData[i].adc_dry;
    const adc_fc  = parseInt(document.getElementById(`calib_fc_${i}`)?.value)  || calibData[i].adc_fc;
    const adc_pwp = parseInt(document.getElementById(`calib_pwp_${i}`)?.value) || calibData[i].adc_pwp;
    const vwc_fc  = parseFloat(document.getElementById(`vwc_fc_${i}`)?.value)  || calibData[i].vwc_fc;
    const vwc_pwp = parseFloat(document.getElementById(`vwc_pwp_${i}`)?.value) || calibData[i].vwc_pwp;
    calibData[i] = { adc_dry, adc_fc, adc_pwp, vwc_fc, vwc_pwp };
    payload.soilCalib[`ch${i}`] = calibData[i];
  }
  firebaseDB.ref('tscric/config').update(payload)
    .then(() => {
      const badge = document.getElementById('calibSavedBadge');
      if (badge) { badge.style.display = 'inline-block'; setTimeout(() => badge.style.display='none', 3000); }
    })
    .catch(e => showAlert("Calibration save failed: " + e.message));
}

// ============================================================
// UPDATE DASHBOARD — MASTER UPDATE FUNCTION
// ============================================================
function updateDashboard(d) {
  // ── LOCAL SENSOR DATA ──────────────────────────────────────
  const sm1  = fv(d.sm1);
  const sm2  = fv(d.sm2);
  const sm3  = fv(d.sm3);
  const csmi = fv(d.csmi);
  setText('sm1Val',  sm1.toFixed(1)  + '%');
  setText('sm2Val',  sm2.toFixed(1)  + '%');
  setText('sm3Val',  sm3.toFixed(1)  + '%');
  setText('csmiVal', csmi.toFixed(1) + '%');
  setBarHeight('bar1',    sm1);
  setBarHeight('bar2',    sm2);
  setBarHeight('bar3',    sm3);
  setBarHeight('barCSMI', csmi);

  setText('tempVal',  fv(d.temperature).toFixed(1));
  setText('humVal',   fv(d.humidity).toFixed(0));
  setText('presVal',  fv(d.pressure).toFixed(1));
  setText('flowVal',  fv(d.flowRate).toFixed(2));
  setText('csmiVal',  fv(d.csmi).toFixed(1));
  setText('aiScore',  fv(d.aiScore).toFixed(1));
  setText('smvVal',   fv(d.smv).toFixed(4));
  setText('smaVal',   fv(d.sma).toFixed(4));
  setText('tprVal',   fv(d.tprScore).toFixed(3));
  setText('etoVal',   fv(d.eto).toFixed(2));
  setText('rainVal',  fv(d.rainProb).toFixed(0));
  setText('cropName', d.crop  || '--');
  setText('stageName',d.stage || '--');
  setText('gddVal',   fv(d.gdd).toFixed(0));

  // ── OWM DATA (secondary — always displayed alongside) ──────
  const owmValid = d.owm_valid === true;
  setText('owmTemp',     owmValid ? fv(d.owm_temp).toFixed(1)     + ' °C'  : '--');
  setText('owmHumidity', owmValid ? fv(d.owm_humidity).toFixed(0) + ' %'   : '--');
  setText('owmPressure', owmValid ? fv(d.owm_pressure).toFixed(1) + ' hPa' : '--');
  setText('owmRain',     owmValid ? fv(d.owm_rain_mm).toFixed(2)  + ' mm'  : '--');

  const owmStatusEl = document.getElementById('owmStatus');
  if (owmStatusEl) {
    owmStatusEl.textContent = owmValid ? '🟢 OWM Live' : '🔴 OWM Unavailable';
    owmStatusEl.className   = 'owm-status ' + (owmValid ? 'owm-live' : 'owm-dead');
  }

  // ── CLOUD VS LOCAL COMPARISON ──────────────────────────────
  if (owmValid) {
    const tempDiff = fv(d.temperature) - fv(d.owm_temp);
    const humDiff  = fv(d.humidity)    - fv(d.owm_humidity);
    setText('cmpTemp', (tempDiff >= 0 ? '+' : '') + tempDiff.toFixed(1) + ' °C vs OWM');
    setText('cmpHum',  (humDiff  >= 0 ? '+' : '') + humDiff.toFixed(0)  + ' % vs OWM');
    setEl('cmpTemp', el => el.style.color = Math.abs(tempDiff) > 3 ? '#f0a500' : '#56d364');
    setEl('cmpHum',  el => el.style.color = Math.abs(humDiff)  > 10? '#f0a500' : '#56d364');
  } else {
    setText('cmpTemp', 'OWM offline');
    setText('cmpHum',  'OWM offline');
  }

  // ── SENSOR HEALTH STATUS ───────────────────────────────────
  updateSensorHealth(d);

  // ── WATER BUDGET ───────────────────────────────────────────
  const applied   = fv(d.deltaApplied);
  const required  = fv(d.deltaRequired);
  const balance   = fv(d.deltaBalance);
  const totalFlow = fv(d.totalLitres);
  const effRain   = fv(d.effectiveRain);
  const estRain   = fv(d.estimatedRain);
  const rainCtrib = fv(d.rainfallContrib);

  setText('appliedVal',   applied.toFixed(1)   + ' L');
  setText('requiredVal',  required.toFixed(1)  + ' L');
  setText('balanceVal',   balance.toFixed(1)   + ' L');
  setText('totalFlowVal', totalFlow.toFixed(1) + ' L');

  const pct = required > 0 ? Math.min((applied / required) * 100, 100) : 0;
  setEl('budgetProgress', el => el.style.width = pct.toFixed(1) + '%');
  setText('budgetPct', pct.toFixed(1) + '% of seasonal budget used');

  // Efficiency metric
  const totalInput = applied + rainCtrib;
  const efficiency = required > 0 ? Math.min((totalInput / required) * 100, 100) : 0;
  setText('irrigEfficiency', efficiency.toFixed(1) + '%');
  setText('rainfallContrib', rainCtrib.toFixed(1) + ' L');

  // ── RAINFALL ANALYTICS ─────────────────────────────────────
  const tipMM  = fv(d.tipBucket_mm);
  const owmMM  = owmValid ? fv(d.owm_rain_mm) : 0;
  setText('tipBucketVal',    tipMM > 0  ? tipMM.toFixed(2)  + ' mm' : 'No data');
  setText('owmRainfall',     owmMM > 0  ? owmMM.toFixed(2)  + ' mm' : 'No data');
  setText('estimatedRainVal',estRain > 0 ? '~' + estRain.toFixed(1) + ' mm' : 'None detected');
  setText('effectiveRainVal',effRain.toFixed(2) + ' mm');

  // Rain probability analytics
  const rainProb = fv(d.rainProb);
  setText('rainProbVal', rainProb.toFixed(0) + '%');
  const rainBarEl = document.getElementById('rainProbBar');
  if (rainBarEl) {
    rainBarEl.style.width = rainProb + '%';
    rainBarEl.style.background = rainProb > 75 ? '#f85149' : rainProb > 35 ? '#f0a500' : '#2ea043';
  }
  let rainCategory = rainProb < 20 ? '☀️ Clear'     :
                     rainProb < 40 ? '⛅ Possible'  :
                     rainProb < 70 ? '🌦️ Likely'    : '🌧️ Rain Expected';
  setText('rainCategory', rainCategory);

  // ── PUMP & CONTROL ─────────────────────────────────────────
  const pumpOn  = d.pump     || false;
  const autoMode= d.autoMode !== undefined ? d.autoMode : true;
  const faultOn = d.pipelineFault || false;

  setText('pumpStatusText', pumpOn  ? '💧 PUMP ON'    : '⭕ PUMP OFF');
  setText('pumpModeText',   autoMode? '🤖 Auto Mode'  : '✋ Manual Mode');
  setEl('pumpIndicator', el => el.className = 'pump-indicator' + (pumpOn ? ' on' : ''));
  setDisplay('faultBanner', faultOn ? 'block' : 'none');

  // ── SAFE MODE BANNER ───────────────────────────────────────
  const safeMode = d.safeMode || false;
  setDisplay('safeModePanel', safeMode ? 'block' : 'none');

  // ── OFFLINE MODE BANNER ────────────────────────────────────
  const offlineMode = d.offlineMode || false;
  const adaptiveMode= d.adaptiveMode || false;
  setDisplay('offlineBanner', (offlineMode || adaptiveMode) ? 'block' : 'none');
  if (offlineMode || adaptiveMode) {
    let msg = adaptiveMode
      ? '🌿 Operating in Adaptive Root-Zone Control Mode (Offline Remote Farm)'
      : '📡 Operating in Autonomous Offline Mode — Data stored locally';
    setText('offlineBannerMsg', msg);
  }

  // ── SENSOR FALLBACK INDICATORS ─────────────────────────────
  const dhtFallback = d.dhtFallback || false;
  const bmpFallback = d.bmpFallback || false;
  setDisplay('dhtFallbackBadge', dhtFallback ? 'inline-block' : 'none');
  setDisplay('bmpFallbackBadge', bmpFallback ? 'inline-block' : 'none');

  // ── AI SCORE CIRCLE ────────────────────────────────────────
  const score = fv(d.aiScore);
  setEl('aiCircle', el => el.className = 'ai-circle ' + (score >= 65 ? 'high' : score >= 35 ? 'medium' : 'low'));

  // ── REMAINING IRRIGATION ANALYTICS ────────────────────────
  const daysRemainingEstimate = balance > 0 && fv(d.eto) > 0
    ? (balance / (fv(d.eto) * fv(d.plotArea_m2) * 0.001)).toFixed(0) : '0';
  setText('daysRemaining', daysRemainingEstimate + ' days');
  setText('balRemaining',  balance.toFixed(1) + ' L');

  // ── LIVE AREA BANNER ───────────────────────────────────────
  if (d.plotArea_m2) updateLiveAreaBanner(parseFloat(d.plotArea_m2));
  setText('connMode', d.wifiMode || '--');

  // ── ONLINE/OFFLINE STATUS PANEL (connStatus2, loraStatus, offlineLogCount) ──
  const wifiOnline = (d.wifiMode === 'Online');
  setText('connStatus2', wifiOnline ? '🟢 Online' : '🔴 Offline / Hotspot');
  setEl('connStatus2', el => {
    el.style.background = wifiOnline ? 'rgba(46,160,67,0.15)' : 'rgba(248,81,73,0.12)';
    el.style.color       = wifiOnline ? 'var(--green-light)'    : 'var(--red)';
  });
  setText('loraStatus', 'Active');
  const pendingLogs = fv(d.offlineLogCount) || 0;
  setText('offlineLogCount', pendingLogs > 0 ? pendingLogs + ' pending' : '0 (synced)');
  setEl('offlineLogCount', el => {
    el.style.color = pendingLogs > 0 ? 'var(--orange)' : 'var(--green-light)';
  });

  // ── CROP STAGE INFO SUB-LINE ────────────────────────────────
  setText('cropStageInfo',
    'Stage: ' + (d.stage || '--') + '\u00a0|\u00a0GDD: ' + fv(d.gdd).toFixed(0) + ' \u00b0C\u00b7day');

  // ── OWM PRESSURE (sensor compare field) ────────────────────
  setText('owmPressure2',
    owmValid ? 'OWM: ' + fv(d.owm_pressure).toFixed(1) + ' hPa' : 'OWM: --');

  // ── AI SCORE text element (hero score value) ────────────────
  setText('aiScore', fv(d.aiScore).toFixed(1));

  // ── IRRIGATION HISTORY RECORD ──────────────────────────────
  // Track when pump turns ON
  if (pumpOn && (!lastData || !lastData.pump)) {
    addHistoryEntry({
      time:   new Date().toLocaleTimeString(),
      csmi:   fv(d.csmi).toFixed(1),
      ai:     score.toFixed(1),
      dose:   totalFlow.toFixed(1),
      reason: adaptiveMode ? 'Adaptive' : autoMode ? 'Auto-AI' : 'Manual'
    });
  }

  lastData = d;
}

// ============================================================
// SENSOR HEALTH STATUS PANEL
// ============================================================
function updateSensorHealth(d) {
  // Field name mapping — matches what firmware actually writes to Firebase:
  //   safeMode=true only when ALL 3 soil sensors fail
  //   dhtFallback=true when DHT22 failed and OWM is being used
  //   bmpFallback=true when BMP280 failed and OWM is being used
  //   pipelineFault=true when flow sensor detects blockage/leakage
  //   Firmware does NOT send sensorFault1/2/3 individually —
  //   infer individual health from CSMI reasonableness + safeMode flag
  const allSoilFailed  = d.safeMode        || false;
  const sm1Suspect     = allSoilFailed || (fv(d.sm1) <= 0 && fv(d.csmi) <= 0);
  const sm2Suspect     = allSoilFailed || (fv(d.sm2) <= 0 && fv(d.csmi) <= 0);
  const sm3Suspect     = allSoilFailed || (fv(d.sm3) <= 0 && fv(d.csmi) <= 0);
  const dhtFailed      = d.dhtFallback     || false;  // OWM fallback = sensor failed
  const bmpFailed      = d.bmpFallback     || false;
  const flowFailed     = d.pipelineFault   || false;

  const sensors = [
    { id:'sh_sm1',  name:'SM1 (15cm)',  ok: !sm1Suspect, fallback: false },
    { id:'sh_sm2',  name:'SM2 (30cm)',  ok: !sm2Suspect, fallback: false },
    { id:'sh_sm3',  name:'SM3 (45cm)',  ok: !sm3Suspect, fallback: false },
    { id:'sh_dht',  name:'DHT22',       ok: !dhtFailed,  fallback: dhtFailed },
    { id:'sh_bmp',  name:'BMP280',      ok: !bmpFailed,  fallback: bmpFailed },
    { id:'sh_flow', name:'YF-S201',     ok: !flowFailed, fallback: false },
    { id:'sh_lora', name:'LoRa SX1278', ok: true,        fallback: false }
  ];

  sensors.forEach(s => {
    const el = document.getElementById(s.id);
    if (!el) return;
    if (s.fallback) {
      el.innerHTML = `<span class="sh-dot warn"></span><span class="sh-name">${s.name}</span><span class="sh-stat warn">OWM Fallback</span>`;
    } else {
      el.innerHTML = `<span class="sh-dot ${s.ok ? 'ok' : 'fail'}"></span><span class="sh-name">${s.name}</span><span class="sh-stat ${s.ok ? 'ok' : 'fail'}">${s.ok ? 'OK' : 'FAULT'}</span>`;
    }
  });
}

// ============================================================
// PREVIEW CARD
// ============================================================
function updatePreviewCard(cropIdx, area_m2) {
  const crop = CROP_DATA[cropIdx] || CROP_DATA[0];
  const need  = crop.delta * area_m2;
  const bigha = area_m2 / BIGHA_TO_M2;
  setText('prevDelta', crop.delta + ' mm');
  setText('prevArea',  area_m2.toFixed(2)  + ' m²');
  setText('prevBigha', bigha.toFixed(6)    + ' Bigha');
  setText('prevNeed',  need.toFixed(1)     + ' L');
  setText('prevFC',    crop.fc             + '%');
  setText('prevPWP',   crop.pwp            + '%');
}

// ============================================================
// BAR HEIGHT
// ============================================================
function setBarHeight(id, pct) {
  const el = document.getElementById(id);
  if (!el) return;
  el.style.height = Math.max(2, Math.min(100, pct)) + '%';
}

// ============================================================
// AREA BANNER
// ============================================================
function updateLiveAreaBanner(area_m2) {
  const el = document.getElementById('liveArea');
  if (el) el.innerHTML = area_m2.toFixed(2) + ' m² (' + (area_m2/BIGHA_TO_M2).toFixed(4) + ' Bigha)';
}

// ============================================================
// HISTORY
// ============================================================
function addHistoryEntry(entry) {
  irrigHistory.unshift(entry);
  if (irrigHistory.length > MAX_HISTORY) irrigHistory.pop();
  try { localStorage.setItem('tscric_history', JSON.stringify(irrigHistory)); } catch(e) {}
  renderHistory();
}

function loadHistory() {
  try {
    const saved = localStorage.getItem('tscric_history');
    if (saved) irrigHistory = JSON.parse(saved);
    renderHistory();
  } catch(e) {}
}

function renderHistory() {
  const tbody = document.getElementById('historyBody');
  if (!tbody) return;
  if (!irrigHistory.length) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#8b949e">No events yet</td></tr>';
    return;
  }
  tbody.innerHTML = irrigHistory.map(e => `
    <tr>
      <td>${e.time}</td>
      <td>${e.csmi}%</td>
      <td>${e.ai}</td>
      <td>${e.dose} L</td>
      <td><span class="badge badge-${e.reason === 'Manual' ? 'manual' : e.reason === 'Adaptive' ? 'tpr' : 'auto'}">${e.reason}</span></td>
    </tr>
  `).join('');
}

// ============================================================
// CONNECTION WATCHDOG
// ============================================================
function connectionWatchdog() {
  const staleSec = (Date.now() - lastDataTime) / 1000;
  if (lastDataTime > 0 && staleSec > 60) {
    isConnected = false;
    setConnectionStatus('offline');
    setDisplay('offlineBanner', 'block');
    setText('offlineBannerMsg', '⚠️ No data for ' + Math.round(staleSec) + 's — Device may be offline');
  }
}

// ============================================================
// STATUS
// ============================================================
function setConnectionStatus(status) {
  const text = document.getElementById('connStatus');
  const dot  = document.getElementById('connDot');
  if (!text) return;
  const map = {
    online:  { t:'🟢 Live',    c:'status-dot online'  },
    offline: { t:'🟡 Offline', c:'status-dot offline' },
    error:   { t:'🔴 Error',   c:'status-dot error'   }
  };
  const s = map[status] || map.error;
  text.innerText = s.t;
  if (dot) dot.className = s.c;
}

// ============================================================
// INPUT HANDLERS
// ============================================================
function onCropChange(val) {
  localConfig.crop = parseInt(val);
  updatePreviewCard(localConfig.crop, localConfig.plotArea_m2);
}

function onM2Input(val) {
  if (updatingM2) return;
  const m2 = parseFloat(val);
  if (isNaN(m2)) return;
  localConfig.plotArea_m2    = m2;
  localConfig.plotArea_bigha = m2 / BIGHA_TO_M2;
  updatingBigha = true;
  silentFill('plotAreaBigha', localConfig.plotArea_bigha.toFixed(6));
  updatingBigha = false;
  updatePreviewCard(localConfig.crop, m2);
}

function onBighaInput(val) {
  if (updatingBigha) return;
  const bigha = parseFloat(val);
  if (isNaN(bigha)) return;
  const m2 = bigha * BIGHA_TO_M2;
  localConfig.plotArea_m2    = m2;
  localConfig.plotArea_bigha = bigha;
  updatingM2 = true;
  silentFill('plotAreaM2', m2.toFixed(2));
  updatingM2 = false;
  updatePreviewCard(localConfig.crop, m2);
}

function onWeatherLocationChange(val) {
  selectedWeatherLocation    = val;
  localConfig.weatherLocation= val;
  const loc = WEATHER_LOCATIONS[val];
  if (loc) {
    setText('weatherLocationInfo',
      `📍 Lat: ${loc.lat}°N  |  Lon: ${loc.lon}°E  |  Alt: ${loc.alt} m`);
    setText('weatherLocBanner', loc.label);
    // Also update the config sub line instantly
    const infoEl = document.getElementById('weatherLocationInfo');
    if (infoEl) infoEl.textContent =
      `📍 Lat: ${loc.lat}°N  |  Lon: ${loc.lon}°E  |  Alt: ${loc.alt} m`;
    // Re-fetch OWM for newly selected location
    fetchOWMDirect();
  }
}

// ============================================================
// ALERT / BADGES
// ============================================================
function showAlert(msg) {
  const bar = document.getElementById('alertBar');
  if (bar) { bar.style.display = 'block'; bar.innerText = msg; }
}

function showSavedBadge() {
  const badge = document.getElementById('configSavedBadge');
  if (badge) {
    badge.style.display = 'inline-block';
    setTimeout(() => badge.style.display = 'none', 3000);
  }
}

function updateLastUpdateTime() {
  setText('lastUpdate', 'Updated ' + new Date().toLocaleTimeString());
}

// ============================================================
// HELPERS
// ============================================================
function fv(v, def=0)   { return parseFloat(v) || def; }
function setText(id, v) { const e=document.getElementById(id); if(e) e.textContent=v; }
// ============================================================
// OWM DIRECT FETCH — works without hardware
// ============================================================
async function fetchOWMDirect() {
  var loc = WEATHER_LOCATIONS[selectedWeatherLocation] || WEATHER_LOCATIONS.bhopal;
  var weatherUrl  = 'https://api.openweathermap.org/data/2.5/weather?lat='  + loc.lat + '&lon=' + loc.lon + '&appid=' + OWM_DIRECT_KEY + '&units=metric';
  var forecastUrl = 'https://api.openweathermap.org/data/2.5/forecast?lat=' + loc.lat + '&lon=' + loc.lon + '&appid=' + OWM_DIRECT_KEY + '&units=metric&cnt=4';
  try {
    // Fetch current weather + 12hr forecast in parallel
    var results = await Promise.all([fetch(weatherUrl), fetch(forecastUrl)]);
    if (!results[0].ok) return;
    var j  = await results[0].json();
    var jf = results[1].ok ? await results[1].json() : null;

    // Rain probability: max pop from next 12hr forecast slots
    var rainProb = 0;
    if (jf && jf.list) {
      jf.list.forEach(function(slot) {
        if (slot.pop !== undefined && slot.pop * 100 > rainProb) rainProb = slot.pop * 100;
      });
    }

    owmDirectData = {
      owm_temp:     j.main ? j.main.temp     : null,
      owm_humidity: j.main ? j.main.humidity : null,
      owm_pressure: j.main ? j.main.pressure : null,
      owm_rain_mm:  j.rain ? (j.rain['1h'] || j.rain['3h'] || 0) : 0,
      owm_rain_prob: rainProb,
      owm_valid:    true
    };

    // Update OWM display
    setText('owmTemp',     owmDirectData.owm_temp !== null ? owmDirectData.owm_temp.toFixed(1) + ' °C' : '--');
    setText('owmHumidity', owmDirectData.owm_humidity !== null ? owmDirectData.owm_humidity.toFixed(0) + ' %' : '--');
    setText('owmPressure', owmDirectData.owm_pressure !== null ? owmDirectData.owm_pressure.toFixed(1) + ' hPa' : '--');
    setText('owmRain',     owmDirectData.owm_rain_mm > 0 ? owmDirectData.owm_rain_mm.toFixed(2) + ' mm' : '0.00 mm');
    setText('owmRainfall', owmDirectData.owm_rain_mm > 0 ? owmDirectData.owm_rain_mm.toFixed(2) + ' mm' : '0.00 mm');
    setText('owmPressure2','OWM: ' + (owmDirectData.owm_pressure !== null ? owmDirectData.owm_pressure.toFixed(1) + ' hPa' : '--'));
    var el = document.getElementById('owmStatus');
    if (el) { el.textContent = '🟢 OWM Live'; el.className = 'owm-status owm-live'; }

    // Update rain probability always when no hardware data
    if (!lastData) {
      // Fallback: if forecast failed, try pop from current weather
      if (rainProb === 0 && j.pop !== undefined) rainProb = j.pop * 100;
      var probText = rainProb.toFixed(0) + '%';
      setText('rainVal',     rainProb.toFixed(0));
      setText('rainProbVal', probText);
      var bar = document.getElementById('rainProbBar');
      if (bar) {
        bar.style.width = (rainProb > 0 ? rainProb : 2) + '%';
        bar.style.background = rainProb > 75 ? '#f85149' : rainProb > 35 ? '#f0a500' : '#2ea043';
      }
      var cat = rainProb < 20 ? '☀️ Clear' :
                rainProb < 40 ? '⛅ Possible' :
                rainProb < 70 ? '🌦️ Likely' : '🌧️ Rain Expected';
      setText('rainCategory', cat);
      setText('rainProbLabel', 'OWM Forecast');
    }
  } catch(e) {
    console.warn('OWM fetch failed:', e.message);
  }
}

function setEl(id, fn)  { const e=document.getElementById(id); if(e) fn(e); }
function setDisplay(id, v) { const e=document.getElementById(id); if(e) e.style.display=v; }
function silentFill(id, v) {
  const el = document.getElementById(id);
  if (el && document.activeElement !== el) el.value = v;
}

// ============================================================
// 🤖 TSCRIC FARM AI ASSISTANT (Rule-Based + Intelligent)
// ============================================================
// Advisory only — does NOT control relay, pump, or Firebase.
// All irrigation control remains deterministic + sensor-based.
// ============================================================

const AI_TIMEOUT_MS   = 15000;
const AI_MAX_HISTORY  = 10;

// Chat state
let aiChatHistory   = [];        // [{role:'user'|'model', text:'...'}]
let aiIsLoading     = false;
let aiOnline        = true;      // Tracks whether Gemini is reachable

// ── Init chat on page load ────────────────────────────────
function initAIChat() {
  updateAIStatusBadge('ready');
  appendAIMessage('model',
    "👋 Hello! I'm your AI Farm Assistant powered by Gemini.\n\n" +
    "I can help you understand your farm's soil condition, irrigation decisions, " +
    "water balance, sensor health, rainfall probability, and offline behavior.\n\n" +
    "Use the quick-ask chips above or type your question below. " +
    "I'm advisory only — all pump control remains with your TSCRIC-LoRa system.",
    true
  );
}

// ── Build structured farm context snapshot ────────────────
function buildFarmContext() {
  if (!lastData) return "No live sensor data available yet — waiting for Firebase connection.";
  const d  = lastData;
  const fv = v => isNaN(parseFloat(v)) ? 0 : parseFloat(v);

  const sensorHealth = [
    (!d.safeMode && fv(d.sm1) > 0) ? "SM1(15cm) OK"   : "SM1(15cm) FAULT",
    (!d.safeMode && fv(d.sm2) > 0) ? "SM2(30cm) OK"   : "SM2(30cm) FAULT",
    (!d.safeMode && fv(d.sm3) > 0) ? "SM3(45cm) OK"   : "SM3(45cm) FAULT",
    d.dhtFallback   ? "DHT22 FAULT [OWM fallback active]"  : "DHT22 OK",
    d.bmpFallback   ? "BMP280 FAULT [OWM fallback active]" : "BMP280 OK",
    d.pipelineFault ? "Flow/Pipeline FAULT — pump stopped" : "Flow sensor OK"
  ].join(" | ");

  const rainfallSrc =
    fv(d.tipBucket_mm) > 0 ? `Tipping bucket: ${fv(d.tipBucket_mm).toFixed(2)} mm (Priority 1 — direct measurement)` :
    fv(d.owm_rain_mm)  > 0 ? `OWM API: ${fv(d.owm_rain_mm).toFixed(2)} mm (Priority 2 — cloud)` :
    fv(d.estimatedRain)> 0 ? `Sensor estimation: ~${fv(d.estimatedRain).toFixed(1)} mm (Priority 3 — inferred)` :
    "No rainfall currently detected";

  const aiTrigger = fv(d.aiScore) >= 65 ? "ABOVE threshold — irrigation eligible" : "BELOW threshold — irrigation not triggered";

  return [
    `--- CROP & STAGE ---`,
    `Crop: ${d.crop || 'Unknown'} | Stage: ${d.stage || 'Unknown'} | GDD: ${fv(d.gdd).toFixed(0)} °C·day`,
    `Plot Area: ${fv(d.plotArea_m2).toFixed(2)} m² = ${fv(d.plotArea_bigha).toFixed(4)} Bigha`,
    ``,
    `--- SOIL MOISTURE (LOCAL SENSORS — PRIMARY) ---`,
    `SM1 @ 15cm: ${fv(d.sm1).toFixed(1)}%  |  SM2 @ 30cm: ${fv(d.sm2).toFixed(1)}%  |  SM3 @ 45cm: ${fv(d.sm3).toFixed(1)}%`,
    `CSMI (weighted composite): ${fv(d.csmi).toFixed(1)}%`,
    `VWC1: ${fv(d.vwc1).toFixed(3)}  |  VWC2: ${fv(d.vwc2).toFixed(3)}  |  VWC3: ${fv(d.vwc3).toFixed(3)}`,
    ``,
    `--- ENVIRONMENT (LOCAL SENSORS — PRIMARY) ---`,
    `Temperature: ${fv(d.temperature).toFixed(1)}°C (DHT22${d.dhtFallback ? ' — OWM fallback active' : ''})`,
    `Humidity: ${fv(d.humidity).toFixed(0)}% (DHT22${d.dhtFallback ? ' — OWM fallback active' : ''})`,
    `Pressure: ${fv(d.pressure).toFixed(1)} hPa (BMP280${d.bmpFallback ? ' — OWM fallback active' : ''})`,
    `ETo (Hargreaves-Samani): ${fv(d.eto).toFixed(2)} mm/day`,
    ``,
    `--- OPENWEATHERMAP (SECONDARY / VALIDATION) ---`,
    `OWM Status: ${d.owm_valid ? 'Active — live data' : 'Unavailable'}`,
    d.owm_valid ? `OWM Temp: ${fv(d.owm_temp).toFixed(1)}°C | OWM Humidity: ${fv(d.owm_humidity).toFixed(0)}% | OWM Pressure: ${fv(d.owm_pressure).toFixed(1)} hPa | OWM Rain: ${fv(d.owm_rain_mm).toFixed(2)} mm` : 'OWM data unavailable',
    ``,
    `--- AI SCORE & TRIGGERS ---`,
    `AI Score: ${fv(d.aiScore).toFixed(1)}/120 — ${aiTrigger}`,
    `SMV (velocity): ${fv(d.smv).toFixed(4)} %/hr | SMA (acceleration): ${fv(d.sma).toFixed(4)} %/hr²`,
    `TPR Score: ${fv(d.tprScore).toFixed(3)} (threshold 0.85 — ${fv(d.tprScore) >= 0.85 ? 'pattern match' : 'no match'})`,
    `Rain Probability: ${fv(d.rainProb).toFixed(0)}% (Zambretti pressure trend + OWM)`,
    ``,
    `--- RAINFALL ---`,
    `Active Source: ${rainfallSrc}`,
    `Effective Rainfall Applied to Budget: ${fv(d.effectiveRain).toFixed(2)} mm`,
    `Estimated Rainfall (sensor trend): ${fv(d.estimatedRain) > 0 ? '~' + fv(d.estimatedRain).toFixed(1) + ' mm' : 'none'}`,
    ``,
    `--- FLOW & PUMP ---`,
    `Flow Rate: ${fv(d.flowRate).toFixed(2)} L/min | Total Applied: ${fv(d.totalLitres).toFixed(1)} L`,
    `Pump: ${d.pump ? 'ON' : 'OFF'} | Mode: ${d.autoMode ? 'Automatic (AI-driven)' : 'Manual'}`,
    `Pipeline Fault: ${d.pipelineFault ? 'YES — pump automatically stopped' : 'None'}`,
    ``,
    `--- WATER BUDGET ---`,
    `Seasonal Required: ${fv(d.deltaRequired).toFixed(1)} L`,
    `Irrigation Applied: ${fv(d.deltaApplied).toFixed(1)} L`,
    `Rainfall Contribution: ${fv(d.rainfallContrib).toFixed(1)} L`,
    `Balance Remaining: ${fv(d.deltaBalance).toFixed(1)} L`,
    ``,
    `--- SYSTEM STATUS ---`,
    `Device Mode: ${d.offlineMode ? 'OFFLINE — autonomous operation' : 'ONLINE — Firebase connected'}`,
    `Safe Mode: ${d.safeMode ? 'ACTIVE — all soil sensors failed, irrigation limited' : 'Inactive'}`,
    `Adaptive Root-Zone Mode: ${d.adaptiveMode ? 'ACTIVE — offline farm, maintaining PWP-FC range' : 'Inactive'}`,
    `Offline Logs Pending Sync: ${fv(d.offlineLogCount) || 0}`,
    ``,
    `--- SENSOR HEALTH ---`,
    sensorHealth
  ].join("\n");
}

// ── Build full Gemini prompt ──────────────────────────────
function buildGeminiPrompt(userQuestion) {
  const ctx = buildFarmContext();
  return (
    "You are an intelligent agricultural irrigation assistant for the TSCRIC-LoRa Smart Irrigation System " +
    "deployed at Oriental College of Technology, Bhopal, India.\n\n" +
    "SYSTEM ARCHITECTURE:\n" +
    "- ESP8266 NodeMCU with SX1278 LoRa radio\n" +
    "- 3x Capacitive soil moisture sensors at 15cm, 30cm, 45cm depth\n" +
    "- DHT22 (temperature/humidity) + BMP280 (pressure)\n" +
    "- YF-S201 flow sensor + relay-controlled pump\n" +
    "- Firebase Realtime Database + OpenWeatherMap API\n" +
    "- Offline-capable with autonomous irrigation and offline store-and-sync\n" +
    "- AI scoring engine (12 components, 0-120 scale, threshold 65)\n" +
    "- Pulse irrigation: 30s ON / 2min OFF cycles\n" +
    "- Sensor priority: Local physical sensors > OpenWeatherMap API\n\n" +
    "CURRENT LIVE FARM DATA:\n" + ctx + "\n\n" +
    "IMPORTANT RULES:\n" +
    "- You are advisory only. Never suggest directly controlling the pump via this chat.\n" +
    "- Never suggest modifying Firebase values directly from this chat.\n" +
    "- Core irrigation control is deterministic and sensor-based.\n" +
    "- Keep responses concise, professional, and agriculture-focused.\n" +
    "- Use bullet points for multi-part answers.\n" +
    "- If a sensor fault exists, acknowledge it and explain the fallback.\n\n" +
    "USER QUESTION:\n" + userQuestion + "\n\n" +
    "Provide: 1) Direct answer 2) Brief explanation 3) Actionable advice if applicable."
  );
}

// ── Send message (main entry point) ──────────────────────
async function sendAIMessage() {
  const input = document.getElementById('aiUserInput');
  if (!input) return;
  const text = input.value.trim();
  if (!text || aiIsLoading) return;

  input.value = '';
  updateCharCount(0);
  autoResizeTextarea(input);

  appendAIMessage('user', text);
  await askGemini(text);
}

// ── Quick-ask chip handler ────────────────────────────────
async function quickAsk(question) {
  if (aiIsLoading) return;
  appendAIMessage('user', question);
  await askGemini(question);
}

// ── Auto-analyse button ───────────────────────────────────
async function runAutoAnalysis() {
  if (aiIsLoading) return;
  const question =
    "Please give me a full analysis of the current farm conditions. " +
    "Cover: soil moisture status, irrigation recommendation, sensor health, " +
    "rainfall situation, water balance, and any faults or warnings.";
  appendAIMessage('user', "⚡ Auto Farm Analysis requested");
  await askGemini(question);
}

// ── Core Gemini API call ──────────────────────────────────
async function askGemini(userQuestion) {
  if (aiIsLoading) return;
  setAILoading(true);
  updateAIStatusBadge('thinking');

  // Show thinking steps in badge while processing
  var thinkSteps = buildThinkingSteps(userQuestion);
  var stepIdx = 0;
  var thinkTimer = setInterval(function() {
    var badge = document.getElementById('aiStatusBadge');
    if (badge && stepIdx < thinkSteps.length) {
      badge.textContent = '◉ ' + thinkSteps[stepIdx];
      stepIdx++;
    }
  }, 400);

  // Delay so user sees thinking animation
  await new Promise(function(r){ setTimeout(r, thinkSteps.length * 420 + 300); });

  clearInterval(thinkTimer);

  try {
    var reply = ruleBasedResponse(userQuestion);
    aiChatHistory.push({ role: 'user',  parts: [{ text: userQuestion }] });
    aiChatHistory.push({ role: 'model', parts: [{ text: reply }] });
    appendAIMessage('model', reply);
    updateAIStatusBadge('ready');
  } catch(e) {
    appendAIMessage('model', 'Kuch problem aayi. Dobara try karo.');
  } finally {
    setAILoading(false);
  }
}

function buildThinkingSteps(q) {
  var q2 = q.toLowerCase();
  var steps = ['Sawaal samajh raha hoon...'];

  // Detect topic and build relevant thinking chain
  if (/temp|garmi|thand|celsius|degree|mausam|weather/.test(q2)) {
    steps.push('Temperature data dekh raha hoon...');
    if (/paani|sinchai|irrigation|water/.test(q2)) {
      steps.push('Temp aur mitti ka relation check kar raha hoon...');
      steps.push('ETo evaporation calculate kar raha hoon...');
      steps.push('Sinchai ki zaroorat estimate kar raha hoon...');
    } else {
      steps.push('OWM cloud data fetch kar raha hoon...');
      steps.push('Local sensor se compare kar raha hoon...');
    }
  } else if (/pump|motor|shuru|start|band/.test(q2)) {
    steps.push('Pump status check kar raha hoon...');
    steps.push('Pipeline aur sensor fault dekh raha hoon...');
    steps.push('AI score evaluate kar raha hoon...');
  } else if (/baarish|barish|rain|barsaat/.test(q2)) {
    steps.push('OWM forecast data dekh raha hoon...');
    steps.push('Rain probability calculate kar raha hoon...');
    steps.push('Mitti condition se compare kar raha hoon...');
  } else if (/mitti|soil|moisture|naami|nami|dry|wet|paani hai/.test(q2)) {
    steps.push('SM1, SM2, SM3 sensor readings dekh raha hoon...');
    steps.push('CSMI calculate kar raha hoon...');
    steps.push('Crop ke liye optimal range check kar raha hoon...');
  } else if (/kitna paani|paani kitna|lagega|litre/.test(q2)) {
    steps.push('Plot area aur ETo dekh raha hoon...');
    steps.push('Moisture deficit calculate kar raha hoon...');
    steps.push('Irrigation requirement estimate kar raha hoon...');
  } else if (/sensor|kharab|fault|dht|bmp/.test(q2)) {
    steps.push('Sensor health check kar raha hoon...');
    steps.push('Fault flags dekh raha hoon...');
    steps.push('Fallback mode status check kar raha hoon...');
  } else if (/budget|bacha|balance|litre/.test(q2)) {
    steps.push('Water budget calculate kar raha hoon...');
    steps.push('Applied vs required compare kar raha hoon...');
  } else if (/sab theek|ok hai|everything|health/.test(q2)) {
    steps.push('Sab sensors check kar raha hoon...');
    steps.push('Connection status dekh raha hoon...');
    steps.push('Budget aur pump status verify kar raha hoon...');
  } else {
    steps.push('Context samajh raha hoon...');
    steps.push('Sensor data se match kar raha hoon...');
  }

  steps.push('Jawab taiyaar kar raha hoon...');
  return steps;
}

// ════════════════════════════════════════════════════════════
// IRRIGATION MASTER INTENT DETECTOR
// Covers every possible farmer question about irrigation
// ════════════════════════════════════════════════════════════

function detectIrrigationIntent(q2, has, d, fv) {
  // ── GROUP 1: Sinchai kab karni chahiye ──────────────────
  if (has(['kab sinchai','kab pani','kab paani','kab lagao','kab dena','kab dalni','kab chalao',
            'sinchai ka time','paani ka time','time kya hai sinchai','kab karna','abhi karo',
            'aaj karo','kal karo','subah karo','shaam karo','raat karo','dopahar karo',
            'when to irrigate','when to water','when should i water','irrigation time',
            'best time sinchai','sahi time','sahi waqt','kis waqt'])) return 'irrig_when';

  // ── GROUP 2: Kitni der sinchai ───────────────────────────
  if (has(['kitni der','kitna time','kitne minute','kitne ghante','der tak','time lagega',
            'how long','duration','kitni baar','how many times','frequency','baar baar',
            'ek baar mein kitna','ek session','session kitna lamba','interval','gap kitna',
            'kitne interval','2 din mein','3 din mein','weekly','daily'])) return 'irrig_duration';

  // ── GROUP 3: Kitna paani ─────────────────────────────────
  if (has(['kitna paani','kitna pani','paani kitna','pani kitna','kitne litre','litre kitna',
            'liter kitna','how much water','paani ki matra','matra kitni','quantity',
            'kitna dena','ek baar mein kitna paani','how many litres','measure',
            'paani naap','naap','amount','kitna use','consumption','kitna consume',
            'per bigha paani','per meter paani','area ke hisaab'])) return 'irrig_quantity';

  // ── GROUP 4: Sinchai band karo / rokna ──────────────────
  if (has(['sinchai band','paani band','pump band','rokna','roko','stop irrigation',
            'stop water','paani rokna','pump rokna','band karo','kab band','band kab',
            'khatam karo','close','shut','off karo pump','off kab','kab off'])) return 'irrig_stop';

  // ── GROUP 5: Sinchai sahi hai ya nahi ───────────────────
  if (has(['sahi hai','theek hai','sahi ho rahi','properly ho rahi','correct hai',
            'acchi hai','properly chal','sahi chal','ho rahi hai na','chal rahi hai',
            'irrigation ok','working properly','sahi tarike','sahi se','properly',
            'irrigation sahi','paani sahi','koi dikkat nahi','issue nahi'])) return 'irrig_ok';

  // ── GROUP 6: Zyada paani / overwatering ─────────────────
  if (has(['zyada paani','zyada pani','bahut paani','over water','overwater',
            'paani zyada ho gaya','zyada ho gaya','flood','pani bhar gaya',
            'jal bhutt','waterlog','waterlogged','bahut geela','bahut wet',
            'root rot','paani bhar','bhara hua','standing water','jamaa paani',
            'ulta nuksaan','nuksaan paani se','paani se kharab'])) return 'irrig_over';

  // ── GROUP 7: Kam paani / underwatering ──────────────────
  if (has(['kam paani','thoda paani','paani kam','pani kam','paani nahi mil raha',
            'under water','underwater','paani ki kami','kami','insufficient',
            'not enough water','paani poora nahi','paani adhura','sukha pad raha',
            'mitti sukh rahi','mitti sookh','wilting','murjha','murjhana',
            'patta murjha','fasal murjha','sukha raha'])) return 'irrig_under';

  // ── GROUP 8: Drip / sprinkler / method ──────────────────
  if (has(['drip','sprinkler','flood irrigation','furrow','border','method',
            'tarika','kaisa dena','kaise dena','kaise lagao','irrigation system',
            'trickle','micro irrigation','surface irrigation','pipe se',
            'nali se','hose se','bore se','borewell','well se','nalkoop',
            'tube well','canal','nahar','tanki se','tank se'])) return 'irrig_method';

  // ── GROUP 9: Pump problem during irrigation ──────────────
  if (has(['pump band ho gaya','pump ruk gaya','pump nahi chal raha','pump fail',
            'motor jam','motor band','motor ruk','pump choke','no flow',
            'paani nahi aa raha','flow nahi','pressure kam','pressure nahi',
            'pipe block','nali band','nali block','chhid','leak','tuta',
            'paani leak','pipe tuta','pressure drop'])) return 'irrig_pump_fail';

  // ── GROUP 10: Schedule banana ────────────────────────────
  if (has(['schedule','plan','planning','programme','timetable','routine',
            'daily plan','weekly plan','kal ka','parso ka','agle hafte',
            'month plan','season plan','schedule banana','plan banana',
            'irrigation plan','watering schedule','kab kab','kis din'])) return 'irrig_schedule';

  // ── GROUP 11: Baarish ke baad sinchai ───────────────────
  if (has(['baarish ke baad','rain ke baad','barish ke baad','after rain',
            'baarish ho gayi','rain ho gaya','barish ho gayi','baarish aayi',
            'baarish aane ke baad','baarish hone ke baad','pani gira',
            'baarish mein','during rain','baarish chal rahi'])) return 'irrig_after_rain';

  // ── GROUP 12: Garmi mein sinchai ────────────────────────
  if (has(['garmi mein','garam mein','summer mein','dhoop mein','tez dhoop',
            'loo mein','lू mein','heat mein','garmi ke time','hot weather',
            'garmi mein kitna','garmi mein kab','42 degree','40 degree',
            'peak summer','mausam garam','bahut garmi'])) return 'irrig_heat';

  // ── GROUP 13: Raat mein sinchai ──────────────────────────
  if (has(['raat mein','night mein','raat ko','night ko','andhera mein',
            'raat wali sinchai','evening mein','sham mein','subah mein',
            'early morning','dawn','dusk','sunrise','sunset',
            'morning irrigation','raat 12','raat 2','subah 4','subah 5'])) return 'irrig_timing';

  // ── GROUP 14: Fasal sukhna / stress ─────────────────────
  if (has(['fasal sukh','fasal mar','fasal kharab','plant dying','paudha mar',
            'paudha sukh','yellow','peela','patta peela','leaves yellow',
            'brown leaves','patta bhoora','dry leaves','fasal stress',
            'crop stress','wilting','murjha gaya','jhad gaya','jhar','sukha',
            'dead plant','mar gaya','kharab ho gaya fasal'])) return 'irrig_stress';

  // ── GROUP 15: Soil test / condition ─────────────────────
  if (has(['soil test','mitti test','mitti check','mitti kaisi','mitti dekhna',
            'soil moisture','moisture check','check karo mitti','hath se',
            'anguli se','finger test','mitti dabao','daba ke dekho',
            'moisture meter','sensor reading','reading kya hai','kya reading'])) return 'irrig_soil_check';

  // ── GROUP 16: Fertilizer ke saath paani ─────────────────
  if (has(['khad ke saath','fertilizer ke saath','urea ke saath','dap ke saath',
            'fertigation','khad dete waqt','khad dene ke baad','chemical dene ke baad',
            'spray ke baad','pesticide ke baad','insecticide','fungicide',
            'khad aur paani','fertilizer aur paani','urea aur paani'])) return 'irrig_fertilizer';

  // ── GROUP 17: Nayi fasal lagana ─────────────────────────
  if (has(['nayi fasal','naya crop','beej lagaya','seedling','paudha lagaya',
            'transplant','nayi kheti','germination','ankur','ankhwa',
            'seedbed','nursery','cutting lagaya','grafting','naya paudha',
            'abhi lagaya','kal lagaya','beej abhi','fresh planting'])) return 'irrig_new_plant';

  // ── GROUP 18: Flow sensor / meter ───────────────────────
  if (has(['flow sensor','flow meter','water meter','flow rate','flow kya hai',
            'kitna flow','flow nahi dikh','flow zero','paani ka flow',
            'yf-s201','meter kharab','sensor paani','flow galat','reading galat'])) return 'irrig_flow';

  // ── GROUP 19: AI ne galat decision ──────────────────────
  if (has(['ai galat','ai ne galat','ai ka decision galat','system ne galat',
            'galat sinchai','galat time','kyu shuru kiya','kyu nahi kiya',
            'manually karna','override','manual karna','ai pe bharosa nahi',
            'ai theek nahi','system theek nahi','ai ganda','ai bekar'])) return 'irrig_ai_wrong';

  // ── GROUP 20: Paani bachana ──────────────────────────────
  if (has(['paani bachao','pani bachao','water save','water conservation',
            'kam paani mein','less water','water efficient','save water',
            'paani waste','waste mat karo','paani zyada use','water waste',
            'efficient irrigation','water management','resource'])) return 'irrig_save';

  // ── GROUP 21: Soil too wet ──────────────────────────────
  if (has(['mitti geeli','soil wet','bahut geeli','wet soil','mitti mein paani zyada',
            'waterlogged','waterlog','paani jam','jam gaya paani','bhar gaya',
            'geeli mitti','mitti bhigi','bhigi hui','soggy','saturation',
            'drainage nahi','paani nahi ja raha','nikas nahi'])) return 'soil_wet';

  // ── GROUP 22: Soil too dry ───────────────────────────────
  if (has(['mitti sukhi','soil dry','bahut sukhi','dry soil','nami nahi',
            'water deficiency','sukha soil','khushk mitti','mitti kadi',
            'mitti tight','crack','dararein','dara hua','phat gaya',
            'mitti phat','cracks in soil','sookhi mitti','ekdam sukhi'])) return 'soil_dry';

  // ── GROUP 23: Best method ────────────────────────────────
  if (has(['best irrigation','best method','kaunsa irrigation','drip ya sprinkler',
            'kaunsa better','konsa tarika','konsa method','irrigation type',
            'which method','drip better','sprinkler better','flood better',
            'furrow','basin','check basin','border strip'])) return 'best_method';

  // ── GROUP 24: Water saving ───────────────────────────────
  if (has(['water saving','paani bachao','pani bachao','save water','water efficiency',
            'efficiently','paani zyada use','waste ho raha','meter reading',
            'bill zyada','boring se','borewell level','ground water',
            'water table','table kam ho raha','pani ki kami area mein'])) return 'water_save';

  // ── GROUP 25: Night irrigation ───────────────────────────
  if (has(['raat mein irrigation','night irrigation','raat ko paani',
            'night watering','raat 12','raat 1','raat 2','raat 3',
            'andheri mein','raat wala','midnight irrigation',
            'late evening','late night paani'])) return 'night_irrigation';

  // ── GROUP 26: High temp irrigation ──────────────────────
  if (has(['garmi mein irrigation','high temperature irrigation','heat irrigation',
            'summer irrigation','42','43','44','45 degree','loo lag rahi',
            'peak garmi','tez dhoop irrigation','dopahar irrigation',
            'garam mausam','bahut tej garmi','heat wave'])) return 'heat_irrigation';

  // ── GROUP 27: Rain expected ──────────────────────────────
  if (has(['baarish aayegi','rain expected','baarish hogi','rain forecast',
            'kal baarish','aaj baarish','baarish aane wali','rain coming',
            'cloud aaya','badal aaya','andhera chhaya','asmaan kaala',
            'mausam kharab','baarish ka mauka','barish ki ummeed'])) return 'rain_expected';

  // ── GROUP 28: Pump nonstop ───────────────────────────────
  if (has(['pump continuously','pump band nahi ho raha','motor continuously',
            'pump nonstop','pump ruk nahi raha','lagatar chal raha','non-stop',
            'pump kab bandh','pump kyu nahi rukta','overrun','pump overheating',
            'motor garam','motor hot','pump jala','pump jalega'])) return 'pump_continuous';

  // ── GROUP 29: Low pressure ───────────────────────────────
  if (has(['pressure kam','low pressure','water pressure low','pipe pressure',
            'pressure nahi','pressure drop','paani dheere aa raha','dheera flow',
            'weak flow','paani dheeree','flow weak','trickle only',
            'pressure theek nahi','nozzle se nahi aa raha'])) return 'low_pressure';

  // ── GROUP 30: Irrigation complete ───────────────────────
  if (has(['irrigation complete','sinchai complete','enough water','paani kaafi',
            'paani ho gaya','pani poora','sinchai poori','ho gayi sinchai',
            'sufficient moisture','kaafi ho gaya','ab aur nahi','bas karo'])) return 'irrig_complete';

  // ── GROUP 31: Irrigation frequency ──────────────────────
  if (has(['kitni baar','how often','baar baar','frequency','interval kya',
            'roz karo','alternate day','har din','2 din mein ek baar',
            'weekly','daily irrigation','ek hafte mein','mahine mein kitni baar',
            'kitne ghante mein ek baar','gap kitna'])) return 'irrig_frequency';

  // ── GROUP 32: Root zone irrigation ──────────────────────
  if (has(['root zone','jad tak paani','roots tak','deep watering','deep irrigation',
            'shallow watering','surface watering','paani upar hi raha',
            'neeche nahi ja raha','penetration','deep penetrate',
            'jad gehra','root deep','subsurface'])) return 'root_zone';

  // ── GROUP 33: Evaporation / ETo ─────────────────────────
  if (has(['evaporation','evapotranspiration','eto','vapour','bhap','naami ud rahi',
            'naami ud jaati','udna','ud gaya paani','mulch','mulching',
            'dhakna','cover karo mitti','straw mulch','plastic mulch'])) return 'evaporation';

  // ── GROUP 34: Saline / water quality ────────────────────
  if (has(['namkeen paani','saline','salt','khaara','water quality','paani kaisa',
            'water test','paani ka ph','ph level','ec level','tds',
            'mineral','hard water','soft water','bore ka paani kaisa',
            'paani accha hai','canal ka paani'])) return 'water_quality';

  // ── GROUP 35: Pipeline / pipe maintenance ────────────────
  if (has(['pipe maintenance','pipeline check','pipe clean','nali saaf',
            'nali check','drip tape','emitter','emitter block','nozzle block',
            'filter saaf','filter clean','screen filter','disk filter',
            'pipe replace','pipe purani','pipe toot','pipe kharab'])) return 'pipeline_maint';

  // ── GROUP 36: Bore / water source ───────────────────────
  if (has(['bore','borewell','tubewell','nalkoop','kuan','well','tanki',
            'tank','reservoir','canal','nahar','river se','nadi se',
            'pond','talab','water source','source kya','paani kahan se',
            'boring','boring gahri','bore level','water level bore'])) return 'water_source';

  // ── GROUP 37: Irrigation for specific crop ───────────────
  if (has(['gehun ko','wheat ko','chawal ko','rice ko','paddy ko','makka ko',
            'soybean ko','ganne ko','sugarcane ko','dal ko','arhar ko',
            'tomato ko','tamatar ko','pyaz ko','onion ko','aloo ko',
            'potato ko','sarson ko','mustard ko','sunflower ko'])) return 'crop_specific_irrig';

  // ── GROUP 38: Soil type irrigation ──────────────────────
  if (has(['sandy soil','baluyi mitti','clay soil','chikni mitti','loam',
            'domat','black soil','kaali mitti','red soil','lal mitti',
            'mitti ka type','soil type','mitti bhaari','bhaari mitti',
            'halki mitti','porous soil','retentive'])) return 'soil_type_irrig';

  // ── GROUP 39: Irrigation cost / electricity ──────────────
  if (has(['bijli','electricity','current','power','cost','kharcha',
            'bijli bill','motor ka kharcha','pump cost','electricity use',
            'unit kitni','watt','horsepower','hp pump','kw','kwh',
            'solar pump','solar se','diesel pump','petrol pump'])) return 'irrig_cost';

  // ── GROUP 40: Sensor not matching reality ────────────────
  if (has(['sensor galat','sensor sahi nahi','reading sahi nahi','galat reading',
            'manually dekha','haath se check','anguli se','finger check',
            'sensor match nahi','reality alag','actual alag','sensor lie',
            'sensor jhooth','calibrate','calibration'])) return 'sensor_mismatch';

  return null; // Not an irrigation question
}

// ════════════════════════════════════════════════════════════
// IRRIGATION RESPONSE HANDLERS
// ════════════════════════════════════════════════════════════

function irrigationMasterResponse(intent, d, fv, owm, soilCond, rainI, calcIrrigLitres) {
  var sc = soilCond ? soilCond() : null;
  var ri = rainI ? rainI() : { prob: 0, mm: 0, src: 'OWM' };
  var calc = calcIrrigLitres ? calcIrrigLitres() : null;
  var csmi = d ? fv(d.csmi) : 0;
  var temp = d ? fv(d.temperature) : (owm && owm.owm_temp ? owm.owm_temp : 25);
  var eto  = d ? fv(d.eto) : 3;

  switch(intent) {

    // ── WHEN TO IRRIGATE ──────────────────────────────────
    case 'irrig_when': {
      var L = ['⏰ **Sinchai Kab Karni Chahiye?**\n'];
      if (!d) { L.push('📡 Sensor data nahi hai — hardware check karo.'); return L.join('\n'); }
      L.push('Mitti: ' + (sc ? sc.level : '--') + ' (' + csmi.toFixed(1) + '%)');
      L.push('AI Score: ' + fv(d.aiScore).toFixed(1) + '/120');
      L.push('Rain: ' + ri.prob.toFixed(0) + '%');
      L.push('');
      if (ri.prob > 65) {
        L.push('🌧️ **Abhi nahi!** Baarish ' + ri.prob.toFixed(0) + '% expected.');
        L.push('→ Baarish ke 3-4 ghante baad mitti check karo.');
      } else if (csmi < 25) {
        L.push('🚨 **Abhi turant karo!** Mitti bahut dry hai.');
      } else if (csmi < 40) {
        L.push('⚠️ **Aaj karo.** Mitti dry ho rahi hai.');
        L.push('→ Best time: Subah 6-9 baje ya Shaam 5-7 baje.');
        L.push('→ Dhoop mein sinchai mat karo — evaporation zyada hoga.');
      } else if (fv(d.aiScore) >= 65) {
        L.push('⚡ AI Score threshold cross kar gaya — pump jald trigger hoga!');
      } else {
        L.push('✅ Abhi zaroorat nahi. Mitti optimal hai.');
        L.push('→ CSMI ' + csmi.toFixed(1) + '% — theek hai.');
        L.push('→ Agli check: 4-6 ghante mein karo.');
      }
      L.push('\n💡 Best time: Subah ya shaam — kabhi bhi tez dhoop mein nahi.');
      return L.join('\n');
    }

    // ── DURATION ─────────────────────────────────────────
    case 'irrig_duration': {
      var L = ['⏱️ **Sinchai Kitni Der Karni Chahiye?**\n'];
      if (!d) { L.push('📡 Sensor data nahi — hardware check karo.'); return L.join('\n'); }
      var area = fv(d.plotArea_m2) || 10;
      var flowR = fv(d.flowRate) > 0 ? fv(d.flowRate) : 5;
      var neededL = calc ? parseFloat(calc.needed) : (area * 0.5);
      var mins = (neededL / flowR).toFixed(0);
      L.push('📐 Area: ' + area.toFixed(1) + ' m²');
      L.push('💧 Flow rate: ' + flowR.toFixed(2) + ' L/min');
      L.push('🎯 Moisture deficit: ' + (calc ? calc.needed + ' L' : '--'));
      L.push('');
      L.push('⏱️ **Estimated duration: ~' + mins + ' minutes**');
      L.push('');
      L.push('📌 System ka tarika (pulse irrigation):');
      L.push('• 30 sec ON → 2 min OFF → repeat');
      L.push('• Jab tak CSMI 45-60% nahi hoti');
      L.push('• AI automatically band kar dega');
      L.push('');
      if (csmi > 60) L.push('⚠️ Mitti already ' + csmi.toFixed(1) + '% — zyada der nahi karo!');
      else if (csmi < 25) L.push('🔥 Bahut dry — full cycle chalao: ~' + mins + ' min minimum.');
      L.push('\n💡 Manual mein hai toh CSMI 50% hone par band karo.');
      return L.join('\n');
    }

    // ── QUANTITY ─────────────────────────────────────────
    case 'irrig_quantity': {
      var L = ['💧 **Kitna Paani Dena Chahiye?**\n'];
      if (!d) { L.push('📡 Sensor data nahi.'); return L.join('\n'); }
      var area = fv(d.plotArea_m2) || 10;
      L.push('📐 Area: ' + area.toFixed(1) + ' m² (' + fv(d.plotArea_bigha).toFixed(4) + ' Bigha)');
      L.push('🌱 CSMI: ' + csmi.toFixed(1) + '%');
      L.push('💧 ETo: ' + eto.toFixed(2) + ' mm/day');
      L.push('');
      if (calc) {
        L.push('📊 **Calculation:**');
        L.push('• Moisture deficit: ~' + calc.needed + ' L');
        L.push('• Daily ETo loss: ~' + calc.eto_l + ' L');
        var total = (parseFloat(calc.needed) + parseFloat(calc.eto_l)).toFixed(1);
        L.push('• **Total needed: ~' + total + ' L**');
        L.push('');
        if (temp > 35) {
          L.push('🔥 Garmi ke wajah se 20% extra add karo: ~' + (parseFloat(total) * 1.2).toFixed(1) + ' L');
        }
      }
      L.push('💰 Budget remaining: ' + fv(d.deltaBalance).toFixed(1) + ' L');
      if (ri.prob > 40) L.push('\n🌧️ ' + ri.prob.toFixed(0) + '% baarish — thoda kam do, baarish poora karega.');
      return L.join('\n');
    }

    // ── STOP IRRIGATION ──────────────────────────────────
    case 'irrig_stop': {
      var L = ['🛑 **Sinchai Kab Band Karni Chahiye?**\n'];
      if (!d) { L.push('📡 Sensor data nahi.'); return L.join('\n'); }
      L.push('Mitti abhi: ' + (sc ? sc.level : '--') + ' (' + csmi.toFixed(1) + '%)');
      L.push('Pump: ' + (d.pump ? '🟢 ON — chal rahi hai sinchai' : '🔴 OFF — already band hai'));
      L.push('');
      if (!d.pump) {
        L.push('✅ Pump pehle se band hai.');
      } else if (csmi >= 55) {
        L.push('🛑 **Abhi band karo!** Mitti ' + csmi.toFixed(1) + '% — kaafi ho gaya.');
        L.push('→ Auto mode mein hai toh AI khud band karega.');
        L.push('→ Manual mein hai toh pump off karo.');
      } else if (csmi >= 45) {
        L.push('⚡ CSMI 45% — optimal range mein aa raha hai. Thodi der mein band karo.');
      } else {
        L.push('⏳ Abhi mat roko — mitti abhi bhi dry hai (' + csmi.toFixed(1) + '%).');
        L.push('→ 50% CSMI hone par band karna theek rahega.');
      }
      L.push('');
      L.push('💡 Auto band hone ki conditions:');
      L.push('• CSMI 60%+ ho jaye');
      L.push('• AI Score 0 ho jaye');
      L.push('• Pipeline fault detect ho');
      L.push('• Baarish probability 80%+ ho');
      return L.join('\n');
    }

    // ── IRRIGATION OK ─────────────────────────────────────
    case 'irrig_ok': {
      var L = ['✅ **Sinchai Sahi Ho Rahi Hai?**\n'];
      if (!d) { L.push('📡 Sensor data nahi.'); return L.join('\n'); }
      var issues = [];
      if (d.pipelineFault) issues.push('🔴 Pipeline fault — flow nahi ho raha!');
      if (d.safeMode)      issues.push('🔴 Safe mode — sensors fail, sinchai restricted');
      if (fv(d.flowRate) <= 0 && d.pump) issues.push('🟡 Pump ON hai lekin flow 0 — check karo!');
      if (issues.length === 0) {
        L.push('✅ Haan! Sinchai sahi chal rahi hai.\n');
        L.push('• Pump: ' + (d.pump ? '🟢 ON' : '⚪ Standby'));
        L.push('• Flow: ' + fv(d.flowRate).toFixed(2) + ' L/min');
        L.push('• CSMI: ' + csmi.toFixed(1) + '%');
        L.push('• Total applied: ' + fv(d.totalLitres).toFixed(1) + ' L');
        L.push('• AI Score: ' + fv(d.aiScore).toFixed(1) + '/120');
      } else {
        L.push('⚠️ Nahi! Kuch issues hain:\n');
        issues.forEach(function(i) { L.push(i); });
      }
      return L.join('\n');
    }

    // ── OVERWATERING ─────────────────────────────────────
    case 'irrig_over': {
      var L = ['💦 **Zyada Paani — Kya Karo?**\n'];
      if (!d) {
        L.push('Zyada paani ke nuksaan:\n• Root rot (jad sadna)\n• Fungal disease\n• Nutrient washout\n• Oxygen kami roots mein\n\nKya karo:\n• Sinchai turant band karo\n• Drainage check karo\n• 2-3 din wait karo\n• Mitti sukhne do naturally');
        return L.join('\n');
      }
      L.push('CSMI abhi: ' + csmi.toFixed(1) + '%');
      L.push('Pump: ' + (d.pump ? '🟢 ON — BAND KARO!' : '🔴 OFF'));
      L.push('');
      if (csmi > 75) {
        L.push('🚨 **Bahut zyada paani hai!**\n');
        L.push('Turant karo:');
        L.push('1. Pump band karo (OFF karo)');
        L.push('2. Drainage check karo — paani nikal raha hai?');
        L.push('3. 24-48 ghante koi sinchai nahi');
        L.push('4. Mitti naturally sukhne do');
        L.push('\n⚠️ Zyada paani ke nuksaan:');
        L.push('• Root rot — jad sadne lagti hai');
        L.push('• Fungal infection — fasal kharab');
        L.push('• Nutrients wash out ho jaate hain');
      } else if (csmi > 60) {
        L.push('⚠️ Mitti wet hai (' + csmi.toFixed(1) + '%) — zyada nahi abhi.');
        L.push('→ Pump band rakho — khud sukhegi.');
      } else {
        L.push('✅ CSMI ' + csmi.toFixed(1) + '% — normal range mein hai. Zyada nahi hua.');
      }
      return L.join('\n');
    }

    // ── UNDERWATERING ────────────────────────────────────
    case 'irrig_under': {
      var L = ['🏜️ **Kam Paani — Fasal Sukh Rahi Hai?**\n'];
      if (!d) {
        L.push('Kam paani ke nuksaan:\n• Wilting — patta murjhana\n• Stunted growth\n• Yield kam hona\n• Nutrient uptake nahi\n\nTurant karo:\n• Sinchai shuru karo\n• Agle 24hr closely monitor karo');
        return L.join('\n');
      }
      L.push('CSMI: ' + csmi.toFixed(1) + '% — ' + (sc ? sc.level : '--'));
      L.push('AI Score: ' + fv(d.aiScore).toFixed(1) + '/120');
      L.push('');
      if (csmi < 20) {
        L.push('🚨 **Bahut dry hai!** Fasal stress mein hai.');
        L.push('Turant karo:');
        L.push('1. Pump abhi ON karo');
        L.push('2. CSMI 45% hone tak chalao');
        if (calc) L.push('3. ~' + calc.needed + ' L paani do');
        L.push('4. Agli 6 ghante mein dobara check karo');
      } else if (csmi < 35) {
        L.push('⚠️ Mitti dry hai — sinchai ki zaroorat hai.');
        L.push('→ AI Score ' + fv(d.aiScore).toFixed(0) + ' — ' + (fv(d.aiScore) >= 65 ? 'pump jald ON hoga.' : 'thoda aur dry hone do.'));
        if (calc) L.push('→ ~' + calc.needed + ' L paani dena hoga.');
      } else {
        L.push('✅ CSMI ' + csmi.toFixed(1) + '% — abhi theek hai. Zyada dry nahi hua.');
      }
      return L.join('\n');
    }

    // ── METHOD ───────────────────────────────────────────
    case 'irrig_method': {
      return '🚿 **Sinchai ka Tarika**\n\n' +
        'Aapka TSCRIC-LoRa system **pulse drip irrigation** use karta hai:\n\n' +
        '• 30 sec ON → 2 min OFF → repeat\n' +
        '• Root zone tak paani pahunchta hai slowly\n' +
        '• Water waste bahut kam hota hai\n\n' +
        '📊 **Comparison:**\n' +
        '• Flood: 100% water use — bahut waste\n' +
        '• Sprinkler: 70% efficiency\n' +
        '• Drip (aapka): 90%+ efficiency ✅\n\n' +
        '💡 Best practices:\n' +
        '• Subah ya shaam ko irrigate karo\n' +
        '• Tez dhoop mein nahi\n' +
        '• Soil surface nahi, root zone target karo';
    }

    // ── PUMP FAIL DURING IRRIGATION ──────────────────────
    case 'irrig_pump_fail': {
      var L = ['🔴 **Sinchai Mein Pump Problem!**\n'];
      if (!d) {
        L.push('Hardware data nahi — physically check karo:\n• Power supply\n• Fuse\n• Motor wiring\n• Pipeline block/leak');
        return L.join('\n');
      }
      L.push('Pump: ' + (d.pump ? '🟢 ON (chal raha)' : '🔴 OFF'));
      L.push('Flow: ' + fv(d.flowRate).toFixed(2) + ' L/min');
      L.push('Pipeline fault: ' + (d.pipelineFault ? '🔴 YES' : '✅ No'));
      L.push('');
      L.push('🔍 **Check karo (priority order):**');
      L.push('1. Power supply theek hai?\n   → MCB/fuse trip toh nahi?');
      L.push('2. Pipeline block hai?\n   → Manually check karo water aa raha hai?');
      L.push('3. Flow sensor (YF-S201) theek hai?\n   → Reading 0 toh sensor kharab ho sakta');
      L.push('4. Pump motor check karo\n   → Sound aa raha? Zyada garam toh nahi?');
      L.push('5. Inlet filter clean karo\n   → Dirt se choke ho jaata hai');
      if (d.pipelineFault) L.push('\n⚠️ Pipeline fault detected! System ne pump auto-band kar diya safety ke liye.');
      return L.join('\n');
    }

    // ── SCHEDULE ─────────────────────────────────────────
    case 'irrig_schedule': {
      var L = ['📅 **Irrigation Schedule**\n'];
      if (!d) {
        L.push('General schedule (bina sensor ke):\n• Garmi mein: Roz subah + shaam\n• Sardi mein: Har 2-3 din\n• Baarish mein: Zaroorat nahi\n\nLekin sensor-based system mein AI khud decide karta hai!');
        return L.join('\n');
      }
      var crop = (d.crop || 'general').toLowerCase();
      L.push('🌾 Fasal: ' + (d.crop || 'Set nahi'));
      L.push('🌡️ Temp: ' + temp.toFixed(1) + '°C');
      L.push('💧 ETo: ' + eto.toFixed(2) + ' mm/day');
      L.push('');
      L.push('📋 **Recommended Schedule:**');
      if (temp > 38) {
        L.push('• Garmi bahut zyada — Roz DO baar sinchai');
        L.push('  Subah: 6-8 AM | Shaam: 5-7 PM');
      } else if (temp > 28) {
        L.push('• Roz ya har 2 din — Subah 6-9 AM best');
      } else {
        L.push('• Har 2-3 din — Subah ya shaam');
      }
      L.push('');
      if (ri.prob > 50) L.push('🌧️ Aaj baarish expected — schedule adjust karo!');
      L.push('');
      L.push('🤖 Note: TSCRIC-LoRa AI score se auto-decide karta hai — manual schedule ki zaroorat nahi!');
      return L.join('\n');
    }

    // ── AFTER RAIN ───────────────────────────────────────
    case 'irrig_after_rain': {
      var L = ['🌧️ **Baarish Ke Baad Sinchai?**\n'];
      if (ri.mm > 0) L.push('Baarish aayi: ' + ri.mm.toFixed(2) + ' mm (recorded)');
      if (d) {
        L.push('CSMI abhi: ' + csmi.toFixed(1) + '%');
        L.push('');
        if (csmi > 55) {
          L.push('✅ **Sinchai ki zaroorat nahi!** Baarish se kaafi paani mila.');
          L.push('→ Mitti ' + csmi.toFixed(1) + '% — optimal range mein hai.');
          L.push('→ 24-48 ghante baad check karo.');
        } else if (csmi > 40) {
          L.push('✅ Mitti theek hai abhi — 1-2 din wait karo phir decide karo.');
        } else {
          L.push('⚠️ Baarish ke baad bhi mitti dry hai — sinchai ki zaroorat hai.');
          L.push('→ Baarish kam thi ya dry spell lamba tha.');
        }
      } else {
        L.push('General rule:\n• Baarish 10mm+ → 1-2 din sinchai nahi\n• Baarish 5mm → half irrigation\n• Baarish 2mm se kam → normal irrigation\n• Mitti check karo haath se.');
      }
      L.push('\n💡 System automatic decide karega — OWM rainfall data use hota hai.');
      return L.join('\n');
    }

    // ── HEAT IRRIGATION ──────────────────────────────────
    case 'irrig_heat': {
      var L = ['🔥 **Garmi Mein Sinchai**\n'];
      L.push('🌡️ Temp: ' + temp.toFixed(1) + '°C');
      if (d) L.push('💧 CSMI: ' + csmi.toFixed(1) + '%');
      L.push('');
      L.push('⚠️ **Garmi mein dhyan do:**');
      L.push('• Kabhi bhi 11 AM - 4 PM mein sinchai mat karo!');
      L.push('  → Evaporation 60% zyada hoti hai');
      L.push('  → Paani waste hoga, fasal ko nahi milega');
      L.push('  → Patte burn ho sakte hain droplets se');
      L.push('');
      L.push('✅ **Sahi time:**');
      L.push('• Subah: 5 AM - 8 AM (BEST)');
      L.push('• Shaam: 5 PM - 7 PM');
      L.push('');
      if (temp > 40) {
        L.push('🔥 40°C+ — Roz 2 baar sinchai karo!');
        L.push('• ETo bahut high — paani ki demand 2x ho jaati hai');
        if (d && calc) L.push('• ~' + (parseFloat(calc.needed) * 1.3).toFixed(1) + ' L chahiye (garmi adjustment)');
      } else if (temp > 35) {
        L.push('☀️ 35-40°C — Daily sinchai + 15-20% zyada paani');
      }
      L.push('\n💡 Mulching karo — mitti se evaporation 30% kam hogi.');
      return L.join('\n');
    }

    // ── TIMING (subah/raat) ───────────────────────────────
    case 'irrig_timing': {
      return '🕐 **Sinchai ka Sahi Waqt**\n\n' +
        '✅ **Best time:**\n' +
        '• Subah 5-8 AM — sabse acha!\n' +
        '  → Cool temp, kam evaporation\n' +
        '  → Patte sukhne ka time milta hai (disease kam)\n' +
        '  → Roots raat bhar absorb karte hain\n\n' +
        '• Shaam 5-7 PM — acceptable\n' +
        '  → Thanda hone ke baad\n' +
        '  → Raat ko roots absorb karte hain\n\n' +
        '❌ **Kabhi nahi:**\n' +
        '• Dopahar 11 AM - 4 PM\n' +
        '  → Evaporation maximum\n' +
        '  → Paani waste\n' +
        '  → Fasal stress\n\n' +
        '🌙 **Raat ko sinchai:**\n' +
        '• Drip irrigation mein okay hai\n' +
        '• Sprinkler mein nahi — fungal disease badhti hai\n' +
        '• Aapka pulse drip system — raat mein bhi chal sakta hai';
    }

    // ── CROP STRESS ──────────────────────────────────────
    case 'irrig_stress': {
      var L = ['😰 **Fasal Stress / Murjha Rahi Hai?**\n'];
      if (!d) {
        L.push('Immediate steps:\n1. Turant thoda paani do\n2. Dhoop se protect karo\n3. Mitti check karo\n4. Agle 2 ghante closely dekho');
        return L.join('\n');
      }
      L.push('CSMI: ' + csmi.toFixed(1) + '% — ' + (sc ? sc.level : '--'));
      L.push('Temp: ' + temp.toFixed(1) + '°C');
      L.push('');
      if (csmi < 25) {
        L.push('🚨 **Confirmed — Paani ki kami se stress!**\n');
        L.push('Turant karo:');
        L.push('1. Pump ON karo ABHI');
        L.push('2. CSMI 50% tak le aao');
        if (calc) L.push('3. ~' + calc.needed + ' L minimum do');
        L.push('4. Agar patta bahut murjhaya → thoda paani haath se bhi do');
        L.push('5. 2 ghante mein recovery dekho');
      } else if (csmi < 40 && temp > 38) {
        L.push('⚠️ Mitti dry + Bahut garmi — heat stress ho sakta hai!');
        L.push('→ Sinchai karo + Mulching karo');
      } else if (csmi > 70) {
        L.push('💦 Mitti bahut wet hai — overwatering se stress!');
        L.push('→ Sinchai band karo');
        L.push('→ Drainage check karo');
        L.push('→ Root rot ke symptoms dekho');
      } else {
        L.push('Mitti theek hai — stress kisi aur wajah se ho sakta hai:');
        L.push('• Nutrient deficiency — khad do');
        L.push('• Pest/disease — spray karo');
        L.push('• Sudden temperature change');
      }
      return L.join('\n');
    }

    // ── SOIL CHECK ───────────────────────────────────────
    case 'irrig_soil_check': {
      var L = ['🌱 **Mitti Check — Reading Kya Hai?**\n'];
      if (!d) {
        L.push('📡 Sensor data nahi hai.\n\nManual check karo:\n• Anguli 5cm andar daalo\n• Geeli = theek\n• Sukhi = sinchai chahiye\n• Bahut geeli = zyada paani');
        return L.join('\n');
      }
      L.push('Sensor Readings:\n');
      L.push('• SM1 (15cm depth): ' + fv(d.sm1).toFixed(1) + '%' + (fv(d.sm1) <= 0 ? ' ⚠️ FAULT' : ''));
      L.push('• SM2 (30cm depth): ' + fv(d.sm2).toFixed(1) + '%' + (fv(d.sm2) <= 0 ? ' ⚠️ FAULT' : ''));
      L.push('• SM3 (45cm depth): ' + fv(d.sm3).toFixed(1) + '%' + (fv(d.sm3) <= 0 ? ' ⚠️ FAULT' : ''));
      L.push('• CSMI (overall): ' + csmi.toFixed(1) + '%');
      L.push('• VWC1: ' + fv(d.vwc1).toFixed(3) + ' m³/m³');
      L.push('• VWC2: ' + fv(d.vwc2).toFixed(3) + ' m³/m³');
      L.push('• VWC3: ' + fv(d.vwc3).toFixed(3) + ' m³/m³');
      L.push('');
      L.push('📊 Interpretation:');
      L.push('• <20% = Bahut dry 🔴');
      L.push('• 20-35% = Dry 🟡');
      L.push('• 35-60% = Optimal ✅');
      L.push('• 60-80% = Moist 🟢');
      L.push('• >80% = Bahut wet 🔵');
      L.push('');
      L.push('💡 Status: ' + (sc ? sc.level + ' — ' + sc.advice : '--'));
      return L.join('\n');
    }

    // ── FERTILIZER + WATER ────────────────────────────────
    case 'irrig_fertilizer': {
      return '🌿 **Khad Dene Ke Saath/Baad Paani**\n\n' +
        '📌 **Rules:**\n\n' +
        '• **Urea:** Dene ke BAAD paani do\n' +
        '  → Nitrogen absorb hone ke liye naami chahiye\n' +
        '  → Nahi diya toh urea burn karega\n\n' +
        '• **DAP/MOP:** Paani ke SAATH ya BAAD dono okay\n' +
        '  → Root zone tak pahunchne ke liye naami chahiye\n\n' +
        '• **Spray (liquid fertilizer):** Pehle thoda paani do\n' +
        '  → Sukhi mitti mein spray effective nahi hota\n\n' +
        '• **Pesticide/Fungicide spray ke baad:**\n' +
        '  → 24-48 ghante sinchai mat karo\n' +
        '  → Chemical wash na ho jaye\n\n' +
        '💡 Fertigation (drip se khad dena):\n' +
        '• Sabse efficient method\n' +
        '• Direct root zone tak\n' +
        '• 30-40% fertilizer bachta hai';
    }

    // ── NEW PLANT ─────────────────────────────────────────
    case 'irrig_new_plant': {
      return '🌱 **Nayi Fasal / Seedling Lagaya — Paani Kaise Dein?**\n\n' +
        '📋 **Pehle 7 din (critical period):**\n' +
        '• Roz paani do — mitti hamesha thodi geeli raho\n' +
        '• Zyada nahi — roots abhi weak hain\n' +
        '• Subah ka time best\n' +
        '• Light irrigation — heavy flood nahi\n\n' +
        '📋 **1-2 hafte baad:**\n' +
        '• Sensor reading dekho\n' +
        '• AI score follow karo\n' +
        '• Normal schedule shuru karo\n\n' +
        '⚠️ **Nayi seedling ke liye:**\n' +
        '• Tez dhoop mein transplant nahi\n' +
        '• Transplant ke turant baad paani do\n' +
        '• Pehle 3 din shade karo agar possible\n\n' +
        '💡 Sensor CSMI 40-55% maintain karo nayi seedling ke liye.';
    }

    // ── FLOW SENSOR ──────────────────────────────────────
    case 'irrig_flow': {
      var L = ['💧 **Flow Sensor Status**\n'];
      if (!d) { L.push('📡 Data nahi hai.'); return L.join('\n'); }
      L.push('Flow rate: ' + fv(d.flowRate).toFixed(3) + ' L/min');
      L.push('Total litres: ' + fv(d.totalLitres).toFixed(2) + ' L');
      L.push('Pipeline fault: ' + (d.pipelineFault ? '🔴 YES' : '✅ No'));
      L.push('');
      if (d.pipelineFault) {
        L.push('🔴 **Flow sensor problem hai!**\n');
        L.push('Check karo:');
        L.push('• YF-S201 sensor wiring (VCC, GND, Signal)');
        L.push('• Pipeline mein paani aa raha hai?');
        L.push('• Sensor ke andar debris toh nahi?');
        L.push('• Min flow threshold: 0.5 L/min');
      } else if (d.pump && fv(d.flowRate) < 0.1) {
        L.push('⚠️ Pump ON hai lekin flow bahut kam hai!');
        L.push('→ Pipeline block check karo');
        L.push('→ Inlet filter clean karo');
      } else if (d.pump) {
        L.push('✅ Flow normal hai.');
      } else {
        L.push('ℹ️ Pump OFF hai — flow 0 normal hai.');
      }
      return L.join('\n');
    }

    // ── AI WRONG DECISION ─────────────────────────────────
    case 'irrig_ai_wrong': {
      var L = ['🤔 **AI ka Decision Galat Laga?**\n'];
      if (!d) { L.push('📡 Sensor data nahi.'); return L.join('\n'); }
      L.push('Current AI decision:');
      L.push('• AI Score: ' + fv(d.aiScore).toFixed(1) + '/120');
      L.push('• Pump: ' + (d.pump ? '🟢 ON' : '🔴 OFF'));
      L.push('• CSMI: ' + csmi.toFixed(1) + '%');
      L.push('• Rain prob: ' + fv(d.rainProb).toFixed(0) + '%');
      L.push('');
      L.push('💡 **AI ye factors dekh ke decide karta hai:**');
      L.push('• Soil moisture velocity (kitni tezi se dry ho raha)');
      L.push('• CSMI level');
      L.push('• Rain probability');
      L.push('• ETo (evaporation)');
      L.push('• Temperature pattern');
      L.push('');
      L.push('🔧 **Manual override karo agar AI galat lag raha:**');
      L.push('• Dashboard mein Manual mode on karo');
      L.push('• Physical pump button use karo');
      L.push('• Auto mode wapas on karo jab ready ho');
      L.push('');
      L.push('📞 Agar consistently galat — sensor calibration check karo.');
      return L.join('\n');
    }

    // ── WATER SAVING ──────────────────────────────────────
    case 'irrig_save': {
      return '💰 **Paani Bachane ke Tarike**\n\n' +
        '✅ **Aapka TSCRIC system already karta hai:**\n' +
        '• Pulse irrigation (30 sec ON/2 min OFF) — 40% water saved\n' +
        '• Sensor-based — sirf zaroorat padne par\n' +
        '• Rain probability check — baarish se pehle nahi\n' +
        '• Root-zone targeting — surface waste nahi\n\n' +
        '💡 **Aur bhi kar sakte ho:**\n' +
        '• Mulching — mitti par layer lagao (dry hone se bchata)\n' +
        '• Subah sinchai — evaporation 50% kam\n' +
        '• Drip emitter check — leak nahi hona chahiye\n' +
        '• Weed remove karo — pani ka competition\n' +
        '• Soil organic matter badhao — water retention badhti hai\n\n' +
        '📊 **Estimated savings:**\n' +
        '• Flood vs Drip: 50-60% paani bachta hai\n' +
        '• Night vs Morning: 30% evaporation difference\n' +
        '• Mulching: 20-30% soil moisture improve';
    }

    default:
      return null;
  }
}


// ════════════════════════════════════════════════════════════════
// TSCRIC ULTRA INTELLIGENCE ENGINE v4.0
// - Multi-layer intent detection with confidence scoring
// - Conversation memory & context learning
// - Cross-topic reasoning
// - Real sensor data integration
// - Hinglish + English + farmer slang support
// ════════════════════════════════════════════════════════════════

// ── Conversation Memory (session) ────────────────────────────────
var aiMemory = {
  lastTopic:    null,
  lastQuestion: null,
  learnedFacts: {},  // things user told us e.g. crop, area
  sessionCount: 0,
  corrections:  []   // when user said "galat" we store it
};

// ── Normalize query ───────────────────────────────────────────────
function normalizeQ(q) {
  return q.toLowerCase()
    .replace(/[?!।,\.]/g, ' ')
    .replace(/kya|hai|hain|mera|meri|mere|aapka|please|plz|bhai|yaar|dost/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

// ── Token scorer ──────────────────────────────────────────────────
function tokenScore(q2, words) {
  var score = 0;
  words.forEach(function(w) {
    if (q2.indexOf(w) !== -1) {
      // Exact phrase match = higher score
      score += w.split(' ').length > 1 ? 3 : 1;
    }
  });
  return score;
}

// ── Context from sensor data ──────────────────────────────────────
function getFarmContext() {
  var d = lastData || null;
  var owm = owmDirectData || null;
  var fv = function(v) { return isNaN(parseFloat(v)) ? 0 : parseFloat(v); };
  return { d: d, owm: owm, fv: fv };
}

// ── Soil condition helper ─────────────────────────────────────────
function getSoilLevel(csmi) {
  if (csmi < 20) return { level: 'Bahut Dry 🔴', urgent: true,  action: 'Turant sinchai karo!' };
  if (csmi < 35) return { level: 'Dry 🟡',        urgent: true,  action: 'Sinchai ki zaroorat hai.' };
  if (csmi < 60) return { level: 'Optimal ✅',    urgent: false, action: 'Mitti bilkul theek hai.' };
  if (csmi < 80) return { level: 'Moist 🟢',      urgent: false, action: 'Sinchai mat karo abhi.' };
  return           { level: 'Bahut Wet 🔵',        urgent: false, action: 'Drainage check karo!' };
}

// ── Rain info helper ─────────────────────────────────────────────
function getRainInfo() {
  var ctx = getFarmContext(), d = ctx.d, owm = ctx.owm, fv = ctx.fv;
  var prob = 0, src = 'OWM', mm = 0;
  if (d && fv(d.rainProb) > 0) { prob = fv(d.rainProb); src = 'Local'; }
  else if (owm && owm.owm_rain_prob > 0) { prob = owm.owm_rain_prob; src = 'OWM Forecast'; }
  if (d && fv(d.owm_rain_mm) > 0) mm = fv(d.owm_rain_mm);
  else if (owm && owm.owm_rain_mm > 0) mm = owm.owm_rain_mm;
  return { prob: prob, src: src, mm: mm };
}

// ── Water calc helper ─────────────────────────────────────────────
function getWaterCalc() {
  var ctx = getFarmContext(), d = ctx.d, fv = ctx.fv;
  if (!d) return null;
  var area   = fv(d.plotArea_m2) || 10;
  var eto    = fv(d.eto) || 3;
  var csmi   = fv(d.csmi);
  var deficit = Math.max(0, 50 - csmi);
  var needed  = (deficit / 100) * area * 300;
  var eto_l   = eto * area;
  return { needed: needed.toFixed(1), eto_l: eto_l.toFixed(1), total: (needed + eto_l).toFixed(1), area: area };
}

// ════════════════════════════════════════════════════════════════
// MASTER RESPONSE FUNCTION — called by askGemini
// ════════════════════════════════════════════════════════════════
function ruleBasedResponse(q) {
  var ctx = getFarmContext();
  var d = ctx.d, owm = ctx.owm, fv = ctx.fv;
  var q2 = normalizeQ(q);
  aiMemory.sessionCount++;
  aiMemory.lastQuestion = q2;

  // ── STEP 1: Learn from user ─────────────────────────────────
  // If user mentions their crop
  var cropMentions = {
    'wheat':'Wheat','gehun':'Wheat','gehu':'Wheat',
    'rice':'Rice','paddy':'Rice','chawal':'Rice',
    'makka':'Maize','corn':'Maize','maize':'Maize',
    'soybean':'Soybean','soya':'Soybean',
    'ganna':'Sugarcane','sugarcane':'Sugarcane',
    'tomato':'Tomato','tamatar':'Tomato',
    'potato':'Potato','aloo':'Potato',
    'onion':'Onion','pyaz':'Onion',
    'cotton':'Cotton','kapas':'Cotton',
    'mustard':'Mustard','sarson':'Mustard',
    'gram':'Gram','chana':'Gram'
  };
  Object.keys(cropMentions).forEach(function(k) {
    if (q2.indexOf(k) !== -1) aiMemory.learnedFacts.crop = cropMentions[k];
  });

  // If user corrects us
  if (/galat|wrong|nahi yeh|sahi nahi|ulta|seedha nahi/.test(q2)) {
    aiMemory.corrections.push(q2);
    aiMemory.lastTopic = null;
    return '😅 Maafi! Mujhe sahi samajh nahi aaya.\n\nThoda aur detail mein batao:\n• Kya poochh rahe the exactly?\n• Kaun sa topic — soil, pump, baarish, paani?\n\nMain better jawab dunga! 🙏';
  }

  // ── STEP 1b: KAISE / KYUN / KAB — Common reasoning questions ──────

  // Extract subject + question word for reasoning
  var isKaise = /kaise|kaisa|kaisi|kese|kasa|how/.test(q2);
  var isKyun  = /kyun|kyu|kyon|why|wajah|reason|isliye|kya wajah|kya reason/.test(q2);
  var isKab   = /kab|kab tak|kab se|when|kitni der|kitne time|kitne minute|kitne ghante|abhi kab|kab karo|kab hoga|kab band|kab on/.test(q2);
  var isKitna = /kitna|kitni|kitne|how much|how many|quantity|matra|amount/.test(q2);

  // ── KAISE questions ──────────────────────────────────────────
  if (isKaise) {
    var ctx0 = getFarmContext(), d0 = ctx0.d, fv0 = ctx0.fv, owm0 = ctx0.owm;
    var ri0 = getRainInfo(), sl0 = d0 ? getSoilLevel(fv0(d0.csmi)) : null;

    // Pump kaise
    if (/pump|motor|engine|chalu|start/.test(q2)) {
      if (!d0) return '📡 Data nahi — hardware check karo.';
      var L = ['🔌 **Pump Kaise Kaam Karta Hai?**\n'];
      L.push('Mode: ' + (d0.autoMode ? '🤖 Auto (AI)' : '🖐️ Manual'));
      L.push('Score: ' + fv0(d0.aiScore).toFixed(1) + '/120');
      L.push('');
      L.push('🧠 Reasoning:');
      L.push('1. AI sensor data collect karta hai');
      L.push('2. CSMI, SMV, TPR score calculate karta hai');
      L.push('3. Score 65+ → Pump ON');
      L.push('4. Rain check → 70%+ rain? Pump OFF rakho');
      L.push('5. CSMI 55%+ → Pump band');
      L.push('');
      L.push('Abhi: Score ' + fv0(d0.aiScore).toFixed(0) + ' → ' + (fv0(d0.aiScore) >= 65 ? 'Eligible ✅' : 'Wait ❌'));
      return L.join('\n');
    }

    // Sinchai kaise
    if (/sinchai|irrigation|paani do|paani dena|water/.test(q2)) {
      var L = ['💧 **Sinchai Kaise Hoti Hai?**\n'];
      L.push('System pulse drip use karta hai:');
      L.push('• 30 sec ON → 2 min OFF → repeat');
      L.push('• Jab tak CSMI 50%+ nahi hoti');
      L.push('• Auto mode mein AI khud control karta hai');
      L.push('');
      if (d0) {
        L.push('Abhi:');
        L.push('• Pump: ' + (d0.pump ? '🟢 ON — ho rahi hai' : '🔴 OFF'));
        L.push('• Flow: ' + fv0(d0.flowRate).toFixed(2) + ' L/min');
        L.push('• CSMI: ' + fv0(d0.csmi).toFixed(1) + '%');
      }
      L.push('');
      L.push('Best time: Subah 5-8 AM ya Shaam 5-7 PM');
      return L.join('\n');
    }

    // Mitti/paani kaisi
    if (/mitti|soil|paani|pani|nami|naami|moisture/.test(q2)) {
      if (!d0) return '📡 Data nahi.';
      var L = ['🌱 **Mitti Kaisi Hai?**\n'];
      L.push('CSMI: ' + fv0(d0.csmi).toFixed(1) + '% — ' + (sl0 ? sl0.level : '--'));
      L.push('• 15cm: ' + fv0(d0.sm1).toFixed(1) + '%');
      L.push('• 30cm: ' + fv0(d0.sm2).toFixed(1) + '%');
      L.push('• 45cm: ' + fv0(d0.sm3).toFixed(1) + '%');
      L.push('');
      L.push('🧠 Matlab:');
      if (fv0(d0.csmi) < 20)      L.push('🔴 Bahut dry — turant sinchai karo!');
      else if (fv0(d0.csmi) < 35) L.push('🟡 Dry — sinchai ki zaroorat hai.');
      else if (fv0(d0.csmi) < 60) L.push('✅ Perfect — koi action nahi chahiye.');
      else if (fv0(d0.csmi) < 80) L.push('🟢 Moist — mat karo sinchai abhi.');
      else                         L.push('🔵 Bahut wet — drainage check karo!');
      return L.join('\n');
    }

    // Baarish kaisi
    if (/baarish|barish|rain|mausam|weather/.test(q2)) {
      var L = ['🌧️ **Mausam Kaisa Hai?**\n'];
      if (owm0) {
        L.push('🌡️ Temp: ' + (owm0.owm_temp !== null ? owm0.owm_temp.toFixed(1) + '°C' : '--'));
        L.push('💧 Humidity: ' + (owm0.owm_humidity !== null ? owm0.owm_humidity.toFixed(0) + '%' : '--'));
        L.push('🌀 Pressure: ' + (owm0.owm_pressure !== null ? owm0.owm_pressure.toFixed(1) + ' hPa' : '--'));
      }
      L.push('🌂 Rain: ' + ri0.prob.toFixed(0) + '%');
      if      (ri0.prob > 75) L.push('🌧️ Pakki baarish aayegi!');
      else if (ri0.prob > 50) L.push('⛅ Baarish hone wali hai.');
      else if (ri0.prob > 25) L.push('🌤️ Thodi sambhavna.');
      else                    L.push('☀️ Saaf mausam — baarish nahi.');
      return L.join('\n');
    }

    // Sensor kaisa
    if (/sensor|dht|bmp|flow|hardware/.test(q2)) {
      if (!d0) return '📡 Hardware data nahi aa raha.';
      var ok0 = !d0.safeMode && !d0.dhtFallback && !d0.bmpFallback && !d0.pipelineFault;
      var L = ['🔧 **Sensors Kaise Hain?**\n'];
      L.push(ok0 ? '✅ Sab sensors theek hain!' : '⚠️ Kuch sensors mein problem hai!');
      L.push('• DHT22: ' + (d0.dhtFallback ? '🔴 Fault' : '✅ OK'));
      L.push('• BMP280: ' + (d0.bmpFallback ? '🔴 Fault' : '✅ OK'));
      L.push('• SM1: ' + (fv0(d0.sm1) > 0 ? '✅ ' + fv0(d0.sm1).toFixed(1) + '%' : '🔴 No reading'));
      L.push('• SM2: ' + (fv0(d0.sm2) > 0 ? '✅ ' + fv0(d0.sm2).toFixed(1) + '%' : '🔴 No reading'));
      L.push('• SM3: ' + (fv0(d0.sm3) > 0 ? '✅ ' + fv0(d0.sm3).toFixed(1) + '%' : '🔴 No reading'));
      L.push('• Flow: ' + (d0.pipelineFault ? '🔴 Fault' : '✅ OK'));
      return L.join('\n');
    }

    // System/sab kaise
    if (/system|sab|dashboard|overall|farm|kheti/.test(q2)) {
      if (!d0) return '📡 Hardware connected nahi.';
      var L = ['🏥 **System Kaisa Chal Raha Hai?**\n'];
      L.push('Firebase: ' + (d0.offlineMode ? '🔴 Offline' : '🟢 Online'));
      L.push('Pump: ' + (d0.pump ? '🟢 ON' : '🔴 OFF'));
      L.push('Mitti: ' + fv0(d0.csmi).toFixed(1) + '% — ' + (sl0 ? sl0.level : '--'));
      L.push('Rain: ' + ri0.prob.toFixed(0) + '%');
      L.push('Score: ' + fv0(d0.aiScore).toFixed(1) + '/120');
      var issues = [];
      if (d0.pipelineFault) issues.push('Pipeline fault');
      if (d0.safeMode) issues.push('Safe mode');
      if (d0.dhtFallback) issues.push('DHT22 fault');
      if (d0.bmpFallback) issues.push('BMP280 fault');
      L.push('');
      L.push(issues.length === 0 ? '✅ Sab bilkul theek chal raha hai!' : '⚠️ Issues: ' + issues.join(', '));
      return L.join('\n');
    }
  }

  // ── KYUN questions ──────────────────────────────────────────
  if (isKyun) {
    var ctx1 = getFarmContext(), d1 = ctx1.d, fv1 = ctx1.fv;
    var ri1 = getRainInfo();

    // Kyun pump band
    if (/pump|motor|engine/.test(q2) && /band|off|nahi chal|nahi on|shuru nahi|start nahi/.test(q2)) {
      if (!d1) return '📡 Data nahi.';
      var L = ['🔌 **Pump Kyun Band Hai?**\n'];
      L.push('🧠 Wajah dhundhta hoon...\n');
      if (d1.pipelineFault) {
        L.push('🔴 Wajah: Pipeline Fault!');
        L.push('→ Flow sensor ne detect kiya — paani nahi aa raha');
        L.push('→ Safety ke liye auto-band kar diya');
        L.push('→ Fix: YF-S201 aur pipeline physically check karo');
      } else if (d1.safeMode) {
        L.push('🔴 Wajah: Safe Mode Active!');
        L.push('→ Soil sensors fail hain');
        L.push('→ Bina data ke irrigation unsafe hai');
        L.push('→ Fix: SM1/SM2/SM3 wiring check karo');
      } else if (ri1.prob > 65) {
        L.push('🌧️ Wajah: Baarish probability high (' + ri1.prob.toFixed(0) + '%)!');
        L.push('→ System ne socha — baarish se paani milega');
        L.push('→ Paani waste avoid karne ke liye band rakha');
      } else if (fv1(d1.csmi) > 55) {
        L.push('💦 Wajah: Mitti already wet hai (' + fv1(d1.csmi).toFixed(1) + '%)!');
        L.push('→ CSMI 55%+ — irrigation ki zaroorat nahi');
        L.push('→ Zyada paani dena harmful hoga');
      } else if (fv1(d1.aiScore) < 65) {
        L.push('⏸️ Wajah: AI Score kam hai (' + fv1(d1.aiScore).toFixed(1) + '/65)');
        L.push('→ Mitti abhi itni dry nahi ki pump ON ho');
        L.push('→ CSMI: ' + fv1(d1.csmi).toFixed(1) + '% — kuch aur girne do');
        L.push('→ Score badega jab moisture aur kam hoga');
      } else if (!d1.autoMode) {
        L.push('🖐️ Wajah: Manual mode ON hai!');
        L.push('→ Auto mode mein AI control nahi kar sakta');
        L.push('→ Auto mode ON karo ya manually pump start karo');
      } else {
        L.push('ℹ️ Koi fault nahi — standby mein hai.');
        L.push('→ Score: ' + fv1(d1.aiScore).toFixed(0) + ' — threshold ke paas');
      }
      return L.join('\n');
    }

    // Kyun sinchai nahi ho rahi
    if (/sinchai|irrigation|paani nahi/.test(q2)) {
      if (!d1) return '📡 Data nahi.';
      var L = ['💧 **Sinchai Kyun Nahi Ho Rahi?**\n'];
      L.push('🧠 Diagnosis:\n');
      if (d1.pipelineFault) L.push('🔴 Pipeline fault — flow nahi!');
      else if (d1.safeMode)  L.push('🔴 Safe mode — sensors fail!');
      else if (ri1.prob > 65) L.push('🌧️ Baarish expected — system wait kar raha');
      else if (fv1(d1.csmi) > 55) L.push('💦 Mitti already wet — zaroorat nahi');
      else if (fv1(d1.aiScore) < 65) L.push('⏸️ AI score ' + fv1(d1.aiScore).toFixed(0) + ' < 65 — threshold nahi hua');
      else if (!d1.autoMode) L.push('🖐️ Manual mode — AI control nahi');
      else L.push('⚡ Score threshold ke paas — jald hogi!');
      return L.join('\n');
    }

    // Kyun baarish prediction
    if (/baarish|rain|mausam/.test(q2)) {
      var L = ['🌧️ **Baarish Probability Kyun ' + ri1.prob.toFixed(0) + '% Hai?**\n'];
      L.push('🧠 OWM forecast data se aata hai:');
      L.push('• Pressure: ' + (ctx1.owm ? ctx1.owm.owm_pressure + ' hPa' : '--'));
      L.push('• Humidity: ' + (ctx1.owm ? ctx1.owm.owm_humidity + '%' : '--'));
      L.push('• ' + ri1.src + ' se data');
      L.push('');
      if (ri1.prob > 60) L.push('High pressure drop + humidity → baarish likely');
      else L.push('Stable pressure + low humidity → baarish unlikely');
      return L.join('\n');
    }

    // Kyun mitti dry/wet
    if (/mitti|soil|moisture|nami|naami/.test(q2)) {
      if (!d1) return '📡 Data nahi.';
      var csmi1 = fv1(d1.csmi);
      var L = ['🌱 **Mitti Kyun Dry/Wet Hai?**\n'];
      L.push('CSMI: ' + csmi1.toFixed(1) + '%');
      L.push('');
      L.push('🧠 Wajah:');
      if (csmi1 < 30) {
        L.push('• Pichli irrigation nahi hui ya bahut time ho gaya');
        L.push('• Temp ' + fv1(d1.temperature).toFixed(1) + '°C — evaporation: ' + fv1(d1.eto).toFixed(2) + ' mm/day');
        L.push('• Baarish nahi aayi — ' + ri1.prob.toFixed(0) + '% probability only');
      } else if (csmi1 > 65) {
        L.push('• Haal hi mein irrigation hui');
        L.push('• Ya baarish aayi — ' + ri1.mm.toFixed(2) + ' mm recorded');
        L.push('• Drainage slow ho sakti hai');
      } else {
        L.push('• Normal evaporation aur irrigation balance');
        L.push('• ETo: ' + fv1(d1.eto).toFixed(2) + ' mm/day');
      }
      return L.join('\n');
    }

    // Kyun sensor galat
    if (/sensor|reading|galat|sahi nahi/.test(q2)) {
      return '🔧 **Sensor Galat Kyun Ho Sakta Hai?**\n\n' +
        'Common reasons:\n' +
        '• Air gap — sensor properly mitti mein nahi\n' +
        '• Calibration drift — time ke saath reading shift\n' +
        '• Rock/root ke paas — interference\n' +
        '• Wiring loose — connection problem\n' +
        '• Water damage — sensor kharab\n' +
        '• Temperature extreme — ADC affect hota\n\n' +
        'Fix:\n' +
        '1. Sensor nikalo, saaf karo, dobara daalo\n' +
        '2. Dry test karo — 0% dikhana chahiye\n' +
        '3. Pani mein daalo — 80%+ dikhana chahiye\n' +
        '4. .ino mein calibration values check karo';
    }
  }

  // ── KAB questions ──────────────────────────────────────────
  if (isKab) {
    var ctx2 = getFarmContext(), d2 = ctx2.d, fv2 = ctx2.fv;
    var ri2 = getRainInfo(), sl2 = d2 ? getSoilLevel(fv2(d2.csmi)) : null;
    var wc2 = getWaterCalc();

    // Kab sinchai karni
    if (/sinchai|irrigation|paani|pump|water/.test(q2) && !/band|stop|off/.test(q2)) {
      if (!d2) return '📡 Data nahi — hardware check karo.';
      var L = ['⏰ **Sinchai Kab Karni Chahiye?**\n'];
      L.push('Mitti: ' + fv2(d2.csmi).toFixed(1) + '% — ' + (sl2 ? sl2.level : '--'));
      L.push('AI Score: ' + fv2(d2.aiScore).toFixed(1) + '/120');
      L.push('Rain: ' + ri2.prob.toFixed(0) + '%');
      L.push('');
      L.push('🧠 Analysis:');
      if (ri2.prob > 70) {
        L.push('🌧️ Baarish ' + ri2.prob.toFixed(0) + '% — wait karo baarish ke liye!');
        L.push('→ Baarish ke 3-4 ghante baad soil check karo');
      } else if (fv2(d2.csmi) < 20) {
        L.push('🚨 ABHI! Mitti critical dry hai (' + fv2(d2.csmi).toFixed(1) + '%)');
        L.push('→ Ek minute bhi mat ruko');
      } else if (fv2(d2.csmi) < 35) {
        L.push('⚠️ Aaj hi karo — dry ho rahi hai');
        L.push('→ Best: Subah 6-8 AM ya Shaam 5-7 PM');
        if (wc2) L.push('→ ~' + wc2.total + ' L chahiye');
      } else if (fv2(d2.aiScore) >= 65) {
        L.push('⚡ Score threshold pe hai — system jald kharod khud karega!');
      } else {
        L.push('✅ Abhi zaroorat nahi — CSMI ' + fv2(d2.csmi).toFixed(1) + '% — theek hai');
        L.push('→ Agla check: 4-6 ghante baad');
      }
      L.push('');
      L.push('💡 Hamesha: Subah 5-8 AM ya Shaam 5-7 PM — kabhi dopahar nahi!');
      return L.join('\n');
    }

    // Kab pump band hoga
    if (/pump|motor/.test(q2) && /band|off|rukna|stop|khatam/.test(q2)) {
      if (!d2) return '📡 Data nahi.';
      var L = ['🔌 **Pump Kab Band Hoga?**\n'];
      L.push('Pump: ' + (d2.pump ? '🟢 ON — chal raha hai' : '🔴 Already OFF'));
      L.push('CSMI abhi: ' + fv2(d2.csmi).toFixed(1) + '%');
      L.push('');
      L.push('🧠 Auto-band conditions:');
      L.push('• CSMI 55%+ ho jaye → ' + (fv2(d2.csmi) >= 55 ? 'Already! Band karo!' : (55 - fv2(d2.csmi)).toFixed(0) + '% aur chahiye'));
      L.push('• Rain probability 80%+');
      L.push('• Pipeline fault detect ho');
      L.push('• AI score 0 ho jaye');
      if (d2.pump && wc2) {
        var flowR2 = fv2(d2.flowRate) > 0 ? fv2(d2.flowRate) : 5;
        var rem2 = Math.max(0, 55 - fv2(d2.csmi));
        var estMins = ((rem2 / 100) * (wc2.area) * 300 / flowR2).toFixed(0);
        L.push('');
        L.push('Estimated: ~' + estMins + ' min aur chalega');
      }
      return L.join('\n');
    }

    // Kab baarish aayegi
    if (/baarish|rain|mausam|barish/.test(q2)) {
      var L = ['🌧️ **Baarish Kab Aayegi?**\n'];
      L.push('Rain probability: ' + ri2.prob.toFixed(0) + '% (' + ri2.src + ')');
      if (ri2.mm > 0) L.push('Recent: ' + ri2.mm.toFixed(2) + ' mm already aayi');
      L.push('');
      if      (ri2.prob > 75) L.push('🌧️ Jald aayegi — aaj ya kal ke andar!');
      else if (ri2.prob > 50) L.push('⛅ Hone ki achi sambhavna — aaj shaam tak');
      else if (ri2.prob > 25) L.push('🌤️ Thodi sambhavna — pakka nahi');
      else                    L.push('☀️ Nahi aayegi — clear weather');
      L.push('');
      L.push('💡 OWM forecast data 12hr ke liye hai — usse zyada pakka nahi keh sakte.');
      return L.join('\n');
    }

    // Kab khatam hogi sinchai
    if (/khatam|complete|done|poori|poora|finish|end/.test(q2)) {
      if (!d2) return '📡 Data nahi.';
      var L = ['✅ **Sinchai Kab Khatam Hogi?**\n'];
      var flowR3 = fv2(d2.flowRate) > 0 ? fv2(d2.flowRate) : 5;
      var wc3 = getWaterCalc();
      L.push('Pump: ' + (d2.pump ? '🟢 ON' : '🔴 Already OFF'));
      L.push('CSMI: ' + fv2(d2.csmi).toFixed(1) + '% (target: 55%)');
      if (wc3 && d2.pump) {
        var remL = Math.max(0, parseFloat(wc3.needed));
        var estMin2 = (remL / flowR3).toFixed(0);
        L.push('Remaining: ~' + remL.toFixed(0) + ' L');
        L.push('Flow: ' + flowR3.toFixed(2) + ' L/min');
        L.push('');
        L.push('⏱️ Estimated: ~' + estMin2 + ' minutes aur');
      } else if (!d2.pump) {
        L.push('');
        L.push('✅ Pump already OFF hai — sinchai complete!');
      }
      return L.join('\n');
    }
  }

  // ── KITNA questions (quantity) ──────────────────────────────
  if (isKitna && !isKaise && !isKyun && !isKab) {
    var ctx3 = getFarmContext(), d3 = ctx3.d, fv3 = ctx3.fv;
    var ri3 = getRainInfo(), wc3b = getWaterCalc();

    if (/paani|pani|water|litre|liter/.test(q2)) {
      if (!d3) return '📡 Data nahi.';
      var L = ['💧 **Kitna Paani Chahiye?**\n'];
      L.push('Plot: ' + fv3(d3.plotArea_m2).toFixed(1) + ' m²');
      L.push('CSMI: ' + fv3(d3.csmi).toFixed(1) + '%');
      L.push('ETo: ' + fv3(d3.eto).toFixed(2) + ' mm/day');
      L.push('Temp: ' + fv3(d3.temperature).toFixed(1) + '°C');
      L.push('Rain: ' + ri3.prob.toFixed(0) + '%');
      L.push('');
      if (wc3b) {
        var tempMult = fv3(d3.temperature) > 37 ? 1.3 : fv3(d3.temperature) > 32 ? 1.15 : 1.0;
        var rainMult = ri3.prob > 50 ? 0.6 : ri3.prob > 30 ? 0.8 : 1.0;
        var finalL = (parseFloat(wc3b.total) * tempMult * rainMult).toFixed(1);
        L.push('🧮 Calculation:');
        L.push('Deficit: ' + wc3b.needed + ' L');
        L.push('ETo:     ' + wc3b.eto_l + ' L');
        if (tempMult > 1) L.push('Garmi (' + fv3(d3.temperature).toFixed(0) + '°C) ×' + tempMult + ': adj');
        if (rainMult < 1) L.push('Rain (' + ri3.prob.toFixed(0) + '%) ×' + rainMult + ': adj');
        L.push('━━━━━━━━━━━━━━');
        L.push('**Total: ~' + finalL + ' L**');
      }
      L.push('');
      L.push('Budget: ' + fv3(d3.deltaBalance).toFixed(1) + ' L remaining');
      return L.join('\n');
    }

    if (/der|time|minute|ghante|din|day|duration/.test(q2)) {
      if (!d3) return '📡 Data nahi.';
      var flowR4 = fv3(d3.flowRate) > 0 ? fv3(d3.flowRate) : 5;
      var wc4b = getWaterCalc();
      var mins4 = wc4b ? (parseFloat(wc4b.needed) / flowR4).toFixed(0) : '--';
      return '⏱️ **Kitni Der Sinchai Karni Chahiye?**\n\n' +
        'Flow: ' + flowR4.toFixed(2) + ' L/min\n' +
        'Zarurat: ~' + (wc4b ? wc4b.needed + ' L' : '--') + '\n\n' +
        '⏱️ Estimated: **~' + mins4 + ' minutes**\n\n' +
        'System pulse karta hai:\n' +
        '• 30 sec ON → 2 min OFF\n' +
        '• CSMI 55% hone par auto-band\n\n' +
        'Budget: ' + fv3(d3.deltaBalance).toFixed(1) + ' L remaining';
    }
  }

  // ── STEP 1c: Fast-path for "paani kaisa/kaise/theek" type ──
  var isPaaniKaisa = /paani kai|pani kai|paani ka haal|paani theek|paani ki sthiti|moisture kaisa|naami kaisi|nami kaisa|mitti mein paani|paani hai kya|water status|soil status|kheti kaisi|zameen kaisi|paani kaise/.test(q2);
  if (isPaaniKaisa) {
    var ctx0 = getFarmContext(), d0 = ctx0.d, fv0 = ctx0.fv;
    if (!d0) return '📡 Sensor data nahi hai — hardware check karo.';
    var sl0 = getSoilLevel(fv0(d0.csmi));
    var L0 = ['💧 **Mitti mein Paani ki Sthiti**\n'];
    L0.push('CSMI: ' + fv0(d0.csmi).toFixed(1) + '% — ' + sl0.level);
    L0.push('');
    L0.push('Layer-wise:');
    L0.push('• 15cm (SM1): ' + fv0(d0.sm1).toFixed(1) + '%' + (fv0(d0.sm1) <= 0 ? ' ⚠️ FAULT' : ''));
    L0.push('• 30cm (SM2): ' + fv0(d0.sm2).toFixed(1) + '%' + (fv0(d0.sm2) <= 0 ? ' ⚠️ FAULT' : ''));
    L0.push('• 45cm (SM3): ' + fv0(d0.sm3).toFixed(1) + '%' + (fv0(d0.sm3) <= 0 ? ' ⚠️ FAULT' : ''));
    L0.push('');
    if (fv0(d0.csmi) >= 35 && fv0(d0.csmi) <= 70) {
      L0.push('✅ Haan! Mitti mein kaafi paani hai — sinchai ki zaroorat nahi abhi.');
    } else if (fv0(d0.csmi) < 35) {
      L0.push('❌ Paani kam hai mitti mein — sinchai ki zaroorat hai!');
      L0.push('💡 ' + sl0.action);
    } else {
      L0.push('💦 Bahut zyada paani hai — drainage check karo.');
    }
    return L0.join('\n');
  }

  // ── STEP 2: Multi-layer intent scoring ──────────────────────
  var scores = {};

  scores.greeting    = tokenScore(q2, ['namaste','hello','hi','hii','hey','namaskar','good morning','good evening','kya haal','kaise ho','kya chal raha','sup','wassup','hy','helo','ram ram','jai hind','jai kisan']);
  scores.positive     = tokenScore(q2, [
    // English positive
    'good','great','nice','excellent','perfect','best','awesome','superb','amazing',
    'brilliant','fantastic','outstanding','wonderful','well done','thank you','thanks',
    'i like','like you','love it','love this','you are great','you are good','you are best',
    'very good','so good','too good','so nice','very nice','helpful','very helpful',
    'impressive','impressed','appreciate','appreciated','well','fabulous','magnificent',
    'marvelous','terrific','splendid','top notch','top class','first class','class',
    'quality','accurate','precise','correct','right answer','right','spot on',
    'you rock','keep it up','carry on','good work','great work','nice work',
    'well done','bravo','chapeau','kudos','hats off',
    // Hindi positive
    'accha','acha','bahut acha','bahut badhiya','badhiya','badiya','bahut badiya',
    'sahi','ekdum sahi','bilkul sahi','sahi hai','theek hai','mast','zabardast',
    'kamaal','kya baat','kya bat','shabash','wah','waah','wah wah','arrey wah',
    'shukriya','dhanyawad','bahut shukriya','bahut dhanyawad','bahut meherbani',
    'bahut mast','ekdum mast','too good','bahut helpful','helpful hai',
    'bahut khoob','khoob','khub','bahut khub','lajawaab','lajawab','laazawab',
    'gazab','gajab','shandar','shandaar','behtareen','umda','kabil e tarif',
    'tarif','salute','salaam','jai ho','maza aaya','maza aya','maja aaya','maja aya',
    // Hinglish
    'bhai sahi hai','yaar sahi hai','bhai tu great','yaar tu best',
    'tu mast hai','tu kamaal hai','tu best hai','tum best ho','tum sahi ho',
    'bahut sahi ho','bahut acha ho','tum bahut acha','tum bahut helpful',
    'pasand aaya','pasand aayi','pasand hai','liked it','like kar','like kiya',
    'number one','no 1','no one','#1','top','ekdum top','full marks',
    'satisfy','satisfied','khush','khushi','happy','glad'
  ]);

  scores.negative     = tokenScore(q2, [
    // English negative
    'bad','wrong','incorrect','not good','not helpful','useless','worst','terrible',
    'awful','horrible','poor','disappointing','disappointed','unhappy','not satisfied',
    'not happy','dissatisfied','frustrated','annoying','annoyed','pathetic','rubbish',
    'garbage','trash','waste','wasted','not working','doesnt work','not useful',
    'not accurate','inaccurate','not correct','wrong answer','false','misleading',
    'confused','confusing','unclear','not clear','dont understand','did not help',
    'failed','failure','mistake','error','i hate','hate this','hate it',
    'not impressed','unimpressed','could be better','needs improvement',
    'try again','do better','fix this','not right','totally wrong',
    // Hindi negative
    'bura','bura laga','acha nahi laga','accha nahi laga','pasand nahi aaya',
    'pasand nahi','nahi acha','galat','bilkul galat','ekdum galat','sahi nahi',
    'bekaar','bekar','faltu','faltoo','kaam ka nahi','kisi kaam ka nahi',
    'bewakoof','pagal','nonsense','bakwas','bak bak','chhodo','chodo',
    'thik nahi','theek nahi','ganda','gandaa','kharab','nuksaan','nafrat',
    'nafrat hai','pasand nahi','khafa','naraaz','naraz','dukh','dukhi',
    'takleef','pareshaan','pareshan','niराश','nirash','nirasha','umeed nahi',
    'fail','failur','haara','haar gaya','nahi samjha','ulta','ulta jawab',
    'seedha nahi bataya','sahi nahi bataya','dhoka','dhokha',
    // Hinglish negative
    'bhai galat','yaar galat','bhai ye kya','yaar ye kya','kya bata raha',
    'kya bol raha','kuch samajh nahi','samajh nahi aaya','seedha bolo',
    'aise nahi','aisa nahi','yeh sahi nahi','yeh theek nahi',
    'disappointed hoon','khafa hoon','naraaz hoon','dukhi hoon',
    'help nahi kiya','madad nahi ki','koi fayda nahi','fayda nahi',
    'time waste','time barbaad','barbaad','kuch nahi bataya'
  ]);  scores.pump        = tokenScore(q2, ['pump','motor','engine','chalu','start','on karo','band karo','off karo','relay','shuru','shuru karo','pump on','pump off','pump start','pump band','pump nahi','motor nahi','motor band','motor chalu','pump problem','pump issue','pump kyu','pump kab','pump chal','pump hai','pump status']);
  scores.soil        = tokenScore(q2, ['mitti','soil','moisture','csmi','naami','nami','sm1','sm2','sm3','dry','wet','geela','sukha','sookha','khushk','damp','saturated','moisture level','soil reading','mitti kaisi','mitti theek','mitti dry','mitti wet','mitti geeli','mitti sukhi','mitti status','depth','15cm','30cm','45cm','root zone moisture','vwc','volumetric','paani kaisa','pani kaisa','paani kaisi','paani theek','paani kaise','paani ka haal','paani hai kya','paani ki sthiti','water status','moisture kaisa','naami kaisi','naami kaisa','nami kaisi','mitti mein paani','soil mein paani','kitna paani mitti','mitti ka haal','kheti kaisi','zameen kaisi']);
  scores.water_qty   = tokenScore(q2, ['kitna paani','paani kitna','pani kitna','kitne litre','litre kitna','how much water','paani chahiye','kitna water','paani ki zarurat','water requirement','daily paani','aaj paani','paani lagega','lagega kitna','water need','pani de','paani de','water do','irrigation amount','sinchai kitni','paani ka hisaab','per bigha','per meter paani','kitna dena','matra','quantity paani']);
  scores.rain        = tokenScore(q2, ['baarish','barish','rain','barsaat','varsha','brish','badal','bijli','toofan','garj','cloudy','forecast','precipitation','monsoon','baarish hogi','baarish aayegi','rain expected','baarish probability','rain probability','baarish chance','baarish aane','baarish ka','baarish ke','rain today','aaj baarish','kal baarish']);
  scores.irrigation  = tokenScore(q2, ['sinchai','irrigation','paani do','paani lao','paani lagao','pump chalao','irrigate','kab sinchai','sinchai kab','kab pani','sinchai karo','sinchai band','sinchai complete','sinchai ho gayi','sinchai poori','sinchai kitni','sinchai ka time','sinchai shuru','start irrigation','stop irrigation','sinchai rokna','sinchai chalu','drip','sprinkler','flood irrigation','furrow','emitter']);
  scores.sensor      = tokenScore(q2, ['sensor','dht','dht22','bmp','bmp280','flow sensor','yf-s201','capacitive','reading','fault','kharab','defective','broken','calibrate','calibration','sensor reading','sensor galat','sensor sahi','sensor problem','sensor check','sensor nahi','reading galat','reading nahi','reading zero','no reading','safe mode','sensor fail','sensor damage','sensor replace']);
  scores.internet    = tokenScore(q2, ['internet','wifi','connection','firebase','offline','online','network','lora','fallback','sync','connected','disconnect','signal','server','cloud','data nahi','data aa raha','firebase error','connection error','net nahi','internet nahi','connected hai','offline mode']);
  scores.weather     = tokenScore(q2, ['temperature','temp','garmi','thand','celsius','degree','humidity','pressure','hpa','barometer','eto','evaporation','mausam','weather','aaj ka mausam','kal ka mausam','kaisa mausam','heat','cold','hot','garam','thanda','kitni garmi','kitni thand']);
  scores.crop        = tokenScore(q2, ['crop','fasal','gehun','wheat','rice','paddy','makka','maize','soybean','ganna','sugarcane','tomato','aloo','potato','onion','pyaz','mustard','sarson','cotton','kapas','chana','gram','stage','gdd','growth stage','crop stage','fasal ki','fasal ka','crop status','kharif','rabi','zaid']);
  scores.budget      = tokenScore(q2, ['budget','balance','remaining','bacha','kitna bacha','litre bacha','pani bacha','paani bacha','seasonal','applied','contribution','total paani','flow total','water balance','water budget','seasonal requirement','kitna use hua','kitna laga','consume','kharcha paani']);
  scores.overwater   = tokenScore(q2, ['zyada paani','over water','overwater','bahut geela','waterlog','waterlogged','root rot','fungal','paani bhar','jam gaya','standing water','drainage nahi','nikas nahi','zyada ho gaya','bahut wet','excess water','excess irrigation','too much water']);
  scores.underwater  = tokenScore(q2, ['kam paani','under water','underwater','paani ki kami','insufficient','not enough','wilting','murjha','murjhana','sukh raha','fasal sukh','patta murjha','patta sukha','stress','drought','sukha pad','yield loss','fasal mar','paudha mar']);
  scores.analysis    = tokenScore(q2, ['sab kuch batao','full status','poori report','overview','analysis','report','summary','sab theek','everything ok','all ok','kya chal raha','farm status','overall','complete status','total status','sara status']);
  scores.health      = tokenScore(q2, ['system theek','sab theek','koi problem','koi issue','system ok','hardware theek','all working','properly chal','sab sahi','sab set']);
  scores.help        = tokenScore(q2, ['help','madad','guide','kya puch','options','features','kya kar sakta','list','shortcuts','kya poochhu','main kya poochuun']);
  scores.ai_score    = tokenScore(q2, ['ai score','score kya','score kitna','threshold','65','smv','sma','tpr','velocity','acceleration','score high','score low','score badhao','score kyu kam','kab trigger','eligible']);
  scores.cost        = tokenScore(q2, ['bijli','electricity','current bill','cost','kharcha','kitna unit','motor kharcha','pump bijli','solar','diesel pump','hp pump','horsepower','watt','kilowatt','unit']);
  scores.fertilizer  = tokenScore(q2, ['khad','fertilizer','urea','dap','mop','npk','spray','pesticide','fungicide','herbicide','weedicide','fertigation','khad dena','khad ke saath','khad baad','chemical','insecticide']);
  scores.stress      = tokenScore(q2, ['fasal kharab','fasal sukh','paudha mar','yellow','peela','patta peela','brown','bhoora','dry leaf','wilting','stress','crop stress','plant stress','disease','rog','bimari','keeda','pest','insect','attack']);

  // ── STEP 3: Find best intent ─────────────────────────────────
  var best = 'default', bestScore = 0;
  Object.keys(scores).forEach(function(k) {
    if (scores[k] > bestScore) { bestScore = scores[k]; best = k; }
  });

  // ── STEP 4: Cross-topic reasoning ────────────────────────────
  // Temperature + irrigation question
  if (scores.weather >= 1 && scores.irrigation >= 1) best = 'temp_irrig_cross';
  // Rain + irrigation
  if (scores.rain >= 2 && (scores.irrigation >= 1 || scores.water_qty >= 1)) best = 'rain_irrig_cross';
  // Soil + water quantity
  if (scores.soil >= 1 && scores.water_qty >= 2) best = 'soil_water_cross';
  // Overwatering OR underwatering detected
  if (scores.overwater >= 2) best = 'overwater';
  if (scores.underwater >= 2) best = 'underwater';
  // Complete irrigation question
  if (/complete|ho gaya|ho gayi|khatam|done|poora/.test(q2) && scores.irrigation >= 1) best = 'irrig_done';

  // ── STEP 5: Minimum score check ──────────────────────────────
  if (bestScore === 0) best = 'default';

  // Negative feedback detection
  var isNegativeFeedback = scores.negative >= 1 && scores.pump === 0 && scores.soil === 0 &&
    scores.rain === 0 && scores.irrigation === 0 && scores.sensor === 0 &&
    scores.crop === 0 && scores.water_qty === 0;
  if (isNegativeFeedback) best = 'negative';

  // Positive feedback detection — any compliment, thanks, appreciation
  var isPositiveFeedback = scores.positive >= 1 && scores.negative === 0 && scores.pump === 0 &&
    scores.soil === 0 && scores.rain === 0 && scores.irrigation === 0 &&
    scores.sensor === 0 && scores.crop === 0 && scores.water_qty === 0 && scores.budget === 0;
  if (isPositiveFeedback) best = 'positive';

  // Save context
  aiMemory.lastTopic = best;

  // ── STEP 6: Route to handler ──────────────────────────────────
  switch (best) {

    // ══ GREETING ══════════════════════════════════════════════
    case 'greeting': {
      var greetStatus = d
        ? ('System ' + (d.offlineMode ? '🔴 Offline' : '🟢 Online') +
           ' | Pump ' + (d.pump ? '🟢 ON' : '🔴 OFF') +
           ' | Mitti CSMI ' + fv(d.csmi).toFixed(1) + '%' +
           (fv(d.csmi) < 30 ? ' 🚨 DRY!' : fv(d.csmi) > 70 ? ' 💦 WET!' : ' ✅'))
        : 'Hardware se connect ho raha hoon...';
      var sessions = aiMemory.sessionCount;
      return '👋 ' + (sessions > 3 ? 'Wapas aaye! ' : 'Namaste! ') +
             'Main TSCRIC Farm AI hoon.\n\n' + greetStatus +
             '\n\nKya poochna hai? Irrigation, pump, mitti, baarish, sensor — sab batata hoon! 🌾';
    }

    // ══ PUMP ══════════════════════════════════════════════════
    case 'pump': {
      if (!d) return '📡 Hardware data nahi aa raha.\n\nCheck karo:\n• ESP8266 on hai?\n• WiFi connected?\n• Firebase config sahi hai?';
      var sl = getSoilLevel(fv(d.csmi));
      var ri = getRainInfo();
      var L = ['🔌 **Pump Status Analysis**\n'];
      L.push('━━━━━━━━━━━━━━━━━━━━━');
      L.push('Status:  ' + (d.pump ? '🟢 ON — Chal raha hai' : '🔴 OFF — Band hai'));
      L.push('Mode:    ' + (d.autoMode ? '🤖 Automatic (AI)' : '🖐️ Manual'));
      L.push('Score:   ' + fv(d.aiScore).toFixed(1) + '/120 (trigger: 65)');
      L.push('Flow:    ' + fv(d.flowRate).toFixed(2) + ' L/min');
      L.push('Applied: ' + fv(d.totalLitres).toFixed(1) + ' L total');
      L.push('━━━━━━━━━━━━━━━━━━━━━');
      // Reasoning chain
      L.push('\n🧠 **Reasoning:**');
      if (d.pipelineFault) {
        L.push('🔴 Pipeline fault detect hua!');
        L.push('→ YF-S201 flow sensor ya pipeline mein problem');
        L.push('→ Pump auto-band ho gaya safety ke liye');
        L.push('→ Fix karo: Physically pipeline check karo, debris hata');
      } else if (d.safeMode) {
        L.push('🔴 Safe Mode Active!');
        L.push('→ Soil sensors (SM1/SM2/SM3) fail hain');
        L.push('→ Pump restricted — blind irrigation dangerous hai');
        L.push('→ Fix karo: Capacitive sensor wiring check karo');
      } else if (d.pump) {
        L.push('✅ Pump sahi se chal raha hai');
        L.push('→ AI Score ' + fv(d.aiScore).toFixed(0) + ' — irrigation justified');
        L.push('→ Mitti: ' + sl.level + ' (' + fv(d.csmi).toFixed(1) + '%)');
        if (fv(d.csmi) > 55) L.push('⚡ CSMI 55%+ — pump jald band hoga automatically');
      } else if (fv(d.aiScore) < 65) {
        L.push('⏸️ Pump band hai — kyu?');
        L.push('→ AI Score ' + fv(d.aiScore).toFixed(0) + ' < 65 threshold');
        L.push('→ Mitti: ' + sl.level + ' (' + fv(d.csmi).toFixed(1) + '%)');
        if (ri.prob > 50) L.push('→ Baarish ' + ri.prob.toFixed(0) + '% — risk nahi lega system');
        L.push('→ Score badhega jab mitti aur dry hogi');
      } else {
        L.push('⚡ Score threshold cross! Pump jald trigger hoga.');
      }
      if (d.offlineMode) L.push('\n📡 Offline mode — autonomous chal raha hai.');
      return L.join('\n');
    }

    // ══ SOIL ══════════════════════════════════════════════════
    case 'soil': {
      if (!d) return '📡 Sensor data nahi.\n\nManual check: Anguli 5cm mitti mein daalo — geeli = theek, sukhi = paani chahiye.';
      var sl2 = getSoilLevel(fv(d.csmi));
      var L = ['🌱 **Mitti Analysis**\n'];
      L.push('━━━━━━━━━━━━━━━━━━━━━');
      L.push('CSMI:     ' + fv(d.csmi).toFixed(1) + '%  →  ' + sl2.level);
      L.push('━━━━━━━━━━━━━━━━━━━━━');
      L.push('15cm (SM1): ' + fv(d.sm1).toFixed(1) + '%' + (fv(d.sm1) <= 0 ? ' ⚠️ FAULT' : ''));
      L.push('30cm (SM2): ' + fv(d.sm2).toFixed(1) + '%' + (fv(d.sm2) <= 0 ? ' ⚠️ FAULT' : ''));
      L.push('45cm (SM3): ' + fv(d.sm3).toFixed(1) + '%' + (fv(d.sm3) <= 0 ? ' ⚠️ FAULT' : ''));
      L.push('VWC1: ' + fv(d.vwc1).toFixed(3) + ' | VWC2: ' + fv(d.vwc2).toFixed(3) + ' | VWC3: ' + fv(d.vwc3).toFixed(3));
      L.push('━━━━━━━━━━━━━━━━━━━━━');
      L.push('\n🧠 **Reasoning:**');
      // Layer analysis
      var shallow = fv(d.sm1), mid = fv(d.sm2), deep = fv(d.sm3);
      if (shallow < deep - 15) L.push('• Surface dry, deep moist → recent rain ya deep watering tha');
      if (shallow > deep + 15) L.push('• Surface moist, deep dry → sirf surface irrigation hua, deep nahi pahuncha');
      if (Math.abs(shallow - deep) < 5) L.push('• Uniform moisture — irrigation sahi ho rahi hai ✅');
      L.push('');
      L.push('💡 ' + sl2.action);
      var wc = getWaterCalc();
      if (sl2.urgent && wc) L.push('💧 Estimated zarurat: ~' + wc.needed + ' L');
      if (d.safeMode) L.push('\n⚠️ Safe Mode — sensors fail! Physical inspection karo.');
      return L.join('\n');
    }

    // ══ WATER QUANTITY ═════════════════════════════════════════
    case 'water_qty': {
      if (!d) return '📡 Sensor data nahi — hardware check karo.';
      var wc2 = getWaterCalc();
      var ri2 = getRainInfo();
      var sl3 = getSoilLevel(fv(d.csmi));
      var L = ['💧 **Paani ki Zarurat — Calculation**\n'];
      L.push('━━━━━━━━━━━━━━━━━━━━━');
      L.push('Plot:    ' + fv(d.plotArea_m2).toFixed(1) + ' m² (' + fv(d.plotArea_bigha).toFixed(4) + ' Bigha)');
      L.push('Mitti:   ' + fv(d.csmi).toFixed(1) + '% — ' + sl3.level);
      L.push('ETo:     ' + fv(d.eto).toFixed(2) + ' mm/day');
      L.push('Rain:    ' + ri2.prob.toFixed(0) + '% probability');
      L.push('Temp:    ' + fv(d.temperature).toFixed(1) + '°C');
      L.push('━━━━━━━━━━━━━━━━━━━━━');
      L.push('\n🧮 **Calculation:**');
      if (wc2) {
        L.push('Moisture deficit:  ~' + wc2.needed + ' L');
        L.push('ETo daily loss:    ~' + wc2.eto_l + ' L');
        var tempAdj = fv(d.temperature) > 37 ? 1.25 : fv(d.temperature) > 32 ? 1.1 : 1.0;
        var adjTotal = (parseFloat(wc2.total) * tempAdj).toFixed(1);
        if (tempAdj > 1) L.push('Garmi adjustment (' + fv(d.temperature).toFixed(0) + '°C): ×' + tempAdj.toFixed(2));
        L.push('━━━━━━━━━━━━━━━━━━━━━');
        L.push('**Total needed: ~' + adjTotal + ' L**');
        if (ri2.prob > 40) {
          var rainAdj = (parseFloat(adjTotal) * (1 - ri2.prob / 200)).toFixed(1);
          L.push('Rain adjustment (-' + ri2.prob.toFixed(0) + '%): ~' + rainAdj + ' L');
        }
      }
      L.push('\n💰 Budget remaining: ' + fv(d.deltaBalance).toFixed(1) + ' L');
      if (fv(d.deltaBalance) < parseFloat(wc2 ? wc2.total : 0)) {
        L.push('⚠️ Budget insufficient — conserve karo!');
      }
      return L.join('\n');
    }

    // ══ RAIN ══════════════════════════════════════════════════
    case 'rain': {
      var ri3 = getRainInfo();
      var L = ['🌧️ **Baarish Analysis**\n'];
      var locN = 'Bhopal';
      try { locN = WEATHER_LOCATIONS[selectedWeatherLocation].label; } catch(e) {}
      L.push('📍 Location: ' + locN);
      if (owm) {
        L.push('🌡️ Temp: ' + (owm.owm_temp !== null ? owm.owm_temp.toFixed(1) + '°C' : '--'));
        L.push('💧 Humidity: ' + (owm.owm_humidity !== null ? owm.owm_humidity.toFixed(0) + '%' : '--'));
        L.push('🌀 Pressure: ' + (owm.owm_pressure !== null ? owm.owm_pressure.toFixed(1) + ' hPa' : '--'));
      }
      L.push('');
      L.push('🌂 Rain Probability: **' + ri3.prob.toFixed(0) + '%** (' + ri3.src + ')');
      if (ri3.mm > 0) L.push('Pichle 1hr mein: ' + ri3.mm.toFixed(2) + ' mm');
      L.push('');
      L.push('🧠 **Reasoning:**');
      if (ri3.prob > 75) {
        L.push('🌧️ Pakki baarish — **Irrigation bilkul mat karo!**');
        L.push('→ Paani waste hoga');
        L.push('→ Mitti waterlog ho sakti hai');
        L.push('→ Baarish ke 3-4 ghante baad mitti check karo');
      } else if (ri3.prob > 50) {
        L.push('⛅ Achi sambhavna — Irrigation postpone karo');
        if (d && fv(d.csmi) < 20) L.push('→ Mitti bahut dry — thodi sinchai karo, baarish baaki karega');
        else L.push('→ Mitti theek hai — wait karo');
      } else if (ri3.prob > 25) {
        L.push('🌤️ Thodi sambhavna — Half irrigation theek hai');
        L.push('→ ' + ri3.prob.toFixed(0) + '% se itna paani nahi milega — karo sinchai');
      } else {
        L.push('☀️ Baarish nahi hogi — Normal irrigation karo');
        if (d) { var sl4 = getSoilLevel(fv(d.csmi)); L.push('→ Mitti: ' + sl4.level + ' — ' + sl4.action); }
      }
      return L.join('\n');
    }

    // ══ IRRIGATION COMPLETE ════════════════════════════════════
    case 'irrig_done': {
      if (!d) return '✅ Sinchai complete!\n\nMitti check karo haath se — geeli honi chahiye 30-45cm depth tak.';
      var sl5 = getSoilLevel(fv(d.csmi));
      var ri4 = getRainInfo();
      var L = ['✅ **Sinchai Complete — Summary**\n'];
      L.push('━━━━━━━━━━━━━━━━━━━━━');
      L.push('Mitti abhi:  ' + fv(d.csmi).toFixed(1) + '% — ' + sl5.level);
      L.push('Applied:     ' + fv(d.totalLitres).toFixed(1) + ' L');
      L.push('Flow rate:   ' + fv(d.flowRate).toFixed(2) + ' L/min');
      L.push('Pump:        ' + (d.pump ? '🟢 Still ON' : '🔴 OFF'));
      L.push('━━━━━━━━━━━━━━━━━━━━━');
      L.push('\n📊 **Water Budget:**');
      L.push('Seasonal required:  ' + fv(d.deltaRequired).toFixed(1) + ' L');
      L.push('Irrigation applied: ' + fv(d.deltaApplied).toFixed(1) + ' L');
      L.push('Rainfall:           ' + fv(d.rainfallContrib).toFixed(1) + ' L');
      L.push('**Balance:          ' + fv(d.deltaBalance).toFixed(1) + ' L**');
      L.push('━━━━━━━━━━━━━━━━━━━━━');
      var bal = fv(d.deltaBalance);
      if (bal < 0) L.push('🔴 Budget exceed! Carefully use karo.');
      else if (bal < 200) L.push('🟡 Budget kam bacha — ' + bal.toFixed(0) + ' L only.');
      else L.push('🟢 Budget theek — ' + bal.toFixed(0) + ' L available.');
      if (fv(d.csmi) < 45) L.push('\n⚠️ Mitti abhi bhi dry — thodi aur sinchai chahiye!');
      if (ri4.prob > 40) L.push('\n🌧️ ' + ri4.prob.toFixed(0) + '% baarish — next session skip karo!');
      return L.join('\n');
    }

    // ══ OVERWATERING ══════════════════════════════════════════
    case 'overwater': {
      var L = ['💦 **Overwatering — Kya Karo?**\n'];
      if (!d) {
        L.push('Overwatering ke signs:\n• Patta peela padna\n• Root rot — jad saadna\n• Fungal spots leaves pe\n• Mitti se badbu\n\nTurant:\n1. Sinchai band karo\n2. Drainage check karo\n3. 48hr wait karo');
        return L.join('\n');
      }
      L.push('CSMI: ' + fv(d.csmi).toFixed(1) + '% — ' + getSoilLevel(fv(d.csmi)).level);
      L.push('Pump: ' + (d.pump ? '🟢 ON — BAND KARO TURANT!' : '🔴 OFF'));
      L.push('');
      L.push('🧠 **Reasoning:**');
      if (fv(d.csmi) > 75) {
        L.push('🚨 Bahut zyada paani hai mitti mein!');
        L.push('');
        L.push('Nuksaan hoga:');
        L.push('• Root rot — jad mein oxygen nahi');
        L.push('• Fungal disease — fasal kharab');
        L.push('• Nutrient washout — khad beh jaata');
        L.push('• Yield loss — production girega');
        L.push('');
        L.push('Abhi karo:');
        L.push('1. Pump band karo');
        L.push('2. Drainage channel kholo');
        L.push('3. 24-48 hr koi paani nahi');
        L.push('4. Mitti naturally sukhne do');
      } else {
        L.push('⚠️ Mitti wet hai lekin critical nahi — monitor karo.');
        L.push('→ Agla irrigation 2-3 din baad');
      }
      return L.join('\n');
    }

    // ══ UNDERWATERING ═════════════════════════════════════════
    case 'underwater': {
      var L = ['🏜️ **Underwatering — Fasal Stress Mein Hai!**\n'];
      if (!d) {
        L.push('Underwatering signs:\n• Patta murjhana\n• Soil crack hona\n• Tips dry hona\n• Slow growth\n\nTurant paani do!');
        return L.join('\n');
      }
      var wcu = getWaterCalc();
      L.push('CSMI: ' + fv(d.csmi).toFixed(1) + '% — ' + getSoilLevel(fv(d.csmi)).level);
      L.push('AI Score: ' + fv(d.aiScore).toFixed(1) + '/120');
      L.push('');
      L.push('🧠 **Reasoning:**');
      if (fv(d.csmi) < 20) {
        L.push('🚨 Critical moisture! Fasal bahut stress mein hai!');
        L.push('');
        L.push('Kya hoga nahi diya toh:');
        L.push('• Flowering/fruiting drop hoga');
        L.push('• Yield 30-50% kam ho sakta hai');
        L.push('• Permanent wilting point reach ho sakti');
        L.push('');
        L.push('Abhi karo:');
        L.push('1. Pump ON karo TURANT');
        if (wcu) L.push('2. ~' + wcu.needed + ' L minimum do');
        L.push('3. CSMI 45% tak le aao');
        L.push('4. 2 ghante mein recovery check karo');
      } else {
        L.push('⚠️ Mitti dry hai — sinchai ki zaroorat hai');
        if (wcu) L.push('→ ~' + wcu.needed + ' L paani do');
      }
      return L.join('\n');
    }

    // ══ CROSS: TEMPERATURE + IRRIGATION ═══════════════════════
    case 'temp_irrig_cross': {
      var tmp = d ? fv(d.temperature) : (owm ? (owm.owm_temp || 30) : 30);
      var eto = d ? fv(d.eto) : 3;
      var ri5 = getRainInfo();
      var wc3 = getWaterCalc();
      var L = ['🌡️💧 **Temperature → Irrigation Reasoning**\n'];
      L.push('━━━━━━━━━━━━━━━━━━━━━');
      L.push('Temp:  ' + tmp.toFixed(1) + '°C');
      L.push('ETo:   ' + eto.toFixed(2) + ' mm/day (evaporation)');
      if (d) L.push('CSMI:  ' + fv(d.csmi).toFixed(1) + '%');
      L.push('Rain:  ' + ri5.prob.toFixed(0) + '%');
      L.push('━━━━━━━━━━━━━━━━━━━━━');
      L.push('\n🧠 **Analysis:**');
      if (tmp > 42) {
        L.push('🔥 Extreme heat (' + tmp.toFixed(0) + '°C)!');
        L.push('• ETo bahut high — mitti jaldi sookhti hai');
        L.push('• Roz 2 baar sinchai karo (subah + shaam)');
        L.push('• Normal se 40-50% zyada paani chahiye');
        if (wc3) L.push('• Today: ~' + (parseFloat(wc3.total) * 1.4).toFixed(1) + ' L recommended');
      } else if (tmp > 35) {
        L.push('☀️ High heat (' + tmp.toFixed(0) + '°C)');
        L.push('• ETo elevated — roz sinchai karo');
        L.push('• 20-30% zyada paani do');
        if (wc3) L.push('• Today: ~' + (parseFloat(wc3.total) * 1.2).toFixed(1) + ' L');
      } else if (tmp > 25) {
        L.push('🌤️ Normal temperature (' + tmp.toFixed(0) + '°C)');
        L.push('• ETo normal — regular schedule');
        if (wc3) L.push('• Today: ~' + wc3.total + ' L sufficient');
      } else {
        L.push('🥶 Cool/Cold (' + tmp.toFixed(0) + '°C)');
        L.push('• ETo low — kam paani chahiye');
        L.push('• Irrigation frequency ghata sakte ho');
        if (wc3) L.push('• Today: ~' + (parseFloat(wc3.total) * 0.7).toFixed(1) + ' L kaafi');
      }
      if (ri5.prob > 50) L.push('\n🌧️ Lekin baarish ' + ri5.prob.toFixed(0) + '% — thoda wait karo!');
      L.push('\n💡 **Best time:** Subah 5-8 AM — evaporation minimum hoti hai.');
      return L.join('\n');
    }

    // ══ CROSS: RAIN + IRRIGATION ═══════════════════════════════
    case 'rain_irrig_cross': {
      var ri6 = getRainInfo();
      var L = ['🌧️💧 **Baarish vs Sinchai — Faisla**\n'];
      L.push('Rain probability: ' + ri6.prob.toFixed(0) + '%');
      if (ri6.mm > 0) L.push('Recent rain: ' + ri6.mm.toFixed(2) + ' mm');
      if (d) L.push('Mitti: ' + fv(d.csmi).toFixed(1) + '% — ' + getSoilLevel(fv(d.csmi)).level);
      L.push('');
      L.push('🧠 **Reasoning chain:**');
      L.push('1. Rain probability check → ' + ri6.prob.toFixed(0) + '%');
      if (ri6.prob > 75) {
        L.push('2. > 75% → Pakki baarish');
        L.push('3. Irrigation karna = paani waste');
        L.push('4. **Decision: Irrigation mat karo** ❌');
        L.push('\n→ Wait karo. Baarish ke baad soil check karo.');
      } else if (ri6.prob > 50) {
        L.push('2. 50-75% → Achi sambhavna');
        var csmi_now = d ? fv(d.csmi) : 40;
        L.push('3. Mitti check → ' + csmi_now.toFixed(0) + '%');
        if (csmi_now < 25) {
          L.push('4. Mitti bahut dry (<25%) → thodi sinchai karo');
          L.push('**Decision: Half irrigation karo** ⚠️');
        } else {
          L.push('4. Mitti theek hai → wait worth it');
          L.push('**Decision: Wait karo, baarish natural irrigation karega** ✅');
        }
      } else {
        L.push('2. < 50% → Baarish unlikely');
        L.push('3. Normal irrigation justified');
        if (d) { var sl6 = getSoilLevel(fv(d.csmi)); L.push('4. Mitti: ' + sl6.level + ' → ' + sl6.action); }
        L.push('**Decision: Normal irrigation karo** ✅');
      }
      return L.join('\n');
    }

    // ══ CROSS: SOIL + WATER ════════════════════════════════════
    case 'soil_water_cross': {
      if (!d) return '📡 Sensor data nahi hai.';
      var sl7 = getSoilLevel(fv(d.csmi));
      var wc4 = getWaterCalc();
      var ri7 = getRainInfo();
      var L = ['🌱💧 **Soil → Water Requirement Reasoning**\n'];
      L.push('CSMI: ' + fv(d.csmi).toFixed(1) + '% — ' + sl7.level);
      L.push('SM1: ' + fv(d.sm1).toFixed(1) + '% | SM2: ' + fv(d.sm2).toFixed(1) + '% | SM3: ' + fv(d.sm3).toFixed(1) + '%');
      L.push('');
      L.push('🧠 **Reasoning chain:**');
      L.push('Step 1: Soil level → ' + sl7.level);
      L.push('Step 2: Deficit from target 50%: ' + Math.max(0, 50 - fv(d.csmi)).toFixed(0) + '%');
      if (wc4) {
        L.push('Step 3: Area × deficit = ' + wc4.needed + ' L');
        L.push('Step 4: ETo loss = ' + wc4.eto_l + ' L/day');
        L.push('Step 5: Total = **' + wc4.total + ' L**');
      }
      L.push('Step ' + (wc4 ? 6 : 3) + ': Rain check → ' + ri7.prob.toFixed(0) + '%');
      if (ri7.prob > 50) L.push('→ Baarish adjust karo: ~' + (parseFloat(wc4 ? wc4.total : 0) * 0.6).toFixed(1) + ' L dena kaafi');
      else if (wc4) L.push('→ Full: ~' + wc4.total + ' L do');
      L.push('\n💰 Budget: ' + fv(d.deltaBalance).toFixed(1) + ' L remaining');
      return L.join('\n');
    }

    // ══ SENSOR ════════════════════════════════════════════════
    case 'sensor': {
      var L = ['🔧 **Sensor Health Report**\n'];
      if (!d) {
        L.push('❌ Koi data nahi aa raha.\n');
        L.push('Check karo:\n1. ESP8266/Arduino power\n2. USB/Power supply\n3. WiFi connection\n4. Firebase config');
        return L.join('\n');
      }
      var allOk = !d.safeMode && !d.dhtFallback && !d.bmpFallback && !d.pipelineFault && fv(d.sm1)>0 && fv(d.sm2)>0 && fv(d.sm3)>0;
      if (allOk) {
        L.push('✅ Sab sensors theek hain!\n');
        L.push('SM1 (15cm):  ' + fv(d.sm1).toFixed(1) + '%  ✅');
        L.push('SM2 (30cm):  ' + fv(d.sm2).toFixed(1) + '%  ✅');
        L.push('SM3 (45cm):  ' + fv(d.sm3).toFixed(1) + '%  ✅');
        L.push('DHT22:       ✅ Temperature + Humidity OK');
        L.push('BMP280:      ✅ Pressure OK');
        L.push('YF-S201:     ✅ Flow sensor OK');
      } else {
        L.push('⚠️ Issues detected:\n');
        if (d.safeMode)              L.push('🔴 SAFE MODE — Soil sensors complete fail!');
        if (fv(d.sm1)<=0&&!d.safeMode) L.push('🔴 SM1 (15cm) — no reading → Wiring check karo');
        if (fv(d.sm2)<=0&&!d.safeMode) L.push('🔴 SM2 (30cm) — no reading → ADC pin check karo');
        if (fv(d.sm3)<=0&&!d.safeMode) L.push('🔴 SM3 (45cm) — no reading → Sensor physical damage?');
        if (d.dhtFallback)           L.push('🟡 DHT22 fault → OWM fallback active, data pin check karo');
        if (d.bmpFallback)           L.push('🟡 BMP280 fault → OWM fallback active, I2C (SDA/SCL) check karo');
        if (d.pipelineFault)         L.push('🔴 Flow sensor fault → Pipeline ya YF-S201 check karo');
      }
      return L.join('\n');
    }

    // ══ WEATHER ═══════════════════════════════════════════════
    case 'weather': {
      var L = ['🌡️ **Maasam Report**\n'];
      var locN2 = 'Bhopal';
      try { locN2 = WEATHER_LOCATIONS[selectedWeatherLocation].label; } catch(e) {}
      L.push('📍 ' + locN2);
      if (d) {
        L.push('\n📡 Local Sensors:');
        L.push('• Temp (DHT22): ' + fv(d.temperature).toFixed(1) + '°C' + (d.dhtFallback ? ' ⚠️ OWM fallback' : ' ✅'));
        L.push('• Humidity:     ' + fv(d.humidity).toFixed(0) + '%');
        L.push('• Pressure:     ' + fv(d.pressure).toFixed(1) + ' hPa' + (d.bmpFallback ? ' ⚠️ OWM fallback' : ' ✅'));
        L.push('• ETo:          ' + fv(d.eto).toFixed(2) + ' mm/day');
      }
      if (owm) {
        L.push('\n☁️ OWM Cloud Data:');
        L.push('• Temp:     ' + (owm.owm_temp !== null ? owm.owm_temp.toFixed(1) + '°C' : '--'));
        L.push('• Humidity: ' + (owm.owm_humidity !== null ? owm.owm_humidity.toFixed(0) + '%' : '--'));
        L.push('• Pressure: ' + (owm.owm_pressure !== null ? owm.owm_pressure.toFixed(1) + ' hPa' : '--'));
        L.push('• Rain 1hr:  ' + (owm.owm_rain_mm > 0 ? owm.owm_rain_mm.toFixed(2) + ' mm' : 'No rain'));
      }
      if (d) {
        var t2 = fv(d.temperature);
        L.push('\n🧠 Impact:');
        if (t2 > 40) L.push('🔥 Extreme heat — zyada irrigation chahiye!');
        else if (t2 > 32) L.push('☀️ High temp — roz irrigation, ETo high');
        else if (t2 < 15) L.push('🥶 Cold — kam irrigation, ETo low');
        else L.push('✅ Optimal temperature range');
      }
      return L.join('\n');
    }

    // ══ CROP ══════════════════════════════════════════════════
    case 'crop': {
      if (!d) return '📡 Sensor data nahi.';
      var cropN = (d.crop || aiMemory.learnedFacts.crop || 'Unknown').toLowerCase();
      var L = ['🌾 **Fasal Analysis**\n'];
      L.push('Fasal:  ' + (d.crop || aiMemory.learnedFacts.crop || 'Set nahi'));
      L.push('Stage:  ' + (d.stage || '--'));
      L.push('GDD:    ' + fv(d.gdd).toFixed(0) + ' °C·day');
      L.push('Area:   ' + fv(d.plotArea_m2).toFixed(1) + ' m² (' + fv(d.plotArea_bigha).toFixed(4) + ' Bigha)');
      L.push('ETo:    ' + fv(d.eto).toFixed(2) + ' mm/day');
      L.push('CSMI:   ' + fv(d.csmi).toFixed(1) + '%');
      L.push('');
      // Crop-specific advice
      var csmiCrop = fv(d.csmi);
      if (cropN.indexOf('wheat') !== -1 || cropN.indexOf('gehun') !== -1) {
        L.push('🌾 Wheat ke liye:');
        L.push('• Optimal CSMI: 40-65%');
        L.push('• Critical stages: Tillering, Jointing, Heading, Grain fill');
        if (csmiCrop < 40) L.push('🚨 Dry! Wheat ko paani chahiye — yield loss hoga!');
        else if (csmiCrop > 70) L.push('⚠️ Wet! Root rot risk — irrigation band karo');
        else L.push('✅ Moisture perfect for wheat!');
      } else if (cropN.indexOf('rice') !== -1 || cropN.indexOf('paddy') !== -1) {
        L.push('🌾 Paddy ke liye:');
        L.push('• Optimal CSMI: 60-80%');
        L.push('• Standing water: 5-10cm ideal');
        if (csmiCrop < 55) L.push('🚨 Paddy ko zyada paani chahiye!');
        else L.push('✅ Paddy ke liye theek!');
      } else if (cropN.indexOf('makka') !== -1 || cropN.indexOf('maize') !== -1 || cropN.indexOf('corn') !== -1) {
        L.push('🌽 Maize ke liye:');
        L.push('• Optimal CSMI: 45-65%');
        L.push('• Critical: Tasseling aur Silking stage!');
        if (csmiCrop < 40) L.push('🚨 Dry! Tasseling mein yield loss pakka!');
        else L.push('✅ Maize ke liye theek!');
      } else if (cropN.indexOf('ganna') !== -1 || cropN.indexOf('sugarcane') !== -1) {
        L.push('🎋 Sugarcane ke liye:');
        L.push('• Optimal CSMI: 55-75%');
        L.push('• Grand growth phase mein daily irrigation');
        if (csmiCrop < 50) L.push('⚠️ Ganne ko aur paani chahiye!');
        else L.push('✅ Ganne ke liye sahi!');
      } else {
        L.push('• Optimal CSMI: 40-65% (general)');
        if (csmiCrop < 35) L.push('⚠️ Dry — fasal ko paani chahiye');
        else if (csmiCrop > 70) L.push('⚠️ Wet — drainage check karo');
        else L.push('✅ Mitti theek hai');
      }
      return L.join('\n');
    }

    // ══ AI SCORE ══════════════════════════════════════════════
    case 'ai_score': {
      if (!d) return '📡 Sensor data nahi.';
      var L = ['🤖 **AI Score Explained**\n'];
      L.push('Score: **' + fv(d.aiScore).toFixed(1) + ' / 120**');
      L.push('Trigger at: 65');
      L.push('Status: ' + (fv(d.aiScore) >= 65 ? '✅ ABOVE — Irrigation eligible' : '❌ BELOW — Wait'));
      L.push('');
      L.push('📊 Components:');
      L.push('• CSMI moisture:  ' + fv(d.csmi).toFixed(1) + '%');
      L.push('• SMV velocity:   ' + fv(d.smv).toFixed(4) + ' %/hr (drying rate)');
      L.push('• SMA accel:      ' + fv(d.sma).toFixed(4) + ' %/hr²');
      L.push('• TPR pattern:    ' + fv(d.tprScore).toFixed(3) + (fv(d.tprScore) >= 0.85 ? ' ✅' : ''));
      L.push('• Rain prob:      ' + fv(d.rainProb).toFixed(0) + '%');
      L.push('• ETo:            ' + fv(d.eto).toFixed(2) + ' mm/day');
      L.push('');
      L.push('🧠 Reasoning:');
      if (fv(d.aiScore) >= 65) {
        L.push('Score threshold cross — system irrigation ke liye ready hai!');
      } else {
        var gap = 65 - fv(d.aiScore);
        L.push('Score abhi ' + gap.toFixed(0) + ' points kam hai.');
        L.push('Jab mitti aur dry hogi (CSMI girega), score badhega.');
        if (fv(d.rainProb) > 40) L.push('Baarish probability ' + fv(d.rainProb).toFixed(0) + '% score suppress kar rahi hai.');
      }
      return L.join('\n');
    }

    // ══ ANALYSIS / FULL REPORT ════════════════════════════════
    case 'analysis': {
      if (!d) return '📡 Sensor data nahi — hardware check karo.';
      var sl8 = getSoilLevel(fv(d.csmi));
      var ri8 = getRainInfo();
      var wc5 = getWaterCalc();
      var allOk2 = !d.safeMode && !d.dhtFallback && !d.bmpFallback && !d.pipelineFault;
      var L = ['📊 **Full Farm Status Report**\n'];
      L.push('━━━━━━━━━━━━━━━━━━━━━');
      L.push('🌾 ' + (d.crop||'--') + ' | Stage: ' + (d.stage||'--') + ' | GDD: ' + fv(d.gdd).toFixed(0));
      L.push('📐 Area: ' + fv(d.plotArea_m2).toFixed(1) + ' m² (' + fv(d.plotArea_bigha).toFixed(3) + ' Bigha)');
      L.push('━━━━━━━━━━━━━━━━━━━━━');
      L.push('🌱 Soil: ' + sl8.level + ' — CSMI ' + fv(d.csmi).toFixed(1) + '%');
      L.push('   SM1: ' + fv(d.sm1).toFixed(1) + '% | SM2: ' + fv(d.sm2).toFixed(1) + '% | SM3: ' + fv(d.sm3).toFixed(1) + '%');
      L.push('🤖 AI: ' + fv(d.aiScore).toFixed(1) + '/120 → ' + (fv(d.aiScore) >= 65 ? 'Eligible' : 'Not yet'));
      L.push('🔌 Pump: ' + (d.pump ? '🟢 ON' : '🔴 OFF') + ' | ' + (d.autoMode ? 'Auto' : 'Manual'));
      L.push('🌧️ Rain: ' + ri8.prob.toFixed(0) + '% | ' + ri8.mm.toFixed(2) + ' mm');
      if (owm) L.push('🌡️ ' + (owm.owm_temp !== null ? owm.owm_temp.toFixed(1) : '--') + '°C | ' + (owm.owm_humidity !== null ? owm.owm_humidity.toFixed(0) : '--') + '% humidity');
      L.push('📡 ' + (d.offlineMode ? '🔴 Offline' : '🟢 Online'));
      L.push('🔧 Sensors: ' + (allOk2 ? '✅ All OK' : '⚠️ Issues!'));
      if (wc5) L.push('💧 Water need: ~' + wc5.total + ' L');
      L.push('💰 Budget: ' + fv(d.deltaBalance).toFixed(1) + ' L remaining');
      L.push('━━━━━━━━━━━━━━━━━━━━━');
      L.push('\n💡 **Action:**');
      if (d.pipelineFault)          L.push('🔴 Pipeline fault — turant check!');
      if (d.safeMode)               L.push('🔴 Safe mode — sensors fix karo!');
      if (ri8.prob > 65)            L.push('🌧️ Baarish aa rahi — sinchai mat karo');
      else if (fv(d.csmi) < 20)     L.push('🚨 Turant sinchai karo — critical!');
      else if (fv(d.csmi) < 35)     L.push('⚠️ Sinchai ki zaroorat hai');
      else if (fv(d.csmi) > 75)     L.push('💦 Zyada wet — mat karo sinchai');
      else                          L.push('✅ Sab theek — monitor karte raho');
      return L.join('\n');
    }

    // ══ HEALTH CHECK ══════════════════════════════════════════
    case 'health': {
      if (!d) return '📡 Data nahi — hardware check karo.';
      var ri9 = getRainInfo();
      var issues2 = [];
      if (d.pipelineFault)  issues2.push('🔴 Pipeline fault!');
      if (d.safeMode)       issues2.push('🔴 Soil sensors fail!');
      if (d.dhtFallback)    issues2.push('🟡 DHT22 fault');
      if (d.bmpFallback)    issues2.push('🟡 BMP280 fault');
      if (d.offlineMode)    issues2.push('🟡 Offline mode');
      if (fv(d.deltaBalance) < 0) issues2.push('🔴 Budget exceed!');
      var L = ['🏥 **System Health Check**\n'];
      if (issues2.length === 0) {
        L.push('✅ **Sab kuch bilkul theek hai!**\n');
        L.push('• Sensors:   ✅ All OK');
        L.push('• Firebase:  ✅ Online');
        L.push('• Pump:      ' + (d.pump ? '🟢 ON' : '⚪ Standby'));
        L.push('• Mitti:     ' + getSoilLevel(fv(d.csmi)).level + ' (' + fv(d.csmi).toFixed(1) + '%)');
        L.push('• Budget:    ' + fv(d.deltaBalance).toFixed(1) + ' L');
        L.push('• Rain:      ' + ri9.prob.toFixed(0) + '% probability');
        L.push('• AI Score:  ' + fv(d.aiScore).toFixed(1) + '/120');
        L.push('\n🎉 System perfectly optimized!');
      } else {
        L.push('⚠️ Issues:\n');
        issues2.forEach(function(i) { L.push(i); });
        L.push('\nCurrent:');
        L.push('• Mitti: ' + getSoilLevel(fv(d.csmi)).level + ' (' + fv(d.csmi).toFixed(1) + '%)');
        L.push('• Pump: ' + (d.pump ? '🟢 ON' : '🔴 OFF'));
        L.push('• Budget: ' + fv(d.deltaBalance).toFixed(1) + ' L');
      }
      return L.join('\n');
    }

    // ══ FERTILIZER ════════════════════════════════════════════
    case 'fertilizer': {
      return '🌿 **Khad + Paani Guide**\n\n' +
        '📌 Rules:\n\n' +
        '• Urea dene ke BAAD paani do\n' +
        '  → Nitrogen soil mein fix hone ke liye naami chahiye\n' +
        '  → Bina paani = burn ho sakta hai\n\n' +
        '• DAP/MOP → paani saath ya baad OK\n' +
        '• Liquid fertilizer → Pehle thoda paani, phir spray\n\n' +
        '• Pesticide/Fungicide spray ke BAAD:\n' +
        '  → 24-48 hr sinchai mat karo\n' +
        '  → Chemical wash ho jaayega\n\n' +
        '• Fertigation (drip se khad):\n' +
        '  → Sabse efficient method\n' +
        '  → 30-40% khad bachta hai\n' +
        '  → Seedha root zone tak';
    }

    // ══ STRESS ════════════════════════════════════════════════
    case 'stress': {
      if (!d) return '😰 Fasal stress mein hai!\n\nCheck karo:\n• Mitti dry toh nahi?\n• Zyada paani toh nahi?\n• Pest ya disease?\n• Nutrient deficiency?';
      var sl9 = getSoilLevel(fv(d.csmi));
      var L = ['😰 **Crop Stress Analysis**\n'];
      L.push('CSMI: ' + fv(d.csmi).toFixed(1) + '% — ' + sl9.level);
      L.push('Temp: ' + fv(d.temperature).toFixed(1) + '°C');
      L.push('');
      L.push('🧠 Diagnosis:');
      if (fv(d.csmi) < 25) {
        L.push('🔴 Water stress confirmed — mitti bahut dry!');
        L.push('→ Turant sinchai karo');
        L.push('→ 2 ghante mein recovery dekho');
      } else if (fv(d.csmi) > 75) {
        L.push('💦 Overwatering stress — mitti bahut wet!');
        L.push('→ Sinchai band karo, drainage check karo');
      } else if (fv(d.temperature) > 42) {
        L.push('🔥 Heat stress — temperature bahut high!');
        L.push('→ Shade netting lagao agar possible');
        L.push('→ Subah-shaam irrigation karo');
      } else {
        L.push('Moisture theek hai — stress kisi aur wajah se:');
        L.push('• Pest/disease → spray karo');
        L.push('• Nutrient deficiency → khad do');
        L.push('• Sudden temp change → natural hoga');
      }
      return L.join('\n');
    }

    // ══ INTERNET / CONNECTION ═════════════════════════════════
    case 'internet': {
      var L = ['📡 **Connection Status**\n'];
      if (!d) {
        L.push('❌ Firebase se data nahi aa raha.\n');
        L.push('Check karo:\n1. Internet on hai?\n2. WiFi password sahi?\n3. Firebase config file check karo\n4. Hardware on hai?');
        return L.join('\n');
      }
      L.push('Firebase: ' + (d.offlineMode ? '🔴 Offline' : '🟢 Online'));
      L.push('WiFi:     ' + (d.offlineMode ? '❌ Disconnected' : '✅ Connected'));
      L.push('LoRa:     ' + (d.loraActive ? '🟢 Active fallback' : '— Inactive'));
      L.push('OWM:      ' + (owm && owm.owm_valid ? '🟢 Live' : '🔴 Offline'));
      L.push('Pending:  ' + (fv(d.offlineLogCount) || 0) + ' offline logs');
      if (d.offlineMode) {
        L.push('\n🤖 Autonomous mode active — sab sensors locally kaam kar rahe hain.');
      } else {
        L.push('\n✅ Fully connected!');
      }
      return L.join('\n');
    }

    // ══ BUDGET ════════════════════════════════════════════════
    case 'budget': {
      if (!d) return '📡 Data nahi.';
      var L = ['💰 **Water Budget**\n'];
      L.push('━━━━━━━━━━━━━━━━━━━━━');
      L.push('Seasonal required:  ' + fv(d.deltaRequired).toFixed(1) + ' L');
      L.push('Irrigation applied: ' + fv(d.deltaApplied).toFixed(1) + ' L');
      L.push('Rainfall contrib:   ' + fv(d.rainfallContrib).toFixed(1) + ' L');
      L.push('Flow total:         ' + fv(d.totalLitres).toFixed(1) + ' L');
      L.push('━━━━━━━━━━━━━━━━━━━━━');
      L.push('**Balance: ' + fv(d.deltaBalance).toFixed(1) + ' L**');
      L.push('━━━━━━━━━━━━━━━━━━━━━');
      var bal2 = fv(d.deltaBalance);
      if (bal2 < 0) L.push('🔴 Budget khatam! Conservation mode mein jao.');
      else if (bal2 < 200) L.push('🟡 Budget kam bacha — carefully use karo.');
      else L.push('🟢 Budget healthy — ' + bal2.toFixed(0) + ' L available.');
      return L.join('\n');
    }

    // ══ COST ══════════════════════════════════════════════════
    case 'cost': {
      var flowKW = d ? (fv(d.flowRate) > 0 ? 0.75 : 0) : 0.75;
      return '⚡ **Irrigation Cost**\n\n' +
        'Pump electricity:\n' +
        '• 0.5 HP = ~0.37 kW → ₹3/hr\n' +
        '• 1 HP   = ~0.75 kW → ₹6/hr\n' +
        '• 2 HP   = ~1.5 kW  → ₹12/hr\n\n' +
        'Sensor-based system savings:\n' +
        '• 30-40% less runtime vs timer\n' +
        '• Rain avoidance saves 20%\n' +
        '• Pulse mode saves 40% water\n\n' +
        '🌞 Solar pump:\n' +
        '• Subah ki sinchai = free!\n' +
        '• 5-7 year payback\n\n' +
        '💡 Aapka system: Minimum energy use!';
    }

    // ══ HELP ══════════════════════════════════════════════════
    case 'help': {
      return '🤖 **Main kya samajhta hoon:**\n\n' +
        '🔌 Pump — "pump nahi chal raha"\n' +
        '🌱 Soil — "mitti kaisi hai"\n' +
        '💧 Paani — "kitna paani lagega"\n' +
        '🌧️ Baarish — "aaj baarish hogi"\n' +
        '⏰ Kab — "kab sinchai karni"\n' +
        '⏱️ Kitni der — "kitne minute"\n' +
        '🔧 Sensor — "sensor kharab"\n' +
        '📡 Internet — "firebase offline"\n' +
        '💰 Budget — "kitna bacha"\n' +
        '🌾 Crop — "wheat ke liye"\n' +
        '🤖 Score — "AI score kya"\n' +
        '📊 Report — "sab kuch batao"\n' +
        '✅ Health — "sab theek hai"\n' +
        '🌡️ Mausam — "temperature"\n' +
        '💦 Zyada — "overwatering"\n' +
        '🏜️ Kam — "fasal sukh rahi"\n' +
        '🌿 Khad — "urea ke baad paani"\n' +
        '⚡ Cost — "bijli kitni lagegi"\n\n' +
        'Hindi, English, Hinglish — sab! 😊';
    }

    // ══ NEGATIVE FEEDBACK ════════════════════════════════════════
    case 'negative': {
      var ctx_n = getFarmContext(), d_n = ctx_n.d, fv_n = ctx_n.fv;
      var lastT_n = aiMemory.lastTopic;
      var q2n = q.toLowerCase();

      // Store this as a correction
      aiMemory.corrections.push(q2n);

      var base = '';

      if (/galat|wrong|incorrect|ulta|sahi nahi|nahi sahi/.test(q2n)) {
        base = '😔 Maafi! Mujhse galat jawab mila.

' +
          'Kya aap thoda aur detail mein bata sakte hain kya galat tha?
' +
          'Main dobara koshish karta hoon — seedha aur sahi jawab dunga!';
      } else if (/samajh nahi|confus|unclear|seedha nahi|kuch nahi bataya/.test(q2n)) {
        base = '😔 Khed hai ki main aapko clearly samjha nahi paya.

' +
          'Kripya dobara poochho — thoda aur simple ya detail mein:
' +
          '• Kaunsa topic — pump, mitti, paani, baarish?
' +
          '• Kya exactly jaanna chahte ho?

' +
          'Main poori koshish karoonga!';
      } else if (/bekaar|bekar|faltu|kisi kaam ka nahi|useless|waste/.test(q2n)) {
        base = '😔 Hume khed hai ki hum aapki sahayata nahi kar paye.

' +
          'Main ek limited rule-based AI hoon — kuch sawaal miss ho sakte hain.
' +
          'Aap jo poochh rahe the woh dobara likho — main behtar koshish karta hoon!

' +
          '💡 Tip: Simple aur clear likho jaise:
' +
          '• "Pump kyun band hai"
' +
          '• "Mitti kitni dry hai"
' +
          '• "Aaj kitna paani dena hai"';
      } else if (/hate|nafrat|ganda|kharab|bura laga|pasand nahi/.test(q2n)) {
        base = '😔 Hume khed hai ki aapko achha nahi laga.

' +
          'Hum apni kami maante hain. Aapka feedback important hai!
' +
          'Batao kya problem tha — main sudharne ki koshish karoonga.';
      } else if (/disappointed|nirash|naraaz|khafa|dukhi|unhappy/.test(q2n)) {
        base = '😔 Hume sachchi khed hai ki aap disappointed hain.

' +
          'Humari koshish thi ki sahi jawab milega lekin kuch chuk gayi.
' +
          'Kya aap batayenge kahan galat hua? Main sudharta hoon!';
      } else if (/acha nahi|accha nahi|not good|not helpful/.test(q2n)) {
        base = '😔 Hume khed hai ki hum aapki sahayata nahi kar paye.

' +
          'Kripya dobara poochho — main poori mehnat se jawab dunga!
' +
          'Ya "help" type karo — main batata hoon main kya kya samajh sakta hoon.';
      } else {
        base = '😔 Hume khed hai ki aap santusht nahi hue.

' +
          'Main ek AI hoon aur seekh raha hoon. Aapka feedback mujhe behtar banata hai!
' +
          'Dobara poochho — is baar aur behtar koshish karoonga.';
      }

      // Add last topic context
      var suggestion = '';
      if (lastT_n && lastT_n !== 'negative' && lastT_n !== 'default') {
        suggestion = '

💡 Pichla topic tha: ' + lastT_n + '
Kya wahi dobara poochhen?';
      }

      // Add farm status for context
      var farmLine = '';
      if (d_n) {
        farmLine = '

📊 Current: CSMI ' + fv_n(d_n.csmi).toFixed(1) + '% | Pump ' + (d_n.pump ? '🟢 ON' : '🔴 OFF');
      }

      return base + suggestion + farmLine;
    }

    // ══ POSITIVE FEEDBACK ════════════════════════════════════════
    case 'positive': {
      var ctx_p = getFarmContext(), d_p = ctx_p.d, fv_p = ctx_p.fv;
      var lastT = aiMemory.lastTopic;
      var q2p = q.toLowerCase();
      var resp = '';

      if (/bhai|yaar|dost|friend/.test(q2p)) {
        var r = ['😄 Haha bhai! Tera TSCRIC AI hoon — khet ki baat karo!',
                 '🤜 Bhai sawaal pooch, main ready hoon!',
                 '😊 Yaar humble AI hoon — farm ki problem batao!'];
        resp = r[aiMemory.sessionCount % r.length];
      } else if (/like you|love you|pasand|pyaar|love/.test(q2p)) {
        resp = '😊 Shukriya bhai! Main sirf tera khet theek rakhna chahta hoon! 🌾';
      } else if (/excellent|amazing|awesome|superb|zabardast|kamaal/.test(q2p)) {
        var r = ['🙏 Bahut shukriya! Yahi koshish hai!',
                 '😄 Khushi hui! Ab batao aur kya poochna hai?',
                 '🌾 Main seekhta rehta hoon aur behtar hota hoon!'];
        resp = r[aiMemory.sessionCount % r.length];
      } else if (/bahut sahi|tum sahi|you are|you re|bahut acha ho/.test(q2p)) {
        resp = '😊 Shukriya bhai! Koshish karta hoon sahi jawab milega!

Aur kuch poochna hai?';
      } else if (/thank|shukriya|dhanyawad/.test(q2p)) {
        var r = ['🙏 Koi baat nahi! Aur sawaal ho toh poochho!',
                 '😊 Welcome bhai! Farm ki baat poochho!',
                 '🌾 Shukriya ki zaroorat nahi — yahi kaam hai!'];
        resp = r[aiMemory.sessionCount % r.length];
      } else {
        var r = ['👍 Shukriya! Kuch aur farm ke baare mein poochho!',
                 '😊 Accha laga! Pump, mitti, baarish — jo bhi ho!',
                 '✅ Theek hai! Aur koi sawaal?',
                 '🌾 Khushi hui! Khet ka kya haal hai abhi?'];
        resp = r[aiMemory.sessionCount % r.length];
      }

      if (lastT === 'pump')      resp += '

💡 Pump ke baare mein kuch aur?';
      else if (lastT === 'soil') resp += '

💡 Mitti ke baare mein kuch aur?';
      else if (lastT === 'rain') resp += '

💡 Baarish ke baare mein kuch aur?';
      else if (lastT === 'water_qty' || lastT === 'irrigation') resp += '

💡 Sinchai ke baare mein kuch aur?';

      if (d_p) resp += '

📊 Farm: CSMI ' + fv_p(d_p.csmi).toFixed(1) + '% | Pump ' + (d_p.pump ? '🟢 ON' : '🔴 OFF') + ' | Rain ' + getRainInfo().prob.toFixed(0) + '%';
      return resp;
    }
💡 Baarish ya mausam ke baare mein aur?';
      else if (lastT === 'water_qty') resp += '

💡 Paani ki quantity ke baare mein aur?';
      if (d_p) resp += '

📊 Abhi: CSMI ' + fv_p(d_p.csmi).toFixed(1) + '% | Pump ' + (d_p.pump ? '🟢 ON' : '🔴 OFF');
      return resp;
    }

    // ══ DEFAULT ═══════════════════════════════════════════════
    default: {
      var farmSnap = d ?
        'Abhi: CSMI ' + fv(d.csmi).toFixed(1) + '% | Pump ' + (d.pump ? '🟢 ON' : '🔴 OFF') + ' | Rain ' + getRainInfo().prob.toFixed(0) + '%' :
        'Hardware connected nahi.';

      // Smart suggestions based on farm state
      var smartTip = '';
      if (d) {
        if (fv(d.csmi) < 25)        smartTip = '\n🚨 Mitti bahut dry hai — "sinchai karo" poochho!';
        else if (fv(d.csmi) > 75)   smartTip = '\n💦 Mitti bahut wet hai — "overwatering" poochho!';
        else if (!d.pump && fv(d.aiScore) > 55) smartTip = '\n⚡ Score high hai — "pump kyun band" poochho!';
        else if (getRainInfo().prob > 60) smartTip = '\n🌧️ Baarish expected — "baarish hogi kya" poochho!';
      }

      // Context from last topic
      var lastHint = '';
      if (aiMemory.lastTopic && aiMemory.lastTopic !== 'default' && aiMemory.lastTopic !== 'negative') {
        lastHint = '\n\n💭 Pehle "' + aiMemory.lastTopic + '" pe baat thi — wahi continue karein?';
      }

      return '🤔 Yeh poora samajh nahi aaya: "' + q.substring(0, 60) + '"\n\n' +
        farmSnap + smartTip + lastHint + '\n\n' +
        '📋 Kuch aisa poochho:\n' +
        '• Pump: "pump kyun band hai" / "pump kaise kaam karta"\n' +
        '• Mitti: "mitti kaisi hai" / "soil dry hai kya"\n' +
        '• Paani: "kitna paani dena hai" / "paani kaisa hai"\n' +
        '• Baarish: "aaj baarish hogi" / "rain probability"\n' +
        '• Kab: "sinchai kab karni" / "pump kab band hoga"\n' +
        '• Kyun: "pump kyun nahi chala" / "mitti kyun dry"\n' +
        '• Budget: "kitna paani bacha" / "water balance"\n' +
        '• Status: "sab theek hai" / "full report do"\n\n' +
        '"help" type karo — main poori list dunga! 😊';
    }
  }
}


function appendAIMessage(role, text, isWelcome = false) {
  const container = document.getElementById('aiChatMessages');
  if (!container) return;

  const wrap = document.createElement('div');
  wrap.className = 'ai-msg-wrap ' + (role === 'user' ? 'ai-msg-wrap--user' : 'ai-msg-wrap--model');

  const bubble = document.createElement('div');
  bubble.className = 'ai-bubble ' + (role === 'user' ? 'ai-bubble--user' : 'ai-bubble--model');

  // Format markdown-lite: bold, bullets, line breaks
  bubble.innerHTML = formatAIText(text);

  const ts = document.createElement('div');
  ts.className = 'ai-timestamp';
  ts.textContent = new Date().toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });

  if (role === 'model') {
    const avatar = document.createElement('div');
    avatar.className = 'ai-avatar';
    avatar.textContent = isWelcome ? '🌾' : '🤖';
    wrap.appendChild(avatar);
    wrap.appendChild(bubble);
    wrap.appendChild(ts);
  } else {
    wrap.appendChild(ts);
    wrap.appendChild(bubble);
  }

  container.appendChild(wrap);
  // Smooth scroll to latest message
  container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
}

// ── Format AI response text — robust line-by-line renderer ──
function formatAIText(raw) {
  if (!raw || typeof raw !== 'string') return '<p>—</p>';

  const lines   = raw.split('\n');
  let html      = '';
  let inList    = false;
  let listTag   = 'ul';

  const closeList = () => {
    if (inList) { html += `</${listTag}>`; inList = false; }
  };

  const inlineFormat = s =>
    s
      .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
      .replace(/\*\*(.+?)\*\*/g,     '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g,         '<em>$1</em>')
      .replace(/`(.+?)`/g,           '<code>$1</code>');

  for (let i = 0; i < lines.length; i++) {
    const raw_line = lines[i];
    const line     = raw_line.trimEnd();

    // Empty line → close list, add paragraph break
    if (!line.trim()) {
      closeList();
      if (html && !html.endsWith('<br>') && !html.endsWith('</ul>') &&
          !html.endsWith('</ol>') && !html.endsWith('</p>')) {
        html += '<br>';
      }
      continue;
    }

    // Heading lines (## or ###)
    if (/^#{1,3}\s/.test(line)) {
      closeList();
      const text = inlineFormat(line.replace(/^#{1,3}\s+/, ''));
      html += `<p class="ai-heading">${text}</p>`;
      continue;
    }

    // Horizontal rule separator (--- or ***)
    if (/^[-*]{3,}$/.test(line.trim())) {
      closeList();
      html += '<hr class="ai-hr">';
      continue;
    }

    // Unordered list item (-, *, •)
    const ulMatch = line.match(/^(\s*)([-*•])\s+(.+)$/);
    if (ulMatch) {
      if (!inList || listTag !== 'ul') { closeList(); html += '<ul>'; inList = true; listTag = 'ul'; }
      html += `<li>${inlineFormat(ulMatch[3])}</li>`;
      continue;
    }

    // Ordered list item (1. or 1))
    const olMatch = line.match(/^(\s*)\d+[.)]\s+(.+)$/);
    if (olMatch) {
      if (!inList || listTag !== 'ol') { closeList(); html += '<ol>'; inList = true; listTag = 'ol'; }
      html += `<li>${inlineFormat(olMatch[2])}</li>`;
      continue;
    }

    // Plain paragraph text
    closeList();
    html += `<span>${inlineFormat(line)}</span><br>`;
  }

  closeList();

  // Clean up trailing <br> tags
  html = html.replace(/(<br>)+$/, '');

  return html || '<p>—</p>';
}

// ── Loading state ─────────────────────────────────────────
function setAILoading(loading) {
  aiIsLoading = loading;
  const indicator = document.getElementById('aiTypingIndicator');
  const sendBtn   = document.getElementById('aiSendBtn');
  const sendIcon  = document.getElementById('aiSendIcon');
  if (indicator) indicator.style.display = loading ? 'flex' : 'none';
  if (sendBtn)   sendBtn.disabled        = loading;
  if (sendIcon)  sendIcon.textContent    = loading ? '⏳' : '➤';
  if (loading)   updateAIStatusBadge('thinking');

  // Scroll to show typing indicator
  if (loading) {
    const container = document.getElementById('aiChatMessages');
    if (container) container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
  }
}

// ── Status badge ──────────────────────────────────────────
function updateAIStatusBadge(state) {
  const badge = document.getElementById('aiStatusBadge');
  const dot   = document.getElementById('aiGlowDot');
  if (!badge) return;
  const states = {
    ready:    { text: '● Ready',     cls: 'ai-badge--ready'   },
    thinking: { text: '◉ Thinking…', cls: 'ai-badge--thinking'},
    offline:  { text: '○ Offline',   cls: 'ai-badge--offline' },
    error:    { text: '● Error',     cls: 'ai-badge--error'   }
  };
  const s = states[state] || states.ready;
  badge.textContent = s.text;
  badge.className   = 'ai-status-badge ' + s.cls;
  if (dot) dot.className = 'ai-chat-glow-dot ' + s.cls;
}

// ── Clear chat ────────────────────────────────────────────
function clearAIChat() {
  aiChatHistory = [];
  const container = document.getElementById('aiChatMessages');
  if (container) container.innerHTML = '';
  initAIChat();
}

// ── Input helpers ─────────────────────────────────────────
function handleAIInputKey(event) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    sendAIMessage();
  }
}

function autoResizeTextarea(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  updateCharCount(el.value.length);
}

function updateCharCount(len) {
  const el = document.getElementById('aiCharCount');
  if (el) {
    el.textContent = len + '/500';
    el.style.color = len > 450 ? 'var(--orange)' : 'var(--text-muted)';
  }
}

// ── Bootstrap AI chat — guarded against double-call ──────
let aiChatBooted = false;
function bootstrapAIChat() {
  if (aiChatBooted) return;
  aiChatBooted = true;
  initAIChat();
  updateAIStatusBadge('ready');
}

// Patch initFirebase to also bootstrap AI chat
const _origInitFirebase = initFirebase;
initFirebase = function() {
  _origInitFirebase();
  bootstrapAIChat();
};
