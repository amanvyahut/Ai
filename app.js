/* ============================================================
   TSCRIC-LoRa Dashboard — app.js FINAL PRODUCTION
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
// 🤖 GEMINI AI FARM ASSISTANT
// ============================================================
//

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

function ruleBasedResponse(q) {
  var d   = lastData || null;
  var fv  = function(v) { return isNaN(parseFloat(v)) ? 0 : parseFloat(v); };
  var owm = owmDirectData || null;

  // ══════════════════════════════════════════════
  // NORMALIZE
  // ══════════════════════════════════════════════
  var q2 = q.toLowerCase()
    .replace(/[?!।,\.]/g,' ')
    .replace(/\s+/g,' ').trim();

  function has(words) {
    return words.some(function(w){ return q2.indexOf(w) !== -1; });
  }
  function sc_w(words) {
    return words.filter(function(w){ return q2.indexOf(w) !== -1; }).length;
  }

  // ══════════════════════════════════════════════
  // HELPERS
  // ══════════════════════════════════════════════
  function soilCond() {
    if(!d) return null;
    var c = fv(d.csmi);
    if(c<20) return {level:'Bahut Dry 🔴', ok:false, advice:'Turant sinchai karo!'};
    if(c<35) return {level:'Dry 🟡',        ok:false, advice:'Sinchai ki zaroorat hai.'};
    if(c<60) return {level:'Optimal ✅',    ok:true,  advice:'Mitti bilkul theek hai.'};
    if(c<80) return {level:'Moist 🟢',      ok:true,  advice:'Mitti achi hai.'};
    return           {level:'Bahut Wet 🔵', ok:false, advice:'Zyada paani — drainage check karo.'};
  }
  function rainI() {
    var prob=0,src='OWM',mm=0;
    if(d && fv(d.rainProb)>0){prob=fv(d.rainProb);src='Local';}
    else if(owm && owm.owm_rain_prob>0){prob=owm.owm_rain_prob;src='OWM Forecast';}
    if(d && fv(d.owm_rain_mm)>0) mm=fv(d.owm_rain_mm);
    else if(owm && owm.owm_rain_mm>0) mm=owm.owm_rain_mm;
    return {prob:prob,src:src,mm:mm};
  }
  function locName() {
    try{ return WEATHER_LOCATIONS[selectedWeatherLocation].label; }catch(e){ return 'Bhopal'; }
  }
  // Irrigation needed litres calculation
  function calcIrrigLitres() {
    if(!d) return null;
    var area    = fv(d.plotArea_m2) || 10;
    var eto     = fv(d.eto) || 3;
    var csmi    = fv(d.csmi);
    var deficit = Math.max(0, 45 - csmi); // target 45% CSMI
    // approx: 1mm over 1m2 = 1 litre, root zone depth factor
    var needed  = (deficit / 100) * area * 300; // 300mm root zone
    var eto_l   = eto * area;
    return { needed: needed.toFixed(1), eto_l: eto_l.toFixed(1), area: area };
  }
  function sensorAllOk() {
    if(!d) return false;
    return !d.safeMode && !d.dhtFallback && !d.bmpFallback && !d.pipelineFault
      && fv(d.sm1)>0 && fv(d.sm2)>0 && fv(d.sm3)>0;
  }

  // ══════════════════════════════════════════════
  // INTENT SCORES
  // ══════════════════════════════════════════════
  var I = {
    pump:     sc_w(['pump','motor','shuru','start','band','nahi chal','relay','chalu','kyu band','engine','pumping','on karo','off karo']),
    rain:     sc_w(['baarish','barish','rain','barsaat','hogi','monsoon','brish','varsha','badal','toofan','garj','bijli','forecast','probability']),
    soil:     sc_w(['soil','mitti','moisture','naami','nami','csmi','dry','wet','geela','sukha','sm1','sm2','sm3','sookhi','bheja','khushk','jameen']),
    sensor:   sc_w(['sensor','kharab','defective','broken','dht','bmp','flow','safe mode','fault','fail','damaged','reading','hardware','capacitive']),
    internet: sc_w(['internet','connection','firebase','offline','online','network','wifi','lora','sync','signal','net nahi','disconnect','server']),
    sinchai:  sc_w(['sinchai','irrigation','lagao','paani do','kab karo','karna chahiye','schedule','complete','ho gaya','khatam','done','finish']),
    water_q:  sc_w(['kitna paani','kitna pani','paani kitna','pani kitna','kitna lagega','lagega','kitne litre','paani chahiye','water chahiye','need water','how much water']),
    budget:   sc_w(['budget','balance','kitna bacha','remaining','seasonal','litre','liter','applied','contribution','total','use hua','consume','kharcha','bacha']),
    crop:     sc_w(['crop','fasal','wheat','gehun','rice','paddy','corn','makka','soybean','ganna','stage','gdd','growth','kharif','rabi','beej']),
    score_ai: sc_w(['score','ai score','threshold','trigger','smv','sma','tpr','velocity','eligible','kyu nahi trigger']),
    analysis: sc_w(['analysis','full','sabkuch','sab kuch','overview','status','report','batao sab','kya chal','auto farm','summary','jankari do','update','haal']),
    weather:  sc_w(['temperature','temp','garmi','thand','humidity','pressure','hpa','celsius','degree','mausam','kal','aaj','barometer','eto']),
    health:   sc_w(['sab theek','ok hai','theek hai','all ok','sab ok','koi problem','koi issue','normal','fine','accha','good','sahi','correct','perfect','everything']),
    help:     sc_w(['help','madad','options','features','guide','list','kya puch','shortcuts','kya kar'])
  };

  // ══════════════════════════════════════════════
  // GREETING (fast path)
  // ══════════════════════════════════════════════
  var greets = ['hi','hello','hii','namaste','namaskar','hey','good morning','good evening','good night','kya haal','kaise ho','theek ho','wassup','hy'];
  var isGreet = greets.some(function(g){ return q2===g || q2.startsWith(g+' '); });
  if(isGreet && I.pump+I.rain+I.soil+I.sensor+I.budget+I.analysis===0){
    var st = d ? ('System '+(d.offlineMode?'🔴 Offline':'🟢 Online')+' | Pump '+(d.pump?'🟢 ON':'🔴 OFF')+' | Mitti CSMI '+fv(d.csmi).toFixed(1)+'%') : 'Hardware se connect ho raha hai.';
    return '👋 Namaste!\n\n'+st+'\n\nKuch puchna ho? "help" type karo!';
  }

  // ══════════════════════════════════════════════
  // COMBO / SPECIAL INTENTS
  // ══════════════════════════════════════════════

  // 1. Kitna paani lagega — water quantity question
  var isWaterQ = I.water_q>=1 || (has(['kitna','lagega','chahiye']) && has(['paani','pani','water','litre','liter']));
  if(isWaterQ) return waterQuantityResponse(d,fv,owm,soilCond,rainI,calcIrrigLitres);

  // 2. Temperature / weather specific
  var isTempQ = has(['temperature','temp','garmi kitni','kitni garmi','kitna temp','temp kitna','degree','celsius','kaisa mausam','mausam kaisa','aaj ka mausam','weather kaisa','kal ka','kal ka mausam']);
  if(isTempQ || (I.weather>=2 && I.rain===0 && I.soil===0)) return weatherResponse(d,fv,owm,locName);

  // 3. Irrigation complete + budget remaining
  var isIrrigDone = has(['complete','ho gaya','ho gayi','khatam','done','finish','ho chuka','over','poora']) && has(['sinchai','irrigation','paani','water','pump']);
  if(isIrrigDone || (I.sinchai>=1 && I.budget>=1)) return irrigSummaryResponse(d,fv,owm,soilCond,rainI);

  // 4. Sab theek / everything ok
  var isAllOk = has(['sab theek','everything ok','all ok','sab ok','koi problem nahi','koi issue nahi','sab sahi','sab fine','working fine','properly chal','sab kuch theek']);
  if(isAllOk || (I.health>=2)) return healthCheckResponse(d,fv,owm,soilCond,rainI,sensorAllOk);

  // 5. Should I irrigate — decision
  var isShouldIrrig = has(['karo ya nahi','karna chahiye','lagaon','dena chahiye','ab sinchai','irrigation karo','paani dena','sinchai lagao','kab lagao','lagana chahiye']);
  if(isShouldIrrig) return irrigDecisionResponse(d,fv,owm,soilCond,rainI,calcIrrigLitres);

  // 6. Project/system not working overall
  var isSystemFail = has(['kuch nahi chal raha','sab band','system down','kuch kaam nahi','nothing working','system fail','dashboard nahi','kharab ho gaya']);
  if(isSystemFail) return systemDiagResponse(d,fv,owm,sensorAllOk);

  // ══════════════════════════════════════════════
  // PICK BEST INTENT
  // ══════════════════════════════════════════════
  var best='default', bestSc=0;
  Object.keys(I).forEach(function(k){ if(I[k]>bestSc){bestSc=I[k];best=k;} });
  if(bestSc===0) best='default';

  switch(best){
    case 'pump':     return pumpResponse(d,fv,soilCond);
    case 'rain':     return rainResponse(d,fv,owm,rainI,locName,soilCond);
    case 'soil':     return soilResponse(d,fv,soilCond);
    case 'sensor':   return sensorResponse(d,fv);
    case 'internet': return internetResponse(d,fv,owm);
    case 'sinchai':  return irrigDecisionResponse(d,fv,owm,soilCond,rainI,calcIrrigLitres);
    case 'budget':   return budgetResponse(d,fv);
    case 'crop':     return cropResponse(d,fv,soilCond);
    case 'score_ai': return aiScoreResponse(d,fv);
    case 'analysis': return analysisResponse(d,fv,owm,soilCond,rainI,sensorAllOk);
    case 'weather':  return weatherResponse(d,fv,owm,locName);
    case 'health':   return healthCheckResponse(d,fv,owm,soilCond,rainI,sensorAllOk);
    case 'help':     return helpResponse();
    default:         return defaultResponse(q2);
  }
}

// ════════════════════════════════════════════════════════════
// RESPONSE HANDLERS
// ════════════════════════════════════════════════════════════

function pumpResponse(d,fv,soilCond){
  if(!d) return '📡 Sensor data nahi mila.\n\n• Arduino/ESP on hai?\n• Firebase connected hai?\n• Power supply check karo.';
  var sc=soilCond(), L=['🔌 **Pump Status**\n'];
  L.push('Status: '+(d.pump?'🟢 ON — chal raha hai':'🔴 OFF — band hai'));
  L.push('Mode: '+(d.autoMode?'🤖 Automatic':'🖐️ Manual'));
  L.push('AI Score: '+fv(d.aiScore).toFixed(1)+'/120 (threshold: 65)');
  L.push('Flow rate: '+fv(d.flowRate).toFixed(2)+' L/min');
  L.push('Total applied: '+fv(d.totalLitres).toFixed(1)+' L');
  L.push('');
  if(d.pipelineFault){
    L.push('🔴 **Pipeline Fault!** Pump auto-band ho gaya.');
    L.push('→ YF-S201 flow sensor aur pipeline check karo.');
    L.push('→ Blockage ya leak ho sakti hai.');
  } else if(d.safeMode){
    L.push('🔴 **Safe Mode Active!** Soil sensors fail hain.');
    L.push('→ SM1/SM2/SM3 wiring check karo.');
    L.push('→ Jab tak sensors fix nahi — pump limited rahega.');
  } else if(d.pump){
    L.push('✅ Pump sahi chal raha hai.');
    L.push('→ Flow: '+fv(d.flowRate).toFixed(2)+' L/min');
  } else if(fv(d.aiScore)<65){
    L.push('ℹ️ Band hai — mitti mein kaafi naami hai abhi.');
    L.push('CSMI: '+fv(d.csmi).toFixed(1)+'% — '+(sc?sc.level:'--'));
    L.push('Score '+fv(d.aiScore).toFixed(0)+' — threshold 65 se kam.');
  } else {
    L.push('⚡ Score threshold ke upar — jald trigger hoga.');
  }
  if(d.offlineMode) L.push('\n📡 Offline mode — autonomous chal raha hai.');
  return L.join('\n');
}

function rainResponse(d,fv,owm,rainI,locName,soilCond){
  var ri=rainI(), sc=soilCond();
  var L=['🌧️ **Baarish ki Jankari**\n'];
  L.push('📍 Location: '+locName());
  if(owm){
    L.push('🌡️ Temp: '+(owm.owm_temp!==null?owm.owm_temp.toFixed(1)+'°C':'--'));
    L.push('💧 Humidity: '+(owm.owm_humidity!==null?owm.owm_humidity.toFixed(0)+'%':'--'));
    L.push('🌀 Pressure: '+(owm.owm_pressure!==null?owm.owm_pressure.toFixed(1)+' hPa':'--'));
  }
  L.push('');
  L.push('🌂 Rain Probability: '+ri.prob.toFixed(0)+'% ('+ri.src+')');
  if(ri.prob<20)      L.push('☀️ **Aaj baarish nahi hogi.** Agar mitti dry hai toh sinchai karo.');
  else if(ri.prob<40) L.push('⛅ **Thodi sambhavna hai** — dekhte raho thodi der.');
  else if(ri.prob<70) L.push('🌦️ **Baarish hone wali hai!** Sinchai rokke raho.');
  else                L.push('🌧️ **Pakki baarish aayegi!** Bilkul sinchai mat karo.');
  if(ri.mm>0) L.push('\nPichle 1hr mein: '+ri.mm.toFixed(2)+' mm baarish ho chuki hai.');
  if(sc){
    L.push('\nMitti abhi: '+sc.level+' ('+fv(d.csmi).toFixed(1)+'%)');
    if(ri.prob>50) L.push('💡 Baarish ke baad mitti check karo — sinchai ki zaroorat nahi hogi.');
  }
  return L.join('\n');
}

function soilResponse(d,fv,soilCond){
  if(!d) return '📡 Sensor data nahi hai.\n\nHardware connected hai? Firebase check karo.';
  var sc=soilCond();
  var L=['🌱 **Mitti ki Condition**\n'];
  L.push('CSMI (overall): '+fv(d.csmi).toFixed(1)+'%  →  '+(sc?sc.level:'--'));
  L.push('');
  L.push('📊 Layer-wise reading:');
  L.push('• 15cm (SM1): '+fv(d.sm1).toFixed(1)+'%'+(fv(d.sm1)<=0?' ⚠️ FAULT':''));
  L.push('• 30cm (SM2): '+fv(d.sm2).toFixed(1)+'%'+(fv(d.sm2)<=0?' ⚠️ FAULT':''));
  L.push('• 45cm (SM3): '+fv(d.sm3).toFixed(1)+'%'+(fv(d.sm3)<=0?' ⚠️ FAULT':''));
  L.push('');
  L.push('VWC1: '+fv(d.vwc1).toFixed(3)+' | VWC2: '+fv(d.vwc2).toFixed(3)+' | VWC3: '+fv(d.vwc3).toFixed(3));
  L.push('🌡️ Temp: '+fv(d.temperature).toFixed(1)+'°C | Humidity: '+fv(d.humidity).toFixed(0)+'%');
  L.push('ETo: '+fv(d.eto).toFixed(2)+' mm/day');
  L.push('');
  if(sc) L.push('💡 '+sc.advice);
  if(d.safeMode) L.push('\n⚠️ Safe Mode — soil sensors fail. Physical inspection karo.');
  return L.join('\n');
}

function sensorResponse(d,fv){
  var L=['🔧 **Sensor Health Report**\n'];
  if(!d){
    L.push('❌ Koi sensor data nahi mila.\n');
    L.push('Possible reasons:');
    L.push('• Hardware on nahi hai');
    L.push('• Firebase connection nahi');
    L.push('• ESP8266 board check karo');
    L.push('• Power supply check karo');
    return L.join('\n');
  }
  var ok=!d.safeMode&&!d.dhtFallback&&!d.bmpFallback&&!d.pipelineFault&&fv(d.sm1)>0&&fv(d.sm2)>0&&fv(d.sm3)>0;
  if(ok){
    L.push('✅ Sab sensors perfectly theek hain!\n');
    L.push('• SM1 (15cm): '+fv(d.sm1).toFixed(1)+'%  ✅');
    L.push('• SM2 (30cm): '+fv(d.sm2).toFixed(1)+'%  ✅');
    L.push('• SM3 (45cm): '+fv(d.sm3).toFixed(1)+'%  ✅');
    L.push('• DHT22 (Temp/Humidity): ✅');
    L.push('• BMP280 (Pressure): ✅');
    L.push('• YF-S201 (Flow): ✅');
  } else {
    L.push('⚠️ Issues detected:\n');
    if(d.safeMode)              L.push('🔴 SAFE MODE — Soil sensors complete fail!');
    if(fv(d.sm1)<=0&&!d.safeMode) L.push('🔴 SM1 (15cm) — no reading');
    if(fv(d.sm2)<=0&&!d.safeMode) L.push('🔴 SM2 (30cm) — no reading');
    if(fv(d.sm3)<=0&&!d.safeMode) L.push('🔴 SM3 (45cm) — no reading');
    if(d.dhtFallback)           L.push('🟡 DHT22 — fault, OWM fallback active');
    if(d.bmpFallback)           L.push('🟡 BMP280 — fault, OWM fallback active');
    if(d.pipelineFault)         L.push('🔴 Flow/Pipeline — FAULT, pump band!');
    L.push('\n💡 Kya karo:');
    if(d.safeMode||fv(d.sm1)<=0||fv(d.sm2)<=0||fv(d.sm3)<=0){
      L.push('• Capacitive soil sensor wiring check karo');
      L.push('• ESP8266 ADC pin check karo');
      L.push('• Sensor physically damage toh nahi?');
    }
    if(d.dhtFallback)   L.push('• DHT22 data pin aur VCC check karo');
    if(d.bmpFallback)   L.push('• BMP280 I2C (SDA/SCL) wiring check karo');
    if(d.pipelineFault) L.push('• YF-S201 aur pipeline — blockage/leak check karo');
  }
  return L.join('\n');
}

function internetResponse(d,fv,owm){
  var L=['📡 **Connection Status**\n'];
  if(!d){
    L.push('❌ Firebase se data nahi aa raha.\n');
    L.push('Possible reasons:');
    L.push('• Internet band hai');
    L.push('• Firebase config galat hai');
    L.push('• Hardware on nahi');
    L.push('• GitHub Pages CORS issue');
    return L.join('\n');
  }
  L.push('Firebase: '+(d.offlineMode?'🔴 Offline':'🟢 Online'));
  L.push('WiFi: '+(d.offlineMode?'❌ Nahi':'✅ Connected'));
  L.push('LoRa: '+(d.loraActive?'🟢 Active (fallback)':'— Inactive'));
  L.push('OWM API: '+(owm&&owm.owm_valid?'🟢 Live':'🔴 Offline'));
  L.push('Pending logs: '+(fv(d.offlineLogCount)||0));
  L.push('');
  if(d.offlineMode){
    L.push('ℹ️ System autonomous mode mein hai.');
    L.push('Sab decisions local sensors se ho rahe hain.');
    if(d.loraActive) L.push('LoRa se nearby node se data aa raha hai.');
  } else {
    L.push('✅ Sab connected — system fully online hai.');
  }
  return L.join('\n');
}

// ── WATER QUANTITY — Kitna paani lagega ──────────────────
function waterQuantityResponse(d,fv,owm,soilCond,rainI,calcIrrigLitres){
  if(!d) return '📡 Sensor data nahi hai — hardware check karo.';
  var sc=soilCond(), ri=rainI(), calc=calcIrrigLitres();
  var L=['💧 **Kitna Paani Lagega?**\n'];
  L.push('📐 Plot area: '+fv(d.plotArea_m2).toFixed(1)+' m² ('+fv(d.plotArea_bigha).toFixed(4)+' Bigha)');
  L.push('🌱 Mitti: '+(sc?sc.level:'--')+' — CSMI '+fv(d.csmi).toFixed(1)+'%');
  L.push('💧 ETo: '+fv(d.eto).toFixed(2)+' mm/day');
  L.push('🌧️ Rain: '+ri.prob.toFixed(0)+'% probability');
  L.push('');
  if(ri.prob>60){
    L.push('🌧️ **Baarish aane wali hai ('+ri.prob.toFixed(0)+'%)!**');
    L.push('Abhi paani dene ki zaroorat NAHI.');
    L.push('Baarish ke baad mitti check karo.');
  } else if(d.pipelineFault){
    L.push('🔴 Pipeline fault — pehle repair karo!');
  } else if(sc && fv(d.csmi)>70){
    L.push('💦 Mitti already bahut wet hai — paani mat do!');
  } else {
    L.push('📊 **Estimated Requirement:**');
    if(calc){
      L.push('• Moisture deficit se: ~'+calc.needed+' L');
      L.push('• ETo loss (daily): ~'+calc.eto_l+' L/day');
      var total = (parseFloat(calc.needed)+parseFloat(calc.eto_l)).toFixed(1);
      L.push('• **Total estimated: ~'+total+' L**');
    }
    L.push('');
    L.push('💡 System pulse irrigation use karta hai:');
    L.push('• 30 sec ON → 2 min OFF cycles');
    L.push('• Flow rate: '+fv(d.flowRate).toFixed(2)+' L/min');
    var flowR = fv(d.flowRate) > 0 ? fv(d.flowRate) : 5;
    if(calc){
      var mins = (parseFloat(calc.needed)/flowR).toFixed(0);
      L.push('• Estimated time: ~'+mins+' minutes');
    }
    L.push('');
    L.push('💰 Budget remaining: '+fv(d.deltaBalance).toFixed(1)+' L');
    if(fv(d.aiScore)>=65){
      L.push('🤖 AI Score '+fv(d.aiScore).toFixed(0)+' — Irrigation trigger ready!');
    } else {
      L.push('🤖 AI Score '+fv(d.aiScore).toFixed(0)+'/65 — Abhi threshold se neeche.');
    }
  }
  return L.join('\n');
}

// ── IRRIGATION DECISION ───────────────────────────────────
function irrigDecisionResponse(d,fv,owm,soilCond,rainI,calcIrrigLitres){
  if(!d) return '📡 Sensor data nahi hai.';
  var sc=soilCond(), ri=rainI(), calc=calcIrrigLitres();
  var L=['💧 **Sinchai Karni Chahiye?**\n'];
  L.push('Mitti: '+(sc?sc.level:'--')+' ('+fv(d.csmi).toFixed(1)+'%)');
  L.push('AI Score: '+fv(d.aiScore).toFixed(1)+'/120');
  L.push('Rain: '+ri.prob.toFixed(0)+'%');
  L.push('Pump: '+(d.pump?'🟢 ON':'🔴 OFF'));
  L.push('');
  if(d.pipelineFault){
    L.push('🔴 **Nahi ho sakti** — Pipeline fault! Pehle repair karo.');
  } else if(ri.prob>60){
    L.push('🌧️ **Mat karo sinchai** — Baarish '+ri.prob.toFixed(0)+'% confirm!');
  } else if(sc&&fv(d.csmi)<20){
    L.push('🚨 **Turant sinchai karo!** Bahut dry hai!');
    if(calc) L.push('~'+calc.needed+' L chahiye.');
  } else if(sc&&fv(d.csmi)<35){
    L.push('⚠️ **Sinchai chahiye.** Dry ho rahi hai mitti.');
    if(calc) L.push('~'+calc.needed+' L estimated.');
    if(ri.prob>30) L.push('Thoda wait karo — '+ri.prob.toFixed(0)+'% baarish chance.');
  } else if(sc&&fv(d.csmi)>75){
    L.push('💦 **Mat karo** — Mitti already bahut wet!');
  } else {
    L.push('✅ **Abhi zaroorat nahi.** Mitti optimal hai.');
  }
  L.push('\nBudget: '+fv(d.deltaBalance).toFixed(1)+' L remaining');
  return L.join('\n');
}

// ── IRRIGATION SUMMARY ────────────────────────────────────
function irrigSummaryResponse(d,fv,owm,soilCond,rainI){
  if(!d) return '📡 Sensor data nahi hai.';
  var sc=soilCond(), ri=rainI();
  var L=['✅ **Sinchai Summary**\n'];
  L.push('Pump: '+(d.pump?'🟢 Abhi ON':'🔴 OFF — complete'));
  L.push('Flow rate: '+fv(d.flowRate).toFixed(2)+' L/min');
  L.push('Is session mein: '+fv(d.totalLitres).toFixed(1)+' L applied');
  L.push('');
  L.push('📊 **Water Budget:**');
  L.push('• Seasonal required: '+fv(d.deltaRequired).toFixed(1)+' L');
  L.push('• Irrigation applied: '+fv(d.deltaApplied).toFixed(1)+' L');
  L.push('• Rainfall contribution: '+fv(d.rainfallContrib).toFixed(1)+' L');
  L.push('• **Balance remaining: '+fv(d.deltaBalance).toFixed(1)+' L**');
  L.push('');
  L.push('🌱 Mitti abhi: '+(sc?sc.level:'--')+' ('+fv(d.csmi).toFixed(1)+'%)');
  L.push('');
  var bal=fv(d.deltaBalance);
  if(bal<0)         L.push('🔴 Season ka budget exceed ho gaya!');
  else if(bal<200)  L.push('🟡 Budget kam bacha — '+bal.toFixed(0)+' L hi bacha hai.');
  else              L.push('🟢 Budget theek — '+bal.toFixed(0)+' L aur available hai.');
  if(ri.prob>40)    L.push('\n🌧️ Baarish '+ri.prob.toFixed(0)+'% — next irrigation rok sakte ho.');
  return L.join('\n');
}

function budgetResponse(d,fv){
  if(!d) return '📡 Sensor data nahi hai.';
  var L=['💰 **Water Budget**\n'];
  L.push('Seasonal Required: '+fv(d.deltaRequired).toFixed(1)+' L');
  L.push('Irrigation applied: '+fv(d.deltaApplied).toFixed(1)+' L');
  L.push('Rainfall contribution: '+fv(d.rainfallContrib).toFixed(1)+' L');
  L.push('Balance remaining: '+fv(d.deltaBalance).toFixed(1)+' L');
  L.push('Flow total: '+fv(d.totalLitres).toFixed(1)+' L');
  L.push('');
  var bal=fv(d.deltaBalance);
  if(bal<0)        L.push('🔴 Budget khatam! Zyada paani lag gaya.');
  else if(bal<200) L.push('🟡 Budget kam bacha — '+bal.toFixed(0)+' L only.');
  else             L.push('🟢 Budget theek — '+bal.toFixed(0)+' L bacha hai.');
  return L.join('\n');
}

function cropResponse(d,fv,soilCond){
  if(!d) return '📡 Sensor data nahi hai.';
  var sc=soilCond();
  var L=['🌾 **Fasal ki Jankari**\n'];
  L.push('Fasal: '+(d.crop||'Set nahi'));
  L.push('Stage: '+(d.stage||'--'));
  L.push('GDD: '+fv(d.gdd).toFixed(0)+' °C·day');
  L.push('Area: '+fv(d.plotArea_m2).toFixed(1)+' m² ('+fv(d.plotArea_bigha).toFixed(4)+' Bigha)');
  L.push('ETo: '+fv(d.eto).toFixed(2)+' mm/day');
  L.push('');
  var csmi=fv(d.csmi), cropL=(d.crop||'').toLowerCase();
  if(cropL.indexOf('wheat')!==-1||cropL.indexOf('gehun')!==-1){
    L.push('🌾 Gehun optimal CSMI: 40-65%');
    if(csmi<40) L.push('⚠️ Dry — Gehun ko paani chahiye!');
    else if(csmi>70) L.push('⚠️ Wet — root rot ho sakti hai');
    else L.push('✅ Mitti gehun ke liye perfect!');
  } else if(cropL.indexOf('rice')!==-1||cropL.indexOf('paddy')!==-1){
    L.push('🌾 Paddy optimal CSMI: 60-80%');
    if(csmi<60) L.push('⚠️ Paddy ko zyada paani chahiye!');
    else L.push('✅ Paddy ke liye theek hai');
  } else {
    if(csmi<35) L.push('⚠️ Dry — fasal ko paani chahiye');
    else if(csmi>75) L.push('⚠️ Wet — drainage check karo');
    else L.push('✅ Mitti achi condition mein hai');
  }
  return L.join('\n');
}

function aiScoreResponse(d,fv){
  if(!d) return '📡 Sensor data nahi hai.';
  var L=['🤖 **AI Score Analysis**\n'];
  L.push('Score: '+fv(d.aiScore).toFixed(1)+' / 120');
  L.push('Threshold: 65 → '+(fv(d.aiScore)>=65?'✅ ABOVE — Irrigation eligible':'❌ BELOW — Nahi'));
  L.push('');
  L.push('Components:');
  L.push('• CSMI: '+fv(d.csmi).toFixed(1)+'%');
  L.push('• SMV (velocity): '+fv(d.smv).toFixed(4)+' %/hr');
  L.push('• SMA (accel): '+fv(d.sma).toFixed(4)+' %/hr²');
  L.push('• TPR pattern: '+fv(d.tprScore).toFixed(3)+(fv(d.tprScore)>=0.85?' ✅':' —'));
  L.push('• Rain Prob: '+fv(d.rainProb).toFixed(0)+'%');
  L.push('• ETo: '+fv(d.eto).toFixed(2)+' mm/day');
  L.push('');
  if(fv(d.aiScore)<65) L.push('💡 Mitti aur dry hogi toh score badhega.');
  else L.push('💡 High score — pump trigger hone wala hai!');
  return L.join('\n');
}

function analysisResponse(d,fv,owm,soilCond,rainI,sensorAllOk){
  if(!d) return '📡 Sensor data nahi hai — hardware aur Firebase check karo.';
  var sc=soilCond(), ri=rainI();
  var L=['📊 **Full Farm Status**\n'];
  L.push('🌾 '+(d.crop||'--')+' | Stage: '+(d.stage||'--')+' | GDD: '+fv(d.gdd).toFixed(0));
  L.push('📐 Area: '+fv(d.plotArea_m2).toFixed(1)+' m²\n');
  L.push('🌱 Mitti: '+(sc?sc.level:'--')+' — CSMI '+fv(d.csmi).toFixed(1)+'%');
  L.push('  SM1: '+fv(d.sm1).toFixed(1)+'% | SM2: '+fv(d.sm2).toFixed(1)+'% | SM3: '+fv(d.sm3).toFixed(1)+'%\n');
  L.push('🤖 AI Score: '+fv(d.aiScore).toFixed(1)+'/120 → '+(fv(d.aiScore)>=65?'Irrigation eligible':'Nahi'));
  L.push('🔌 Pump: '+(d.pump?'🟢 ON':'🔴 OFF')+' | '+(d.autoMode?'Auto':'Manual')+'\n');
  L.push('🌧️ Rain: '+ri.prob.toFixed(0)+'% | '+ri.mm.toFixed(2)+' mm');
  if(owm) L.push('🌡️ '+(owm.owm_temp!==null?owm.owm_temp.toFixed(1)+'°C':'--')+' | '+(owm.owm_humidity!==null?owm.owm_humidity.toFixed(0)+'%':'--')+'\n');
  L.push('📡 '+(d.offlineMode?'🔴 Offline':'🟢 Online'));
  L.push('🔧 Sensors: '+(sensorAllOk()?'✅ Sab theek':'⚠️ Issues hain'));
  L.push('💰 Budget: '+fv(d.deltaBalance).toFixed(1)+' L remaining\n');
  L.push('💡 **Recommendation:**');
  if(d.pipelineFault)           L.push('• 🔴 Pipeline fault — turant check karo!');
  if(d.safeMode)                L.push('• 🔴 Safe mode — soil sensors fix karo!');
  if(ri.prob>60)                L.push('• 🌧️ Baarish aane wali — sinchai mat karo.');
  else if(sc&&fv(d.csmi)<20)    L.push('• 🚨 Turant sinchai karo — bahut dry!');
  else if(sc&&fv(d.csmi)<35)    L.push('• ⚠️ Sinchai ki zaroorat hai.');
  else if(sc&&fv(d.csmi)>75)    L.push('• 💦 Mat karo — bahut wet.');
  else                          L.push('• ✅ Sab theek — koi action nahi chahiye.');
  return L.join('\n');
}

function weatherResponse(d,fv,owm,locName){
  var L=['🌡️ **Maasam ki Jankari**\n'];
  try{ L.push('📍 '+locName()); }catch(e){}
  if(d){
    L.push('');
    L.push('📡 Local Sensors:');
    if(!d.dhtFallback){
      L.push('• Temp (DHT22): '+fv(d.temperature).toFixed(1)+'°C');
      L.push('• Humidity: '+fv(d.humidity).toFixed(0)+'%');
    } else {
      L.push('• ⚠️ DHT22 fault — OWM fallback active');
    }
    if(!d.bmpFallback){
      L.push('• Pressure (BMP280): '+fv(d.pressure).toFixed(1)+' hPa');
    } else {
      L.push('• ⚠️ BMP280 fault — OWM fallback active');
    }
    L.push('• ETo: '+fv(d.eto).toFixed(2)+' mm/day');
  }
  if(owm){
    L.push('');
    L.push('☁️ OWM Cloud ('+locName()+'):');
    L.push('• Temp: '+(owm.owm_temp!==null?owm.owm_temp.toFixed(1)+'°C':'--'));
    L.push('• Humidity: '+(owm.owm_humidity!==null?owm.owm_humidity.toFixed(0)+'%':'--'));
    L.push('• Pressure: '+(owm.owm_pressure!==null?owm.owm_pressure.toFixed(1)+' hPa':'--'));
    L.push('• Rain 1hr: '+(owm.owm_rain_mm>0?owm.owm_rain_mm.toFixed(2)+' mm':'No rain'));
  }
  if(!d&&!owm) L.push('Data abhi available nahi — hardware check karo.');
  if(d){
    L.push('');
    var t=fv(d.temperature);
    if(t>40)      L.push('🔥 Bahut zyada garmi — evaporation high, zyada sinchai chahiye!');
    else if(t>32) L.push('☀️ Garmi zyada — ETo badha hua hai, sinchai ka dhyan rakho.');
    else if(t<10) L.push('🥶 Thand — evaporation kam, sinchai ki zaroorat kam.');
    else          L.push('✅ Temperature optimal range mein hai.');
  }
  return L.join('\n');
}

function healthCheckResponse(d,fv,owm,soilCond,rainI,sensorAllOk){
  if(!d) return '📡 Sensor data nahi — hardware check karo.';
  var sc=soilCond(), ri=rainI();
  var issues=[];
  if(d.pipelineFault)  issues.push('🔴 Pipeline fault detected!');
  if(d.safeMode)       issues.push('🔴 Safe mode — soil sensors fail');
  if(d.dhtFallback)    issues.push('🟡 DHT22 fault — OWM fallback');
  if(d.bmpFallback)    issues.push('🟡 BMP280 fault — OWM fallback');
  if(d.offlineMode)    issues.push('🟡 Offline mode — autonomous');
  if(fv(d.deltaBalance)<0) issues.push('🔴 Water budget exceed!');
  var L=['🏥 **System Health Check**\n'];
  if(issues.length===0){
    L.push('✅ **Sab kuch bilkul theek hai!**\n');
    L.push('• Sensors: ✅ All OK');
    L.push('• Firebase: ✅ Online');
    L.push('• Pump: '+(d.pump?'🟢 ON':'⚪ OFF (standby)'));
    L.push('• Mitti: '+(sc?sc.level:'--')+' ('+fv(d.csmi).toFixed(1)+'%)');
    L.push('• Budget: '+fv(d.deltaBalance).toFixed(1)+' L remaining');
    L.push('• Rain: '+ri.prob.toFixed(0)+'% probability');
    L.push('• AI Score: '+fv(d.aiScore).toFixed(1)+'/120');
    L.push('\n🎉 System perfectly chal raha hai!');
  } else {
    L.push('⚠️ **Kuch issues hain:**\n');
    issues.forEach(function(i){ L.push(i); });
    L.push('\n📊 Current status:');
    L.push('• Mitti: '+(sc?sc.level:'--')+' ('+fv(d.csmi).toFixed(1)+'%)');
    L.push('• AI Score: '+fv(d.aiScore).toFixed(1)+'/120');
    L.push('• Budget: '+fv(d.deltaBalance).toFixed(1)+' L');
    L.push('• Pump: '+(d.pump?'🟢 ON':'🔴 OFF'));
  }
  return L.join('\n');
}

function systemDiagResponse(d,fv,owm,sensorAllOk){
  var L=['🔍 **System Diagnosis**\n'];
  if(!d){
    L.push('❌ Koi data nahi aa raha.\n');
    L.push('Check karo:');
    L.push('1. ESP8266/Arduino power on hai?');
    L.push('2. WiFi connected hai?');
    L.push('3. Firebase config sahi hai?');
    L.push('4. GitHub Pages URL sahi hai?');
    L.push('5. Browser console mein error hai?');
    return L.join('\n');
  }
  L.push('Firebase: '+(d.offlineMode?'🔴 Offline':'🟢 OK'));
  L.push('Sensors: '+(sensorAllOk()?'✅ OK':'⚠️ Issues'));
  L.push('Pump: '+(d.pipelineFault?'🔴 Fault':(d.pump?'🟢 ON':'⚪ Standby')));
  L.push('OWM: '+(owm&&owm.owm_valid?'🟢 Live':'🔴 Offline'));
  L.push('');
  L.push('💡 Commonly fix hoti hain:');
  L.push('• Page refresh karo (F5)');
  L.push('• Logout → Login karo');
  L.push('• Internet connection check karo');
  L.push('• Hardware restart karo');
  return L.join('\n');
}

function helpResponse(){
  return '🤖 **Main kya samajh sakta hoon:**\n\n'+
    '🔌 **Pump** — "pump nahi chal raha", "motor band"\n'+
    '🌧️ **Baarish** — "aaj baarish hogi", "rain probability"\n'+
    '🌱 **Mitti** — "soil dry hai", "mitti kaisi hai"\n'+
    '💧 **Kitna paani** — "kitna paani lagega", "paani kitna chahiye"\n'+
    '🔧 **Sensor** — "sensor kharab", "DHT22 error"\n'+
    '📡 **Internet** — "firebase offline", "net nahi"\n'+
    '💰 **Budget** — "kitna paani bacha", "balance"\n'+
    '✅ **Sinchai karni?** — "karo ya nahi", "karna chahiye"\n'+
    '📋 **Complete** — "sinchai ho gayi kitna bacha"\n'+
    '🌾 **Fasal** — "wheat ke liye", "crop stage"\n'+
    '🤖 **Score** — "AI score kya hai", "threshold"\n'+
    '📊 **Full report** — "sab kuch batao", "overview"\n'+
    '✅ **Health** — "sab theek hai", "everything ok"\n'+
    '🌡️ **Weather** — "temperature kitna", "garmi kitni"\n'+
    '🔍 **System** — "kuch nahi chal raha", "system down"\n\n'+
    'Hindi, English ya Hinglish — sab samajh aata hai! 😊';
}

function defaultResponse(q2){
  return '🤔 Yeh samajh nahi aaya: "'+q2.substring(0,50)+'"\n\n'+
    'Kuch aisa puchho:\n'+
    '• "Pump shuru nahi ho raha"\n'+
    '• "Aaj baarish hogi kya"\n'+
    '• "Kitna paani lagega"\n'+
    '• "Sab theek hai kya"\n'+
    '• "Sinchai ho gayi kitna bacha"\n'+
    '• "Temperature kitna hai"\n\n'+
    '"help" type karo sabhi options ke liye!';
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
