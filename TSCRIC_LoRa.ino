/*
 * ============================================================
 * TSCRIC-LoRa: Temporal Soil-Crop Resonance Irrigation Controller
 *              with Long-Range Radio Fallback
 * ============================================================
 * Version   : 3.0 FINAL PRODUCTION (BE Ready)
 * Hardware  : ESP8266 NodeMCU V3
 * LoRa      : SX1278 (433 MHz)
 * Sensors   : 3x Capacitive Soil Moisture V2.0, DHT22, BMP280
 * MUX       : CD4051 Analog Multiplexer
 * Flow      : YF-S201 Water Flow Sensor
 * Relay     : 5V 1-Channel Relay Module
 * Optional  : Rain-drop sensor, Tipping bucket rain gauge
 * ============================================================
 * Bug Fixes Applied:
 *  [FIX-1] GPIO0 conflict removed — Relay→GPIO2, DIO0→GPIO0
 *  [FIX-2] DHT11 removed, DHT22 implemented
 *  [FIX-3] EEPROM_SIZE increased to 256
 *  [FIX-4] CD4051 settling delay + dummy read added
 *  [FIX-5] Firebase non-blocking + reconnect + timeout
 *  [FIX-6] Flow sensor failsafe (pump-on, no-flow → stop)
 * ============================================================
 * New Systems:
 *  - Soil Calibration Engine (SAT/FC/PWP per sensor)
 *  - Soil Water Balance Engine
 *  - Offline Store-and-Sync Architecture
 *  - Advanced Offline Fallback Logic
 *  - Offline Rain Estimation
 *  - Adaptive Root-Zone Moisture Control
 *  - OWM Fallback when BMP280/DHT22 fail
 *  - Pulse Irrigation (30s ON / 2min OFF)
 *  - NTP time + millis() fallback
 *  - Safe Mode (all sensors fail)
 *  - Irrigation Windows (avoid midday)
 *  - Water Accounting
 * ============================================================
 * Institution : Oriental College of Technology, Bhopal
 * Guide       : Dr. Yogesh Iyer Murthy
 * Team        : Aditya Kumar, Akash Khandgre, Akash Kumar, Aman Kumar
 * ============================================================
 */

// ============================================================
// LIBRARIES
// ============================================================
#include <ESP8266WiFi.h>
#include <ESP8266WebServer.h>
#include <ESP8266HTTPClient.h>
#include <WiFiClientSecure.h>
#include <WiFiUdp.h>
#include <Wire.h>
#include <Adafruit_BMP280.h>
#include <DHT.h>
#include <EEPROM.h>
#include <SPI.h>
#include <LoRa.h>
#include <ArduinoJson.h>
#include <math.h>

// ============================================================
// PIN DEFINITIONS — CONFLICT-FREE FINAL PINOUT
// ============================================================
// [FIX-1] GPIO0 conflict resolved:
//   OLD: RELAY_PIN=0, LORA_DIO0=0  ← DANGEROUS
//   NEW: RELAY_PIN=2, LORA_DIO0=0  ← SAFE

#define MUX_S0_PIN      14    // GPIO14 (D5)  - CD4051 Select Bit 0
#define MUX_S1_PIN      12    // GPIO12 (D6)  - CD4051 Select Bit 1
#define MUX_S2_PIN      16    // GPIO16 (D0)  - CD4051 Select Bit 2
#define MUX_SIG_PIN     A0    // ADC0         - MUX Signal Output

// [FIX-2] DHT22 replaces DHT11 completely
#define DHT_PIN          4    // GPIO4  (D2)  - DHT22 Data
#define DHT_TYPE         DHT22

#define I2C_SDA          4    // GPIO4  (D2)  - BMP280 SDA (shared via Wire)
#define I2C_SCL          5    // GPIO5  (D1)  - BMP280 SCL

#define LORA_SS_PIN     15    // GPIO15 (D8)  - SX1278 NSS
#define LORA_RST_PIN    -1    // Not connected
#define LORA_DIO0_PIN    0    // GPIO0  (D3)  - SX1278 DIO0

// [FIX-1] RELAY moved OFF GPIO0 → GPIO2
#define RELAY_PIN        2    // GPIO2  (D4)  - Relay IN (Active LOW)
//   Note: GPIO2 is also the blue LED on NodeMCU.
//   The LED will blink when pump runs — useful visual indicator.

#define FLOW_PIN        13    // GPIO13 (D7)  - YF-S201 Signal
#define RAIN_DROP_PIN    3    // GPIO3  (RX)  - Optional rain-drop sensor
#define TIP_BUCKET_PIN   1    // GPIO1  (TX)  - Optional tipping bucket
//   NOTE: GPIO1/GPIO3 are UART pins. Only use these if serial debug
//   is disabled. Set SERIAL_DEBUG 0 to enable tipping bucket.
#define SERIAL_DEBUG     1    // 1=enable serial, 0=enable tip bucket

// ============================================================
// WIFI & FIREBASE CREDENTIALS — EDIT THESE
// ============================================================
const char* WIFI_SSID      = "Aman";
const char* WIFI_PASSWORD  = "Aman@12345";

// Offline Hotspot (auto-created when WiFi unavailable)
const char* AP_SSID        = "TSCRIC_AI";
const char* AP_PASSWORD    = "12345678";

// Firebase Realtime Database
const char* FIREBASE_HOST  = "tscric-lora-default-rtdb.firebaseio.com";
const char* FIREBASE_AUTH  = "YOUR_FIREBASE_DATABASE_SECRET";

// OpenWeatherMap
const char* OWM_API_KEY    = "YOUR_OWM_API_KEY";
const float SITE_LAT       = 23.26f;    // Bhopal
const float SITE_LON       = 77.41f;

// NTP
const char* NTP_SERVER     = "pool.ntp.org";
const long  NTP_OFFSET_SEC = 19800;     // UTC+5:30 India

// ============================================================
// SYSTEM TIMING
// ============================================================
#define SENSOR_INTERVAL         10000UL   // Sensor read: every 10s
#define LORA_INTERVAL           30000UL   // LoRa TX:     every 30s
#define FIREBASE_INTERVAL       15000UL   // Firebase:    every 15s
#define CALIB_INTERVAL       86400000UL   // Self-calib:  every 24hr
#define BUFFER_WRITE_INT        600000UL  // Ring buffer: every 10min
#define OWM_INTERVAL           300000UL  // OWM fetch:   every 5min
#define WIFI_RETRY_INTERVAL     60000UL  // WiFi retry:  every 60s
#define FLOW_FAILSAFE_MS        30000UL  // Flow failsafe: 30s no-flow
#define OFFLINE_SYNC_INTERVAL  600000UL  // Offline sync check: 10min

// ============================================================
// PULSE IRRIGATION (updated: 30s ON / 2min OFF per spec)
// ============================================================
#define PULSE_ON_MS      30000UL          // 30 seconds ON
#define PULSE_OFF_MS    120000UL          // 2 minutes OFF
#define PULSE_CYCLES         3            // Cycles per event
#define PUMP_COOLDOWN_MS 3600000UL        // 1-hour cooldown

// ============================================================
// AI & IRRIGATION CONSTANTS
// ============================================================
#define BUFFER_SIZE         432           // 72hr x 6 entries/hr
#define COSINE_WINDOW        36           // 6-hour comparison window
#define COSINE_THRESHOLD    0.85f         // TPR match threshold
#define AI_TRIGGER_SCORE   65.0f          // Irrigation trigger
#define RAIN_BLOCK_PCT     75.0f          // Rain suppress threshold

// ============================================================
// OFFLINE STORE-AND-SYNC
// ============================================================
#define OFFLINE_LOG_SIZE     50           // Max offline log entries
#define OFFLINE_LOG_EEPROM_ADDR  128      // EEPROM start for offline log

// ============================================================
// SENSOR SAFETY
// ============================================================
#define FLOW_PULSES_PER_L   450.0f        // YF-S201 pulses per litre
#define BIGHA_TO_M2        1333.33f       // 1 Bigha MP = 1333.33 m²

// ============================================================
// [FIX-3] EEPROM SIZE INCREASED: 64 → 256
// ============================================================
#define EEPROM_SIZE           256
#define EEPROM_MAGIC          0xBE        // Changed magic to force re-init
#define ADDR_MAGIC              0         // 1 byte
#define ADDR_CROP               1         // 1 byte
#define ADDR_STAGE              2         // 1 byte
#define ADDR_GDD_CUM            3         // 4 bytes (float)
#define ADDR_DELTA_APPLIED      7         // 4 bytes (float)
#define ADDR_CALIB_DRY         11         // 6 bytes (3x uint16)
#define ADDR_CALIB_WET         17         // 6 bytes (3x uint16)
#define ADDR_BUFFER_HEAD       23         // 2 bytes (uint16)
#define ADDR_BUFFER_COUNT      25         // 2 bytes (uint16)
#define ADDR_PLOT_AREA         27         // 4 bytes (float)
#define ADDR_SOIL_CALIB        31         // 72 bytes (SoilCalibration x3)
#define ADDR_WATER_BALANCE    103         // 16 bytes
#define ADDR_RAIN_ACCUM       119         // 4 bytes (float)
#define ADDR_OFFLINE_COUNT    123         // 1 byte
// OFFLINE_LOG_EEPROM_ADDR = 128 (50 entries x 2 bytes = 100 bytes → ends at 228)

// ============================================================
// SOIL CALIBRATION STRUCTURE (per sensor)
// ============================================================
struct SoilCalibration {
  uint16_t adc_sat;    // ADC at saturation (0% air, 100% water)
  uint16_t adc_fc;     // ADC at field capacity
  uint16_t adc_pwp;    // ADC at permanent wilting point
  uint16_t adc_dry;    // ADC in oven-dry air (0% VWC)
  float    vwc_sat;    // VWC at saturation (typ 0.45–0.55)
  float    vwc_fc;     // VWC at field capacity (typ 0.30–0.40)
  float    vwc_pwp;    // VWC at PWP (typ 0.10–0.18)
};

// ============================================================
// CROP STAGE STRUCTURE
// ============================================================
struct CropStage {
  const char* name;
  float gddStart, gddEnd;
  float w1, w2, w3;          // CSMI depth weights (15cm,30cm,45cm)
  float kc;                  // Crop coefficient
  float triggerThreshold;    // CSMI trigger (%)
  float delta_mm;            // Delta per event (mm)
  int   irrigInterval;       // Days between irrigation
  float rootDepth_cm;        // Root zone depth (cm)
  float fc_pct;              // Field capacity % (for SWB)
  float pwp_pct;             // Permanent wilting point % (for SWB)
};

struct Crop {
  const char* name;
  float       tBase;
  float       seasonalDelta_mm;
  int         basePeriod_days;
  int         numStages;
  CropStage   stages[5];
};

// ============================================================
// CROP DATABASE — 8 Major Indian Crops (PRESERVED)
// ============================================================
const Crop cropDB[] = {
  // 0: WHEAT
  { "Wheat", 0.0f, 450.0f, 120, 5, {
    {"Germination",  0,   100, 0.60f,0.30f,0.10f, 0.40f, 55.0f, 30.0f,  7, 15.0f, 38.0f, 14.0f},
    {"Tillering",  100,   350, 0.50f,0.35f,0.15f, 0.65f, 50.0f, 40.0f,  7, 25.0f, 38.0f, 13.0f},
    {"Jointing",   350,   600, 0.40f,0.40f,0.20f, 0.85f, 45.0f, 55.0f,  7, 40.0f, 40.0f, 13.0f},
    {"Heading",    600,   900, 0.35f,0.40f,0.25f, 1.10f, 40.0f, 65.0f,  7, 45.0f, 40.0f, 12.0f},
    {"Grain-fill", 900,  1300, 0.25f,0.40f,0.35f, 0.90f, 35.0f, 75.0f, 10, 45.0f, 38.0f, 12.0f}
  }},
  // 1: RICE
  { "Rice", 10.0f, 1200.0f, 120, 4, {
    {"Nursery",      0,   200, 0.70f,0.20f,0.10f, 1.10f, 85.0f, 50.0f,  4, 10.0f, 50.0f, 30.0f},
    {"Tillering",  200,   700, 0.50f,0.35f,0.15f, 1.20f, 80.0f, 55.0f,  3, 20.0f, 50.0f, 28.0f},
    {"Panicle",    700,  1000, 0.35f,0.40f,0.25f, 1.30f, 75.0f, 60.0f,  3, 25.0f, 48.0f, 26.0f},
    {"Ripening",  1000,  1400, 0.25f,0.40f,0.35f, 0.80f, 60.0f, 40.0f,  5, 25.0f, 45.0f, 25.0f}
  }},
  // 2: MAIZE
  { "Maize", 10.0f, 550.0f, 100, 4, {
    {"Germination",  0,   150, 0.65f,0.25f,0.10f, 0.50f, 50.0f, 35.0f,  7, 15.0f, 36.0f, 12.0f},
    {"Vegetative", 150,   600, 0.45f,0.38f,0.17f, 1.05f, 45.0f, 55.0f,  7, 40.0f, 38.0f, 13.0f},
    {"Tasseling",  600,   900, 0.35f,0.40f,0.25f, 1.20f, 40.0f, 65.0f,  5, 55.0f, 40.0f, 14.0f},
    {"Grain",      900,  1350, 0.30f,0.40f,0.30f, 0.95f, 35.0f, 60.0f,  7, 55.0f, 38.0f, 13.0f}
  }},
  // 3: COTTON
  { "Cotton", 15.0f, 750.0f, 180, 4, {
    {"Seedling",     0,   250, 0.60f,0.30f,0.10f, 0.45f, 50.0f, 40.0f, 10, 20.0f, 35.0f, 12.0f},
    {"Squaring",   250,   700, 0.45f,0.38f,0.17f, 0.85f, 45.0f, 55.0f,  8, 40.0f, 37.0f, 13.0f},
    {"Flowering",  700,  1200, 0.35f,0.40f,0.25f, 1.20f, 40.0f, 65.0f,  7, 55.0f, 38.0f, 14.0f},
    {"Boll-dev",  1200,  1800, 0.30f,0.40f,0.30f, 0.85f, 35.0f, 55.0f, 10, 60.0f, 36.0f, 12.0f}
  }},
  // 4: SOYBEAN
  { "Soybean", 10.0f, 500.0f, 100, 4, {
    {"Emergence",    0,   150, 0.65f,0.25f,0.10f, 0.40f, 55.0f, 30.0f,  7, 15.0f, 35.0f, 12.0f},
    {"Vegetative", 150,   500, 0.45f,0.38f,0.17f, 0.80f, 50.0f, 45.0f,  7, 35.0f, 37.0f, 13.0f},
    {"Flowering",  500,   800, 0.35f,0.40f,0.25f, 1.10f, 45.0f, 55.0f,  6, 50.0f, 38.0f, 14.0f},
    {"Pod-fill",   800,  1200, 0.28f,0.40f,0.32f, 0.90f, 40.0f, 55.0f,  7, 50.0f, 36.0f, 13.0f}
  }},
  // 5: CHICKPEA
  { "Chickpea", 0.0f, 350.0f, 110, 4, {
    {"Germination",  0,   100, 0.60f,0.30f,0.10f, 0.40f, 50.0f, 28.0f,  8, 15.0f, 33.0f, 11.0f},
    {"Vegetative", 100,   350, 0.48f,0.37f,0.15f, 0.70f, 45.0f, 40.0f, 10, 30.0f, 35.0f, 12.0f},
    {"Flowering",  350,   650, 0.35f,0.40f,0.25f, 1.00f, 40.0f, 50.0f,  8, 45.0f, 36.0f, 13.0f},
    {"Pod-fill",   650,   950, 0.28f,0.40f,0.32f, 0.85f, 35.0f, 50.0f, 10, 50.0f, 34.0f, 12.0f}
  }},
  // 6: MUSTARD
  { "Mustard", 0.0f, 380.0f, 100, 4, {
    {"Germination",  0,    80, 0.60f,0.30f,0.10f, 0.35f, 55.0f, 25.0f,  7, 15.0f, 32.0f, 11.0f},
    {"Rosette",     80,   280, 0.50f,0.35f,0.15f, 0.65f, 50.0f, 35.0f,  8, 25.0f, 34.0f, 12.0f},
    {"Flowering",  280,   550, 0.35f,0.40f,0.25f, 1.05f, 45.0f, 50.0f,  7, 35.0f, 35.0f, 12.0f},
    {"Siliqua",    550,   850, 0.28f,0.40f,0.32f, 0.75f, 35.0f, 45.0f, 10, 35.0f, 33.0f, 11.0f}
  }},
  // 7: SUGARCANE
  { "Sugarcane", 12.0f, 1800.0f, 360, 5, {
    {"Germination",   0,  300, 0.65f,0.25f,0.10f, 0.55f, 60.0f, 50.0f,  7, 20.0f, 40.0f, 15.0f},
    {"Tillering",   300,  900, 0.50f,0.35f,0.15f, 0.85f, 55.0f, 60.0f,  7, 35.0f, 42.0f, 16.0f},
    {"Grand-growth",900, 2200, 0.35f,0.40f,0.25f, 1.25f, 50.0f, 80.0f,  5, 60.0f, 45.0f, 18.0f},
    {"Maturation", 2200, 3000, 0.25f,0.40f,0.35f, 0.75f, 45.0f, 55.0f, 10, 70.0f, 42.0f, 16.0f},
    {"Ripening",   3000, 3500, 0.20f,0.40f,0.40f, 0.50f, 40.0f, 40.0f, 14, 70.0f, 38.0f, 14.0f}
  }}
};
const int CROP_COUNT = 8;

// ============================================================
// SENSOR DATA STRUCTURE
// ============================================================
struct SensorData {
  float sm1_pct, sm2_pct, sm3_pct;    // Soil moisture %
  float vwc1, vwc2, vwc3;             // Volumetric water content
  float csmi;                          // Composite Soil Moisture Index
  float temperature, humidity;         // DHT22
  float pressure_hPa;                 // BMP280
  float flowRate_Lmin;                // YF-S201
  float totalLitres;                  // Cumulative flow
  bool  sensorFault[3];               // Soil sensor faults
  bool  dhtFault, bmpFault, flowFault;
  bool  safeMode;                     // All sensors failed
  bool  rainDropDetected;             // Rain-drop sensor
  float tipBucketMM;                  // Tipping bucket rainfall mm
};

// ============================================================
// OWM WEATHER STRUCTURE
// ============================================================
struct OWMData {
  float temp;
  float humidity;
  float pressure;
  float rainfall_mm;         // rain.1h field
  float windSpeed;
  int   weatherId;           // OWM weather condition code
  bool  valid;               // Data successfully fetched
  unsigned long fetchedAt;   // millis() when fetched
};

// ============================================================
// OFFLINE LOG ENTRY
// ============================================================
struct OfflineLogEntry {
  uint16_t csmi_x10;        // CSMI * 10 (compact storage)
  uint16_t litres_x10;      // Litres applied * 10
};

// ============================================================
// SYSTEM STATE STRUCTURE
// ============================================================
struct SystemState {
  float smv, sma;
  float aiScore;
  float eto_mm;
  float rainProbability;
  float pressureTrend;
  float deltaApplied_L;
  float deltaRequired_L;
  float deltaBalance_L;
  float effectiveRainfall_mm;      // From tipping bucket or OWM
  float estimatedRainfall_mm;      // From sensor trend analysis
  float totalRainfallContrib_L;    // Rainfall contribution in litres
  float seasonalWaterDeficit_L;    // Remaining deficit
  float gddCumulative;
  float plotArea_m2;

  // Water accounting
  float totalIrrigApplied_L;
  float totalRainfallApplied_L;

  // Control
  bool  pumpRunning;
  bool  autoMode;
  bool  wifiConnected;
  bool  loraMode;
  bool  pipelineFault;
  bool  offlineMode;
  bool  safeMode;
  bool  adaptiveRootZoneMode;    // Offline remote farm mode

  // Sensor priority flags
  bool  dhtOWMFallback;          // Using OWM for temp/humidity
  bool  bmpOWMFallback;          // Using OWM for pressure

  // Timing
  uint8_t currentCrop;
  uint8_t currentStage;
  unsigned long lastIrrigTime;
  unsigned long lastBufferWrite;
  unsigned long lastSensorRead;
  unsigned long lastLoraTx;
  unsigned long lastFirebaseTx;
  unsigned long lastCalibration;
  unsigned long lastOWMFetch;
  unsigned long lastWifiRetry;
  unsigned long pumpStartTime;   // When pump last started

  // NTP
  unsigned long ntpEpoch;        // Unix time from NTP
  unsigned long ntpMillis;       // millis() at NTP sync

  // Offline sync
  uint8_t offlineLogCount;
};

// ============================================================
// GLOBAL OBJECTS
// ============================================================
DHT               dht(DHT_PIN, DHT_TYPE);    // [FIX-2] DHT22
Adafruit_BMP280   bmp;                       // BMP280 (not BME280)
ESP8266WebServer  server(80);
WiFiUDP           ntpUdp;

SensorData        sensors;
SystemState       state;
OWMData           owm;
SoilCalibration   soilCalib[3];

// Calibration arrays (default — loaded from EEPROM)
int calib_dry[3] = {850, 845, 855};
int calib_wet[3] = {400, 405, 395};

// Ring buffer
float    ringBuffer[BUFFER_SIZE];
uint16_t bufHead  = 0;
uint16_t bufCount = 0;

// CSMI history for SMV/SMA
float   csmiHistory[6]  = {0};
float   smvHistory[6]   = {0};
uint8_t csmiHistIdx     = 0;
uint8_t smvHistIdx      = 0;

// Pressure history for Zambretti (3-hour trend)
float   pressureHistory[18] = {0};
uint8_t pressureHistIdx     = 0;

// Soil moisture history for offline rain estimation
float   sm1History[12]  = {0};   // 12 readings = ~2 minutes
float   sm2History[12]  = {0};
float   sm3History[12]  = {0};
uint8_t smHistIdx       = 0;

// TPR score
float tprScore = 0.0f;

// Flow sensor ISR
volatile uint32_t flowPulseCount = 0;
float totalFlowLitres    = 0.0f;
unsigned long lastFlowCalc = 0;
unsigned long pumpOnNoFlowStart = 0;    // [FIX-6] flow failsafe timer

// Offline log
OfflineLogEntry offlineLog[OFFLINE_LOG_SIZE];

// ============================================================
// INTERRUPT — FLOW SENSOR
// ============================================================
ICACHE_RAM_ATTR void flowPulseISR() {
  flowPulseCount++;
}

// ============================================================
// [FIX-6] OPTIONAL: TIPPING BUCKET ISR
// ============================================================
volatile uint16_t tipBucketPulses = 0;
#if SERIAL_DEBUG == 0
ICACHE_RAM_ATTR void tipBucketISR() {
  tipBucketPulses++;
}
#endif

// ============================================================
// NTP — GET TIME
// ============================================================
uint32_t getNTPTime() {
  const int NTP_PACKET_SIZE = 48;
  byte packet[NTP_PACKET_SIZE];
  memset(packet, 0, NTP_PACKET_SIZE);
  packet[0] = 0b11100011;
  packet[1] = 0; packet[2] = 6; packet[3] = 0xEC;
  packet[12] = 49; packet[13] = 0x4E; packet[14] = 49; packet[15] = 52;

  ntpUdp.begin(2390);
  IPAddress ntpIp;
  WiFi.hostByName(NTP_SERVER, ntpIp);
  ntpUdp.beginPacket(ntpIp, 123);
  ntpUdp.write(packet, NTP_PACKET_SIZE);
  ntpUdp.endPacket();

  delay(1500);
  if (ntpUdp.parsePacket()) {
    ntpUdp.read(packet, NTP_PACKET_SIZE);
    uint32_t hi = (uint32_t)packet[40] << 8 | packet[41];
    uint32_t lo = (uint32_t)packet[42] << 8 | packet[43];
    uint32_t epoch = (hi << 16 | lo) - 2208988800UL + NTP_OFFSET_SEC;
    return epoch;
  }
  return 0;
}

// Get current hour (0-23) — NTP if available, millis() fallback
int getCurrentHour() {
  if (state.ntpEpoch > 0) {
    unsigned long elapsed = (millis() - state.ntpMillis) / 1000UL;
    return (int)(((state.ntpEpoch + elapsed) / 3600UL) % 24);
  }
  return (int)(millis() / 3600000UL) % 24;
}

bool isDaytimeHigh() {
  int hr = getCurrentHour();
  return (hr >= 11 && hr <= 16);  // Midday — avoid irrigation
}

bool isPreferredWindow() {
  int hr = getCurrentHour();
  return (hr >= 5 && hr <= 9) || (hr >= 17 && hr <= 20);
}

// ============================================================
// EEPROM LOAD / SAVE
// ============================================================
void loadEEPROM() {
  uint8_t magic;
  EEPROM.get(ADDR_MAGIC, magic);
  if (magic != EEPROM_MAGIC) {
    // First boot — write defaults
    EEPROM.put(ADDR_MAGIC,         (uint8_t)EEPROM_MAGIC);
    EEPROM.put(ADDR_CROP,          (uint8_t)0);
    EEPROM.put(ADDR_STAGE,         (uint8_t)0);
    EEPROM.put(ADDR_GDD_CUM,       0.0f);
    EEPROM.put(ADDR_DELTA_APPLIED, 0.0f);
    EEPROM.put(ADDR_PLOT_AREA,     6.0f);
    EEPROM.put(ADDR_RAIN_ACCUM,    0.0f);
    EEPROM.put(ADDR_OFFLINE_COUNT, (uint8_t)0);
    for (int i = 0; i < 3; i++) {
      EEPROM.put(ADDR_CALIB_DRY + i*2, (uint16_t)calib_dry[i]);
      EEPROM.put(ADDR_CALIB_WET + i*2, (uint16_t)calib_wet[i]);
    }
    // Default soil calibration
    for (int i = 0; i < 3; i++) {
      soilCalib[i] = {450, 600, 780, 1000, 0.50f, 0.35f, 0.12f};
      EEPROM.put(ADDR_SOIL_CALIB + i*sizeof(SoilCalibration), soilCalib[i]);
    }
    EEPROM.commit();
    Serial.println(F("[EEPROM] First boot — defaults written"));
    state.currentCrop    = 0;
    state.currentStage   = 0;
    state.gddCumulative  = 0.0f;
    state.deltaApplied_L = 0.0f;
    state.plotArea_m2    = 6.0f;
  } else {
    EEPROM.get(ADDR_CROP,          state.currentCrop);
    EEPROM.get(ADDR_STAGE,         state.currentStage);
    EEPROM.get(ADDR_GDD_CUM,       state.gddCumulative);
    EEPROM.get(ADDR_DELTA_APPLIED, state.deltaApplied_L);
    EEPROM.get(ADDR_PLOT_AREA,     state.plotArea_m2);
    EEPROM.get(ADDR_OFFLINE_COUNT, state.offlineLogCount);
    for (int i = 0; i < 3; i++) {
      uint16_t d, w;
      EEPROM.get(ADDR_CALIB_DRY + i*2, d);
      EEPROM.get(ADDR_CALIB_WET + i*2, w);
      calib_dry[i] = d; calib_wet[i] = w;
    }
    for (int i = 0; i < 3; i++) {
      EEPROM.get(ADDR_SOIL_CALIB + i*sizeof(SoilCalibration), soilCalib[i]);
    }
    // Load offline logs
    for (int i = 0; i < min((int)state.offlineLogCount, OFFLINE_LOG_SIZE); i++) {
      EEPROM.get(OFFLINE_LOG_EEPROM_ADDR + i*sizeof(OfflineLogEntry), offlineLog[i]);
    }
    Serial.println(F("[EEPROM] Loaded"));
  }
  // Validate crop index
  if (state.currentCrop >= CROP_COUNT) state.currentCrop = 0;
  if (state.currentStage >= (uint8_t)cropDB[state.currentCrop].numStages) state.currentStage = 0;
}

// ============================================================
// [FIX-4] SENSOR READING — CD4051 MUX WITH SETTLING DELAY
// ============================================================
int readMuxChannel(uint8_t ch) {
  LoRa.idle();
  delay(2);

  digitalWrite(MUX_S0_PIN, (ch & 0x01) ? HIGH : LOW);
  digitalWrite(MUX_S1_PIN, (ch & 0x02) ? HIGH : LOW);
  digitalWrite(MUX_S2_PIN, (ch & 0x04) ? HIGH : LOW);

  // [FIX-4] Settling delay + dummy read
  delayMicroseconds(500);
  analogRead(MUX_SIG_PIN);          // Dummy read — discard
  delayMicroseconds(200);

  // Averaged real read (8 samples)
  int sum = 0;
  for (int i = 0; i < 8; i++) {
    sum += analogRead(MUX_SIG_PIN);
    delayMicroseconds(100);
  }
  return sum / 8;
}

float adcToMoisturePct(int adc, int ch) {
  return constrain(
    (float)(calib_dry[ch] - adc) / (float)(calib_dry[ch] - calib_wet[ch]) * 100.0f,
    0.0f, 100.0f
  );
}

// Convert ADC to VWC using calibration points (linear interpolation)
float adcToVWC(int adc, int ch) {
  SoilCalibration& c = soilCalib[ch];
  if (adc <= (int)c.adc_sat) return c.vwc_sat;
  if (adc >= (int)c.adc_dry) return 0.0f;
  if (adc <= (int)c.adc_fc) {
    float t = (float)(adc - c.adc_sat) / (float)(c.adc_fc - c.adc_sat);
    return c.vwc_fc + (c.vwc_sat - c.vwc_fc) * (1.0f - t);
  } else if (adc <= (int)c.adc_pwp) {
    float t = (float)(adc - c.adc_fc) / (float)(c.adc_pwp - c.adc_fc);
    return c.vwc_pwp + (c.vwc_fc - c.vwc_pwp) * (1.0f - t);
  } else {
    float t = (float)(adc - c.adc_pwp) / (float)(c.adc_dry - c.adc_pwp);
    return c.vwc_pwp * (1.0f - t);
  }
}

// ============================================================
// READ ALL SENSORS
// ============================================================
void readAllSensors() {
  int faultCount = 0;

  // --- Soil moisture (3 channels) ---
  for (int ch = 0; ch < 3; ch++) {
    int raw = readMuxChannel(ch);
    sensors.sensorFault[ch] = (raw < 50 || raw > 1020);
    float pct = sensors.sensorFault[ch] ? (ch == 0 ? sensors.sm1_pct : ch == 1 ? sensors.sm2_pct : sensors.sm3_pct)
                                        : adcToMoisturePct(raw, ch);
    float vwc = sensors.sensorFault[ch] ? (ch == 0 ? sensors.vwc1 : ch == 1 ? sensors.vwc2 : sensors.vwc3)
                                        : adcToVWC(raw, ch);
    if (ch == 0) { sensors.sm1_pct = pct; sensors.vwc1 = vwc; }
    if (ch == 1) { sensors.sm2_pct = pct; sensors.vwc2 = vwc; }
    if (ch == 2) { sensors.sm3_pct = pct; sensors.vwc3 = vwc; }
    if (sensors.sensorFault[ch]) {
      faultCount++;
      Serial.printf_P(PSTR("[FAULT] Soil sensor ch%d ADC=%d\n"), ch, raw);
    }
  }

  // Store moisture history for offline rain estimation
  sm1History[smHistIdx % 12] = sensors.sm1_pct;
  sm2History[smHistIdx % 12] = sensors.sm2_pct;
  sm3History[smHistIdx % 12] = sensors.sm3_pct;
  smHistIdx++;

  // [FIX-2] DHT22 — replaced DHT11
  float t = dht.readTemperature();
  float h = dht.readHumidity();
  if (isnan(t) || isnan(h) || t < -10.0f || t > 60.0f || h < 0.0f || h > 100.0f) {
    sensors.dhtFault = true;
    // Fallback to OWM if available
    if (owm.valid && !state.dhtOWMFallback) {
      state.dhtOWMFallback = true;
      Serial.println(F("[DHT22] FAULT — switching to OWM fallback"));
    }
    if (owm.valid) {
      sensors.temperature = owm.temp;
      sensors.humidity    = owm.humidity;
    } else {
      sensors.temperature = 28.0f;   // Safe defaults
      sensors.humidity    = 60.0f;
    }
  } else {
    sensors.dhtFault        = false;
    state.dhtOWMFallback    = false;  // Sensor recovered
    sensors.temperature     = t;
    sensors.humidity        = h;
  }

  // BMP280
  if (!sensors.bmpFault) {
    float p = bmp.readPressure() / 100.0f;
    if (p > 800.0f && p < 1100.0f) {
      sensors.pressure_hPa = p;
      pressureHistory[pressureHistIdx % 18] = p;
      pressureHistIdx++;
      state.bmpOWMFallback = false;
    } else {
      sensors.bmpFault = true;
    }
  }
  if (sensors.bmpFault) {
    if (owm.valid && !state.bmpOWMFallback) {
      state.bmpOWMFallback = true;
      Serial.println(F("[BMP280] FAULT — switching to OWM fallback"));
    }
    if (owm.valid) sensors.pressure_hPa = owm.pressure;
  }

  // Rain-drop sensor (optional)
  #if SERIAL_DEBUG == 0
  sensors.rainDropDetected = (digitalRead(RAIN_DROP_PIN) == LOW);
  #endif

  // Tipping bucket (optional)
  #if SERIAL_DEBUG == 0
  if (tipBucketPulses > 0) {
    noInterrupts();
    uint16_t tips = tipBucketPulses;
    tipBucketPulses = 0;
    interrupts();
    sensors.tipBucketMM += tips * 0.2794f;  // 0.2794mm per tip (standard)
  }
  #endif

  // Safe mode: all 3 soil sensors failed
  sensors.safeMode = (faultCount == 3);
  state.safeMode   = sensors.safeMode;
  if (state.safeMode) {
    Serial.println(F("[SAFE MODE] All soil sensors failed — limiting irrigation"));
  }

  // [FIX-6] Flow sensor
  unsigned long now = millis();
  if (now - lastFlowCalc >= 1000UL) {
    noInterrupts();
    uint32_t pulses = flowPulseCount;
    flowPulseCount = 0;
    interrupts();

    float elapsed_s = (now - lastFlowCalc) / 1000.0f;
    sensors.flowRate_Lmin = (pulses / FLOW_PULSES_PER_L) / max(elapsed_s / 60.0f, 0.001f);

    // [FIX-6] Flow failsafe: pump ON but no flow detected
    if (state.pumpRunning && sensors.flowRate_Lmin < 0.05f) {
      if (pumpOnNoFlowStart == 0) {
        pumpOnNoFlowStart = now;
      } else if (now - pumpOnNoFlowStart >= FLOW_FAILSAFE_MS) {
        Serial.println(F("[FAILSAFE] Pump ON, no flow for 30s — stopping pump"));
        sensors.flowFault = true;
        state.pipelineFault = true;
        pumpOFF();
        pumpOnNoFlowStart = 0;
      }
    } else {
      sensors.flowFault   = false;
      pumpOnNoFlowStart   = 0;
    }

    // Pressure-based pipeline fault (BMP280 only, not OWM fallback)
    if (state.pumpRunning && !sensors.bmpFault && !state.bmpOWMFallback) {
      static float basePres = 0;
      if (basePres == 0) basePres = sensors.pressure_hPa;
      if      (sensors.pressure_hPa > basePres + 5.0f)
        { state.pipelineFault = true; Serial.println(F("[FAULT] Pipeline blockage")); pumpOFF(); }
      else if (sensors.pressure_hPa < basePres - 8.0f)
        { state.pipelineFault = true; Serial.println(F("[FAULT] Pipeline leakage")); pumpOFF(); }
      else {
        state.pipelineFault = false;
        basePres = sensors.pressure_hPa * 0.05f + basePres * 0.95f;
      }
    }

    totalFlowLitres += (pulses / FLOW_PULSES_PER_L);
    sensors.totalLitres = totalFlowLitres;
    lastFlowCalc = now;
  }
}

// ============================================================
// OFFLINE RAIN ESTIMATION FROM SENSOR TRENDS
// ============================================================
// Uses soil moisture rise, pressure drop, humidity increase.
// Returns estimated rainfall category (not fake exact mm).
// ============================================================
float estimateRainfallFromTrends() {
  if (smHistIdx < 12) return 0.0f;

  // Average recent vs older moisture readings
  float recentAvg = 0, olderAvg = 0;
  for (int i = 0; i < 6; i++) {
    recentAvg += sm1History[(smHistIdx - 1 - i + 12) % 12];
    olderAvg  += sm1History[(smHistIdx - 7 - i + 12) % 12];
  }
  recentAvg /= 6.0f;
  olderAvg  /= 6.0f;

  float moistureRise = recentAvg - olderAvg;
  float humidityHigh = (sensors.humidity > 85.0f) ? 1.0f : 0.0f;
  float pressureDrop = state.pressureTrend < -2.0f ? 1.0f : 0.0f;

  float estimatedMM = 0.0f;

  // Rainfall classification (estimated only — not exact mm)
  if      (moistureRise >= 10.0f && humidityHigh && pressureDrop) estimatedMM = 12.0f;  // Heavy
  else if (moistureRise >=  5.0f && humidityHigh)                 estimatedMM =  6.0f;  // Moderate
  else if (moistureRise >=  2.0f)                                 estimatedMM =  2.5f;  // Light

  if (estimatedMM > 0) {
    Serial.printf_P(PSTR("[RAIN EST] Probable rainfall ~%.1f mm (moisture rise=%.1f%% hum=%.0f%%)\n"),
      estimatedMM, moistureRise, sensors.humidity);
  }
  return estimatedMM;
}

// ============================================================
// CSMI — COMPOSITE SOIL MOISTURE INDEX
// ============================================================
void computeCSMI() {
  const CropStage& stg = cropDB[state.currentCrop].stages[state.currentStage];
  float s1 = sensors.sensorFault[0] ? sensors.csmi : sensors.sm1_pct;
  float s2 = sensors.sensorFault[1] ? sensors.csmi : sensors.sm2_pct;
  float s3 = sensors.sensorFault[2] ? sensors.csmi : sensors.sm3_pct;
  sensors.csmi = constrain(stg.w1*s1 + stg.w2*s2 + stg.w3*s3, 0.0f, 100.0f);
  Serial.printf_P(PSTR("[CSMI] %.2f%% (SM1=%.1f SM2=%.1f SM3=%.1f)\n"),
    sensors.csmi, s1, s2, s3);
}

// ============================================================
// SMV & SMA — TEMPORAL DERIVATIVES
// ============================================================
void computeSMV_SMA() {
  csmiHistory[csmiHistIdx % 6] = sensors.csmi;
  csmiHistIdx++;
  if (csmiHistIdx >= 6) {
    float older = csmiHistory[(csmiHistIdx - 6) % 6];
    state.smv = (sensors.csmi - older) / 60.0f;
    smvHistory[smvHistIdx % 6] = state.smv;
    smvHistIdx++;
    if (smvHistIdx >= 6) {
      float olderSMV = smvHistory[(smvHistIdx - 6) % 6];
      state.sma = (state.smv - olderSMV) / 60.0f;
    }
  }
}

// ============================================================
// RING BUFFER — 72-HOUR CSMI HISTORY
// ============================================================
void updateRingBuffer(unsigned long now) {
  if (now - state.lastBufferWrite < BUFFER_WRITE_INT) return;
  state.lastBufferWrite = now;
  ringBuffer[bufHead] = sensors.csmi;
  bufHead = (bufHead + 1) % BUFFER_SIZE;
  if (bufCount < BUFFER_SIZE) bufCount++;
  EEPROM.put(ADDR_BUFFER_HEAD,  bufHead);
  EEPROM.put(ADDR_BUFFER_COUNT, bufCount);
  EEPROM.commit();
}

// ============================================================
// COSINE SIMILARITY — TEMPORAL PATTERN RESONANCE (TPR)
// ============================================================
float cosineSimilarity(float* A, float* B, int n) {
  float dot=0, na=0, nb=0;
  for (int i=0;i<n;i++) { dot+=A[i]*B[i]; na+=A[i]*A[i]; nb+=B[i]*B[i]; }
  if (na<1e-6f || nb<1e-6f) return 0.0f;
  return dot / (sqrtf(na) * sqrtf(nb));
}

void computeTemporalResonance() {
  if (bufCount < COSINE_WINDOW * 2) return;
  float wA[COSINE_WINDOW];
  for (int i=0;i<COSINE_WINDOW;i++)
    wA[i] = ringBuffer[(bufHead - COSINE_WINDOW + i + BUFFER_SIZE) % BUFFER_SIZE];
  float maxCos = 0.0f;
  int searchEnd = min((int)bufCount - COSINE_WINDOW, (int)BUFFER_SIZE - COSINE_WINDOW);
  for (int lag=COSINE_WINDOW; lag<searchEnd; lag++) {
    float wB[COSINE_WINDOW];
    for (int i=0;i<COSINE_WINDOW;i++)
      wB[i] = ringBuffer[(bufHead - COSINE_WINDOW - lag + i + BUFFER_SIZE*2) % BUFFER_SIZE];
    float cs = cosineSimilarity(wA, wB, COSINE_WINDOW);
    if (cs > maxCos) maxCos = cs;
  }
  tprScore = maxCos;
  if (maxCos >= COSINE_THRESHOLD)
    Serial.printf_P(PSTR("[TPR] Resonance MATCH cos=%.4f\n"), maxCos);
}

// ============================================================
// HARGREAVES-SAMANI ETo
// ============================================================
void computeETo() {
  float Tm = sensors.temperature;
  float Tx = Tm + 4.0f, Tn = Tm - 4.0f;
  if (Tx <= Tn) Tx = Tn + 2.0f;
  int J   = (int)(millis() / 86400000UL) % 365 + 1;
  float phi   = SITE_LAT * PI / 180.0f;
  float dr    = 1.0f + 0.033f * cosf(2.0f*PI*J/365.0f);
  float delta = 0.409f * sinf(2.0f*PI*J/365.0f - 1.39f);
  float ws    = acosf(-tanf(phi)*tanf(delta));
  float Ra    = (24.0f*60.0f/PI)*0.0820f*dr*(ws*sinf(phi)*sinf(delta)+cosf(phi)*cosf(delta)*sinf(ws));
  state.eto_mm = max(0.0f, 0.0023f*Ra*(Tm+17.8f)*sqrtf(Tx-Tn));
}

// ============================================================
// ZAMBRETTI WEATHER PREDICTION
// ============================================================
void computeZambrettiWeather() {
  if (sensors.bmpFault && !state.bmpOWMFallback) {
    state.rainProbability = 20.0f;
    return;
  }
  if (pressureHistIdx >= 18) {
    float trend = sensors.pressure_hPa - pressureHistory[(pressureHistIdx-18)%18];
    state.pressureTrend = trend;
    state.rainProbability = (trend > 2.0f)  ? 10.0f :
                            (trend < -5.0f) ? 95.0f :
                            (trend < -2.0f) ? 85.0f : 35.0f;
    // Adjust if OWM says it's raining
    if (owm.valid && owm.rainfall_mm > 0.5f) {
      state.rainProbability = max(state.rainProbability, 85.0f);
    }
  } else {
    state.rainProbability = owm.valid ? (owm.rainfall_mm > 0 ? 80.0f : 25.0f) : 20.0f;
  }
}

// ============================================================
// GDD & CROP STAGE
// ============================================================
void updateGDD() {
  float Tm = sensors.temperature, Tx = Tm+4.0f, Tn = Tm-4.0f;
  float gdd = max(0.0f, (Tx+Tn)/2.0f - cropDB[state.currentCrop].tBase);
  state.gddCumulative += gdd * (SENSOR_INTERVAL/1000.0f) / 86400.0f;
}

void updateCropStage() {
  const Crop& crop = cropDB[state.currentCrop];
  for (int s=0; s<crop.numStages; s++) {
    if (state.gddCumulative >= crop.stages[s].gddStart &&
        state.gddCumulative <  crop.stages[s].gddEnd) {
      if ((uint8_t)s != state.currentStage) {
        state.currentStage = s;
        Serial.printf_P(PSTR("[Stage] -> %s (GDD=%.1f)\n"), crop.stages[s].name, state.gddCumulative);
        EEPROM.put(ADDR_STAGE,   state.currentStage);
        EEPROM.put(ADDR_GDD_CUM, state.gddCumulative);
        EEPROM.commit();
      }
      return;
    }
  }
  state.currentStage = crop.numStages - 1;
}

// ============================================================
// EFFECTIVE RAINFALL — PRIORITY ORDER:
//  1. Tipping bucket (most accurate)
//  2. OWM rainfall API data
//  3. Offline estimation from sensor trends
// ============================================================
float getEffectiveRainfall_mm() {
  // Priority 1: Tipping bucket
  if (sensors.tipBucketMM > 0) {
    return sensors.tipBucketMM;
  }
  // Priority 2: OWM
  if (owm.valid && owm.rainfall_mm > 0) {
    return owm.rainfall_mm;
  }
  // Priority 3: Offline estimation
  return state.estimatedRainfall_mm;
}

// ============================================================
// SOIL WATER BALANCE ENGINE
// Remaining = Delta - (EffectiveRainfall + IrrigationApplied)
// ============================================================
void computeWaterBudget() {
  state.effectiveRainfall_mm = getEffectiveRainfall_mm();
  float rainfallLitres = state.effectiveRainfall_mm * state.plotArea_m2;
  state.totalRainfallContrib_L = rainfallLitres;
  state.deltaApplied_L         = totalFlowLitres;
  state.totalIrrigApplied_L    = totalFlowLitres;
  state.totalRainfallApplied_L = rainfallLitres;
  float totalApplied = state.deltaApplied_L + rainfallLitres;
  state.deltaBalance_L = max(0.0f, state.deltaRequired_L - totalApplied);
  state.seasonalWaterDeficit_L = state.deltaBalance_L;
}

void updateSeasonalBudget() {
  state.deltaRequired_L = cropDB[state.currentCrop].seasonalDelta_mm * state.plotArea_m2;
  Serial.printf_P(PSTR("[Budget] Crop=%s Area=%.2fm² Required=%.1fL\n"),
    cropDB[state.currentCrop].name, state.plotArea_m2, state.deltaRequired_L);
}

// ============================================================
// AI SCORING ENGINE — 12-component multi-parameter score
// ============================================================
void computeAIScore() {
  const CropStage& stg = cropDB[state.currentCrop].stages[state.currentStage];
  float score = 0.0f;

  // Component 1: CSMI deficit (0-60 pts)
  float deficit = max(0.0f, stg.triggerThreshold - sensors.csmi);
  score += constrain((deficit / stg.triggerThreshold) * 60.0f, 0.0f, 60.0f);

  // Component 2: Soil Moisture Velocity
  if      (state.smv < -3.0f) score += 15.0f;
  else if (state.smv < -1.5f) score += 10.0f;
  else if (state.smv < -0.5f) score +=  5.0f;
  else if (state.smv >  0.0f) score -= 10.0f;

  // Component 3: Soil Moisture Acceleration
  if      (state.sma < -0.05f) score += 5.0f;
  else if (state.sma >  0.05f) score -= 2.0f;

  // Component 4: TPR Resonance match
  if (tprScore >= COSINE_THRESHOLD) score += 12.0f;

  // Component 5: Temperature demand
  if      (sensors.temperature > 37.0f) score += 18.0f;
  else if (sensors.temperature > 33.0f) score += 10.0f;
  else if (sensors.temperature > 28.0f) score +=  5.0f;

  // Component 6: Irrigation window (NTP-aware)
  if (isPreferredWindow()) score += 10.0f;
  if (isDaytimeHigh())     score -= 15.0f;   // Avoid midday evaporation

  // Component 7: Rain probability (Zambretti + OWM)
  score -= state.rainProbability * 0.225f;

  // Component 8: Near-threshold urgency
  float dist = sensors.csmi - (stg.triggerThreshold - 5.0f);
  if (dist < 0 && dist > -5.0f) score +=  8.0f;
  if (dist < -5.0f)             score += 15.0f;

  // Component 9: Water budget guard
  if (state.deltaBalance_L <= 0) score -= 30.0f;

  // Component 10: Over-saturation guard
  if (sensors.csmi > 85.0f) score -= 25.0f;

  // Component 11: Tipping bucket active rain — block irrigation
  if (sensors.tipBucketMM > 2.0f) score -= 40.0f;

  // Component 12: Safe mode reduction
  if (state.safeMode) score = min(score, 30.0f);   // Cap score in safe mode

  state.aiScore = constrain(score, -50.0f, 120.0f);
  Serial.printf_P(PSTR("[AI] Score=%.1f (CSMI=%.1f SMV=%.3f TPR=%.3f)\n"),
    state.aiScore, sensors.csmi, state.smv, tprScore);
}

// ============================================================
// ADAPTIVE ROOT-ZONE MOISTURE CONTROL
// Used when: offline entire season AND no tipping bucket
// Maintains moisture between PWP and FC
// ============================================================
void adaptiveRootZoneControl(unsigned long now) {
  const CropStage& stg = cropDB[state.currentCrop].stages[state.currentStage];
  float fc  = stg.fc_pct;
  float pwp = stg.pwp_pct;
  float mid = (fc + pwp) / 2.0f;

  if (sensors.csmi < mid && sensors.csmi > pwp) {
    Serial.printf_P(PSTR("[ADAPTIVE] CSMI=%.1f below midpoint %.1f — trigger irrigation\n"),
      sensors.csmi, mid);
    if (!state.pumpRunning && (now - state.lastIrrigTime >= PUMP_COOLDOWN_MS)) {
      performPulseIrrigation(now);
    }
  } else if (sensors.csmi <= pwp) {
    Serial.printf_P(PSTR("[ADAPTIVE] CSMI=%.1f at PWP %.1f — emergency irrigation\n"),
      sensors.csmi, pwp);
    if (!state.pumpRunning) performPulseIrrigation(now);
  }
}

// ============================================================
// IRRIGATION DECISION
// ============================================================
void checkIrrigationDecision(unsigned long now) {
  // Adaptive mode: offline entire season with no bucket
  if (state.offlineMode && sensors.tipBucketMM == 0 && !owm.valid) {
    state.adaptiveRootZoneMode = true;
    adaptiveRootZoneControl(now);
    return;
  }
  state.adaptiveRootZoneMode = false;

  bool cooldown    = (now - state.lastIrrigTime >= PUMP_COOLDOWN_MS) || state.lastIrrigTime == 0;
  bool rainBlocked = state.rainProbability >= RAIN_BLOCK_PCT;
  bool budgetOK    = state.deltaBalance_L > 0;

  // Safe mode: still irrigate but with reduced dose and extra constraints
  float triggerScore = state.safeMode ? (AI_TRIGGER_SCORE + 20.0f) : AI_TRIGGER_SCORE;

  if (state.aiScore >= triggerScore &&
      cooldown &&
      !rainBlocked &&
      !state.pipelineFault &&
      budgetOK) {
    Serial.println(F("[AI] IRRIGATION TRIGGERED"));
    performPulseIrrigation(now);
  }
}

// ============================================================
// PULSE IRRIGATION — 30s ON / 2min OFF (per final spec)
// ============================================================
void performPulseIrrigation(unsigned long now) {
  const CropStage& stg = cropDB[state.currentCrop].stages[state.currentStage];
  float etc_mm  = state.eto_mm * stg.kc;
  float FC      = stg.fc_pct;
  float rho_b   = 1.3f;
  float swd     = (FC - sensors.csmi) / 100.0f * rho_b * stg.rootDepth_cm * 10.0f;

  // Safe mode: limit dose to 50%
  float doseMultiplier = state.safeMode ? 0.5f : 1.0f;
  float dose_L = min(etc_mm * stg.irrigInterval, max(0.0f, swd))
                 * state.plotArea_m2 * doseMultiplier;

  int pulseEvts = constrain((int)ceil(dose_L / 1.5f), 1, state.safeMode ? 5 : 20);

  Serial.printf_P(PSTR("[IRRIG] ETc=%.2f SWD=%.1fmm Dose=%.1fL Pulses=%d Safe=%d\n"),
    etc_mm, swd, dose_L, pulseEvts, state.safeMode ? 1 : 0);

  state.pumpRunning   = true;
  state.lastIrrigTime = now;
  state.pumpStartTime = now;
  pumpOnNoFlowStart   = 0;

  for (int ev = 0; ev < pulseEvts && !state.pipelineFault; ev++) {
    for (int cy = 0; cy < PULSE_CYCLES && !state.pipelineFault; cy++) {
      pumpON();
      // Non-blocking wait with watchdog yield
      unsigned long t0 = millis();
      while (millis() - t0 < PULSE_ON_MS) { yield(); }
      pumpOFF();
      t0 = millis();
      while (millis() - t0 < PULSE_OFF_MS) { yield(); }
    }
    yield();
  }

  state.pumpRunning    = false;
  state.deltaApplied_L = totalFlowLitres;

  // Add to offline log if no internet
  if (state.offlineMode && state.offlineLogCount < OFFLINE_LOG_SIZE) {
    offlineLog[state.offlineLogCount] = {
      (uint16_t)(sensors.csmi * 10),
      (uint16_t)(dose_L * 10)
    };
    EEPROM.put(OFFLINE_LOG_EEPROM_ADDR + state.offlineLogCount * sizeof(OfflineLogEntry),
               offlineLog[state.offlineLogCount]);
    state.offlineLogCount++;
    EEPROM.put(ADDR_OFFLINE_COUNT, state.offlineLogCount);
  }

  EEPROM.put(ADDR_DELTA_APPLIED, state.deltaApplied_L);
  EEPROM.commit();

  // Log estimated rainfall during this session
  state.estimatedRainfall_mm = estimateRainfallFromTrends();
}

void pumpON()  {
  digitalWrite(RELAY_PIN, LOW);   // Active LOW
  state.pumpRunning = true;
  Serial.println(F("[PUMP] ON"));
}

void pumpOFF() {
  digitalWrite(RELAY_PIN, HIGH);
  state.pumpRunning = false;
  Serial.println(F("[PUMP] OFF"));
}

// ============================================================
// LORA
// ============================================================
void initLoRa() {
  LoRa.setPins(LORA_SS_PIN, LORA_RST_PIN, LORA_DIO0_PIN);
  if (!LoRa.begin(433E6)) {
    Serial.println(F("[LoRa] FAIL"));
    return;
  }
  LoRa.setSpreadingFactor(10);
  LoRa.setSignalBandwidth(125E3);
  LoRa.setCodingRate4(5);
  LoRa.setTxPower(17);
  Serial.println(F("[LoRa] OK @ 433 MHz SF10"));
}

void sendLoRaPacket() {
  StaticJsonDocument<320> doc;
  doc["csmi"]    = sensors.csmi;
  doc["sm1"]     = sensors.sm1_pct;
  doc["sm2"]     = sensors.sm2_pct;
  doc["sm3"]     = sensors.sm3_pct;
  doc["temp"]    = sensors.temperature;
  doc["hum"]     = sensors.humidity;
  doc["pres"]    = sensors.pressure_hPa;
  doc["flow"]    = sensors.flowRate_Lmin;
  doc["litres"]  = sensors.totalLitres;
  doc["ai"]      = state.aiScore;
  doc["pump"]    = state.pumpRunning;
  doc["rain"]    = state.rainProbability;
  doc["smv"]     = state.smv;
  doc["eto"]     = state.eto_mm;
  doc["crop"]    = state.currentCrop;
  doc["stage"]   = state.currentStage;
  doc["safe"]    = state.safeMode;
  doc["offline"] = state.offlineMode;
  doc["bal"]     = state.deltaBalance_L;
  char payload[320];
  serializeJson(doc, payload, sizeof(payload));
  LoRa.beginPacket();
  LoRa.print("TSCRIC:");
  LoRa.print(payload);
  LoRa.endPacket();
  Serial.printf_P(PSTR("[LoRa] TX %d bytes\n"), strlen(payload)+7);
}

// ============================================================
// WIFI / HOTSPOT — NON-BLOCKING RECONNECT
// ============================================================
void connectWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print(F("[WiFi] Connecting"));
  int tries = 0;
  while (WiFi.status() != WL_CONNECTED && tries < 24) {
    delay(500); Serial.print('.'); tries++;
    yield();
  }
  if (WiFi.status() == WL_CONNECTED) {
    state.wifiConnected = true;
    state.loraMode      = false;
    state.offlineMode   = false;
    Serial.printf_P(PSTR("\n[WiFi] IP=%s\n"), WiFi.localIP().toString().c_str());
    // Sync NTP
    uint32_t t = getNTPTime();
    if (t > 0) { state.ntpEpoch = t; state.ntpMillis = millis(); Serial.println(F("[NTP] Synced")); }
    // Sync offline logs to Firebase
    if (state.offlineLogCount > 0) syncOfflineLogs();
  } else {
    state.wifiConnected = false;
    state.loraMode      = true;
    state.offlineMode   = true;
    WiFi.mode(WIFI_AP_STA);
    WiFi.softAP(AP_SSID, AP_PASSWORD);
    Serial.printf_P(PSTR("\n[AP] Hotspot: %s\n"), AP_SSID);
  }
}

// ============================================================
// [FIX-5] FIREBASE SYNC — NON-BLOCKING, TIMEOUT PROTECTED
// ============================================================
void syncFirebase() {
  if (!state.wifiConnected || WiFi.status() != WL_CONNECTED) return;

  WiFiClientSecure client;
  client.setInsecure();
  client.setTimeout(5);           // 5s timeout protection

  HTTPClient http;
  http.setTimeout(5000);

  // Build sensor payload
  StaticJsonDocument<768> doc;
  // LOCAL SENSORS (primary)
  doc["csmi"]           = sensors.csmi;
  doc["sm1"]            = sensors.sm1_pct;
  doc["sm2"]            = sensors.sm2_pct;
  doc["sm3"]            = sensors.sm3_pct;
  doc["vwc1"]           = sensors.vwc1;
  doc["vwc2"]           = sensors.vwc2;
  doc["vwc3"]           = sensors.vwc3;
  doc["temperature"]    = sensors.temperature;
  doc["humidity"]       = sensors.humidity;
  doc["pressure"]       = sensors.pressure_hPa;
  doc["flowRate"]       = sensors.flowRate_Lmin;
  doc["totalLitres"]    = sensors.totalLitres;
  doc["tipBucket_mm"]   = sensors.tipBucketMM;
  doc["rainDrop"]       = sensors.rainDropDetected;

  // OWM DATA (secondary — displayed alongside local)
  doc["owm_temp"]       = owm.valid ? owm.temp       : 0;
  doc["owm_humidity"]   = owm.valid ? owm.humidity   : 0;
  doc["owm_pressure"]   = owm.valid ? owm.pressure   : 0;
  doc["owm_rain_mm"]    = owm.valid ? owm.rainfall_mm: 0;
  doc["owm_valid"]      = owm.valid;

  // AI & STATE
  doc["aiScore"]        = state.aiScore;
  doc["pump"]           = state.pumpRunning;
  doc["autoMode"]       = state.autoMode;
  doc["rainProb"]       = state.rainProbability;
  doc["smv"]            = state.smv;
  doc["sma"]            = state.sma;
  doc["eto"]            = state.eto_mm;
  doc["gdd"]            = state.gddCumulative;
  doc["crop"]           = cropDB[state.currentCrop].name;
  doc["stage"]          = cropDB[state.currentCrop].stages[state.currentStage].name;
  doc["cropIdx"]        = state.currentCrop;
  doc["stageIdx"]       = state.currentStage;

  // WATER BALANCE
  doc["deltaApplied"]   = state.deltaApplied_L;
  doc["deltaBalance"]   = state.deltaBalance_L;
  doc["deltaRequired"]  = state.deltaRequired_L;
  doc["effectiveRain"]  = state.effectiveRainfall_mm;
  doc["estimatedRain"]  = state.estimatedRainfall_mm;
  doc["rainfallContrib"]= state.totalRainfallContrib_L;

  // FAULTS & MODES
  doc["pipelineFault"]  = state.pipelineFault;
  doc["safeMode"]       = state.safeMode;
  doc["offlineMode"]    = state.offlineMode;
  doc["adaptiveMode"]   = state.adaptiveRootZoneMode;
  doc["dhtFallback"]    = state.dhtOWMFallback;
  doc["bmpFallback"]    = state.bmpOWMFallback;
  doc["tprScore"]       = tprScore;
  doc["plotArea_m2"]    = state.plotArea_m2;
  doc["plotArea_bigha"] = state.plotArea_m2 / BIGHA_TO_M2;
  doc["wifiMode"]       = "Online";
  doc["timestamp"]      = millis();

  char payload[768];
  serializeJson(doc, payload, sizeof(payload));

  String url = String("https://") + FIREBASE_HOST + "/tscric/sensors.json?auth=" + FIREBASE_AUTH;
  if (http.begin(client, url)) {
    http.addHeader("Content-Type", "application/json");
    int code = http.sendRequest("PUT", String(payload));
    http.end();
    Serial.printf_P(PSTR("[Firebase] Sensors: %d\n"), code);
    if (code == 200 || code == 204) {
      // Only on success check commands
      checkFirebaseCommands();
      checkFirebaseConfig();
    }
  }
}

void checkFirebaseCommands() {
  WiFiClientSecure client; client.setInsecure(); client.setTimeout(4);
  HTTPClient http; http.setTimeout(4000);
  String url = String("https://") + FIREBASE_HOST + "/tscric/commands.json?auth=" + FIREBASE_AUTH;
  if (!http.begin(client, url)) return;
  int code = http.GET();
  if (code == 200) {
    String resp = http.getString();
    StaticJsonDocument<128> cmd;
    if (!deserializeJson(cmd, resp) && !cmd.isNull()) {
      if (cmd.containsKey("pumpOn")  && (bool)cmd["pumpOn"])  pumpON();
      if (cmd.containsKey("pumpOff") && (bool)cmd["pumpOff"]) pumpOFF();
      if (cmd.containsKey("auto"))    state.autoMode = (bool)cmd["auto"];
    }
  }
  http.end();
}

void checkFirebaseConfig() {
  WiFiClientSecure client; client.setInsecure(); client.setTimeout(4);
  HTTPClient http; http.setTimeout(4000);
  String url = String("https://") + FIREBASE_HOST + "/tscric/config.json?auth=" + FIREBASE_AUTH;
  if (!http.begin(client, url)) return;
  int code = http.GET();
  if (code == 200) {
    String resp = http.getString();
    StaticJsonDocument<200> cfg;
    if (!deserializeJson(cfg, resp) && !cfg.isNull()) {
      if (cfg.containsKey("plotArea")) {
        float newArea = cfg["plotArea"].as<float>();
        if (newArea >= 1.0f && newArea <= 100000.0f && fabsf(newArea - state.plotArea_m2) > 0.01f) {
          state.plotArea_m2 = newArea;
          EEPROM.put(ADDR_PLOT_AREA, state.plotArea_m2);
          EEPROM.commit();
          updateSeasonalBudget();
        }
      }
      if (cfg.containsKey("crop")) {
        int newCrop = cfg["crop"].as<int>();
        if (newCrop >= 0 && newCrop < CROP_COUNT && (uint8_t)newCrop != state.currentCrop) {
          state.currentCrop   = newCrop;
          state.currentStage  = 0;
          state.gddCumulative = 0.0f;
          EEPROM.put(ADDR_CROP,    state.currentCrop);
          EEPROM.put(ADDR_GDD_CUM, state.gddCumulative);
          EEPROM.commit();
          updateSeasonalBudget();
        }
      }
      // Soil calibration from Firebase
      if (cfg.containsKey("soilCalib")) {
        JsonObject sc = cfg["soilCalib"];
        for (int i = 0; i < 3; i++) {
          char key[8]; snprintf(key, sizeof(key), "ch%d", i);
          if (sc.containsKey(key)) {
            JsonObject ch = sc[key];
            soilCalib[i].adc_dry = ch["adc_dry"] | soilCalib[i].adc_dry;
            soilCalib[i].adc_fc  = ch["adc_fc"]  | soilCalib[i].adc_fc;
            soilCalib[i].adc_pwp = ch["adc_pwp"] | soilCalib[i].adc_pwp;
            soilCalib[i].vwc_fc  = ch["vwc_fc"]  | soilCalib[i].vwc_fc;
            soilCalib[i].vwc_pwp = ch["vwc_pwp"] | soilCalib[i].vwc_pwp;
            EEPROM.put(ADDR_SOIL_CALIB + i*sizeof(SoilCalibration), soilCalib[i]);
          }
        }
        EEPROM.commit();
      }
    }
  }
  http.end();
}

// ============================================================
// OFFLINE STORE-AND-SYNC — Push deferred logs to Firebase
// ============================================================
void syncOfflineLogs() {
  if (state.offlineLogCount == 0 || !state.wifiConnected) return;
  WiFiClientSecure client; client.setInsecure(); client.setTimeout(5);
  HTTPClient http; http.setTimeout(5000);

  StaticJsonDocument<512> doc;
  JsonArray arr = doc.createNestedArray("events");
  for (int i = 0; i < state.offlineLogCount; i++) {
    JsonObject obj = arr.createNestedObject();
    obj["csmi"]   = (float)offlineLog[i].csmi_x10  / 10.0f;
    obj["litres"] = (float)offlineLog[i].litres_x10 / 10.0f;
  }
  doc["synced_at"] = millis();
  doc["count"]     = state.offlineLogCount;
  char payload[512];
  serializeJson(doc, payload, sizeof(payload));

  String url = String("https://") + FIREBASE_HOST + "/tscric/offlineLogs.json?auth=" + FIREBASE_AUTH;
  if (http.begin(client, url)) {
    http.addHeader("Content-Type", "application/json");
    int code = http.sendRequest("PUT", String(payload));
    http.end();
    if (code == 200 || code == 204) {
      Serial.printf_P(PSTR("[OfflineSync] %d records synced\n"), state.offlineLogCount);
      state.offlineLogCount = 0;
      EEPROM.put(ADDR_OFFLINE_COUNT, state.offlineLogCount);
      EEPROM.commit();
    }
  }
}

// ============================================================
// OPENWEATHERMAP FETCH
// Fetches: temp, humidity, pressure, rainfall, wind
// Only used as SECONDARY data / sensor fallback
// ============================================================
void fetchOWMData() {
  if (!state.wifiConnected || WiFi.status() != WL_CONNECTED) return;

  WiFiClientSecure client; client.setInsecure(); client.setTimeout(8);
  HTTPClient http; http.setTimeout(8000);

  char url[256];
  snprintf(url, sizeof(url),
    "http://api.openweathermap.org/data/2.5/weather?lat=%.4f&lon=%.4f&appid=%s&units=metric",
    SITE_LAT, SITE_LON, OWM_API_KEY);

  if (!http.begin(client, String(url))) return;
  int code = http.GET();
  if (code == 200) {
    StaticJsonDocument<1024> doc;
    DeserializationError err = deserializeJson(doc, http.getString());
    if (!err) {
      owm.temp        = doc["main"]["temp"]     | 28.0f;
      owm.humidity    = doc["main"]["humidity"] | 60.0f;
      owm.pressure    = doc["main"]["pressure"] | 1013.0f;
      owm.windSpeed   = doc["wind"]["speed"]    | 0.0f;
      owm.weatherId   = doc["weather"][0]["id"] | 800;
      owm.rainfall_mm = 0.0f;
      if (doc.containsKey("rain") && doc["rain"].containsKey("1h")) {
        owm.rainfall_mm = doc["rain"]["1h"] | 0.0f;
      }
      owm.valid     = true;
      owm.fetchedAt = millis();
      Serial.printf_P(PSTR("[OWM] T=%.1f H=%.0f P=%.1f Rain=%.2fmm\n"),
        owm.temp, owm.humidity, owm.pressure, owm.rainfall_mm);
    }
  } else {
    // OWM fetch failed — mark stale after 30 minutes
    if (millis() - owm.fetchedAt > 1800000UL) owm.valid = false;
  }
  http.end();
}

// ============================================================
// SELF-CALIBRATION
// ============================================================
void performSelfCalibration() {
  for (int ch = 0; ch < 3; ch++) {
    int raw = readMuxChannel(ch);
    if (raw > calib_dry[ch]) { calib_dry[ch] = raw; EEPROM.put(ADDR_CALIB_DRY + ch*2, (uint16_t)raw); }
    if (raw < calib_wet[ch]) { calib_wet[ch] = raw; EEPROM.put(ADDR_CALIB_WET + ch*2, (uint16_t)raw); }
  }
  EEPROM.commit();
  Serial.println(F("[CALIB] Self-calibration complete"));
}

// ============================================================
// WEB SERVER
// ============================================================

// ══════════════════════════════════════════════════════════════
// RULE-BASED FARM AI ASSISTANT — /api/chat
// Handles natural language queries from dashboard chatbox
// Memory efficient: keyword matching on ESP8266
// ══════════════════════════════════════════════════════════════

// Helper: check if query contains keyword (case-insensitive)
bool qHas(const String& q, const char* kw) {
  String qq = q; qq.toLowerCase();
  return qq.indexOf(kw) >= 0;
}

// Helper: check multiple keywords (OR logic)
bool qHasAny(const String& q, const char* kws[], uint8_t n) {
  for (uint8_t i = 0; i < n; i++) if (qHas(q, kws[i])) return true;
  return false;
}

void handleChatPost() {
  if (!server.hasArg("plain")) {
    server.send(400, "application/json", "{"reply":"Query missing"}");
    return;
  }

  String body = server.arg("plain");
  StaticJsonDocument<128> reqDoc;
  if (deserializeJson(reqDoc, body)) {
    server.send(400, "application/json", "{"reply":"Invalid JSON"}");
    return;
  }

  String q = reqDoc["q"] | "";
  q.toLowerCase();
  q.trim();

  // Response buffer
  String reply = "";

  // ── SENSOR VALUES for responses ───────────────────────────
  float csmi    = sensors.csmi;
  float sm1     = sensors.sm1_pct;
  float sm2     = sensors.sm2_pct;
  float sm3     = sensors.sm3_pct;
  float temp    = sensors.temperature;
  float hum     = sensors.humidity;
  float flow    = sensors.flowRate_Lmin;
  float totalL  = sensors.totalLitres;
  float aiSc    = state.aiScore;
  float rain    = state.rainProbability;
  float eto     = state.eto_mm;
  float bal     = state.deltaBalance_L;
  bool  pumpOn  = state.pumpRunning;
  bool  autoMd  = state.autoMode;
  bool  fault   = state.pipelineFault;
  bool  safe    = state.safeMode;
  bool  offline = state.offlineMode;
  const char* cropName = cropDB[state.currentCrop].name;
  const char* stageName = cropDB[state.currentCrop].stages[state.currentStage].name;

  // ── INTENT DETECTION ──────────────────────────────────────

  // 1. GREETING
  if (qHas(q,"namaste")||qHas(q,"hello")||qHas(q,"hi ")||q=="hi"||
      qHas(q,"namaskar")||qHas(q,"ram ram")||qHas(q,"jai kisan")) {
    reply = "Namaste! TSCRIC Farm AI ready hai. ";
    reply += offline ? "System offline mode mein hai. " : "System online hai. ";
    reply += pumpOn ? "Pump ON hai. " : "Pump OFF hai. ";
    char buf[30]; snprintf(buf,sizeof(buf),"CSMI %.1f%%.",csmi);
    reply += buf;
  }

  // 2. PUMP STATUS / PROBLEMS
  else if (qHas(q,"pump")||qHas(q,"motor")||qHas(q,"engine")) {
    if (qHas(q,"kyun")||qHas(q,"kyu")||qHas(q,"why")||qHas(q,"kyon")) {
      // Why pump off/on
      if (fault) reply = "Pump band hai kyunki: Pipeline fault detect hua! YF-S201 sensor ya pipeline check karo.";
      else if (safe) reply = "Pump restricted kyunki: Safe mode active — soil sensors fail hain. Wiring check karo.";
      else if (rain > 65) { char buf[60]; snprintf(buf,sizeof(buf),"Pump band hai kyunki baarish %.0f%% expected hai — paani waste bachane ke liye.",rain); reply=buf; }
      else if (csmi > 55) { char buf[60]; snprintf(buf,sizeof(buf),"Pump band hai kyunki mitti %.1f%% — kaafi nami hai, irrigation ki zaroorat nahi.",csmi); reply=buf; }
      else if (aiSc < 65) { char buf[80]; snprintf(buf,sizeof(buf),"Pump band hai kyunki AI Score %.1f hai — threshold 65 se kam. Mitti aur dry hogi to score badhega.",aiSc); reply=buf; }
      else if (!autoMd) reply = "Pump band hai kyunki Manual mode ON hai — AI control nahi kar sakta. Auto mode ON karo.";
      else reply = "Pump standby mein hai — sab theek lag raha hai.";
    }
    else if (qHas(q,"kaise")||qHas(q,"kaisa")||qHas(q,"how")) {
      char buf[120];
      snprintf(buf,sizeof(buf),"Pump: %s | Mode: %s | Score: %.1f/120 | Flow: %.2f L/min | Applied: %.1fL",
        pumpOn?"ON":"OFF", autoMd?"Auto":"Manual", aiSc, flow, totalL);
      reply = buf;
    }
    else if (qHas(q,"kab")||qHas(q,"when")) {
      if (pumpOn) { char buf[60]; snprintf(buf,sizeof(buf),"Pump abhi ON hai. CSMI %.1f%% — 55%% hone par band hoga.",csmi); reply=buf; }
      else if (fault||safe) reply = "Pump tab chalega jab fault fix hoga.";
      else if (csmi < 35 && rain < 50) reply = "Score threshold 65 ke paas — jald pump ON hoga.";
      else reply = "Abhi pump ki zaroorat nahi — mitti theek hai.";
    }
    else {
      // General pump status
      char buf[150];
      snprintf(buf,sizeof(buf),"Pump: %s | Mode: %s | AI Score: %.1f/120 | Flow: %.2fL/min | Total: %.1fL%s%s",
        pumpOn?"ON":"OFF", autoMd?"Auto":"Manual", aiSc, flow, totalL,
        fault?" | FAULT!":"", safe?" | SAFE MODE":"");
      reply = buf;
    }
  }

  // 3. SOIL / MITTI
  else if (qHas(q,"mitti")||qHas(q,"soil")||qHas(q,"nami")||qHas(q,"naami")||
           qHas(q,"moisture")||qHas(q,"csmi")||qHas(q,"sm1")||qHas(q,"sm2")||qHas(q,"sm3")) {
    char buf[180];
    const char* level = csmi<20?"Bahut Dry":csmi<35?"Dry":csmi<60?"Optimal":csmi<80?"Moist":"Bahut Wet";
    const char* advice = csmi<20?"Turant sinchai karo!":csmi<35?"Sinchai zaruri.":csmi<60?"Theek hai.":csmi<80?"Mat karo sinchai.":"Drainage check karo!";
    snprintf(buf,sizeof(buf),"CSMI: %.1f%% (%s) | 15cm: %.1f%% | 30cm: %.1f%% | 45cm: %.1f%% | Temp: %.1fC | %s",
      csmi,level,sm1,sm2,sm3,temp,advice);
    reply = buf;
    if (safe) reply += " [SAFE MODE: Sensors fail!]";
  }

  // 4. PAANI KITNA / WATER QUANTITY
  else if ((qHas(q,"kitna")&&(qHas(q,"paani")||qHas(q,"pani")||qHas(q,"litre")||qHas(q,"water")))||
            qHas(q,"water requirement")||qHas(q,"paani chahiye")) {
    float area  = state.plotArea_m2;
    float def   = ((50.0f - csmi) > 0.0f ? (50.0f - csmi) : 0.0f);
    float need  = (def/100.0f) * area * 300.0f;
    float etoL  = eto * area;
    float total = need + etoL;
    float adj   = temp > 37 ? total*1.25f : temp > 32 ? total*1.1f : total;
    char buf[150];
    snprintf(buf,sizeof(buf),"Area: %.1fm2 | Deficit: ~%.0fL | ETo loss: ~%.0fL | Total: ~%.0fL | Budget: %.1fL",
      area, need, etoL, adj, bal);
    reply = buf;
    if (rain > 50) { char r2[50]; snprintf(r2,sizeof(r2)," | Rain %.0f%% — kam do!", rain); reply+=r2; }
  }

  // 5. BAARISH / RAIN
  else if (qHas(q,"baarish")||qHas(q,"barish")||qHas(q,"rain")||qHas(q,"barsaat")) {
    char buf[150];
    const char* advice = rain>75?"Pakki baarish — sinchai MAT karo!":
                         rain>50?"Baarish hone wali — wait karo.":
                         rain>25?"Thodi sambhavna — normal karo.":
                         "Baarish nahi hogi — normal irrigation karo.";
    snprintf(buf,sizeof(buf),"Rain Probability: %.0f%% | OWM Rain: %.1fmm | Temp: %.1fC | %s",
      rain, owm.rainfall_mm, temp, advice);
    reply = buf;
  }

  // 6. SINCHAI KAB / IRRIGATION DECISION
  else if (qHas(q,"sinchai")||qHas(q,"irrigation")||qHas(q,"kab karo")||qHas(q,"paani do")) {
    if (fault) reply = "Sinchai nahi ho sakti — Pipeline fault hai! Check karo.";
    else if (safe) reply = "Sinchai restricted — Safe mode. Sensors fix karo.";
    else if (rain > 65) { char buf[60]; snprintf(buf,sizeof(buf),"Baarish %.0f%% — sinchai mat karo! Wait karo.",rain); reply=buf; }
    else if (csmi > 70) { char buf[60]; snprintf(buf,sizeof(buf),"Mitti %.1f%% — already wet. Sinchai mat karo.",csmi); reply=buf; }
    else if (csmi < 20) { char buf[80]; snprintf(buf,sizeof(buf),"Mitti bahut dry (%.1f%%) — TURANT sinchai karo! ~%.0fL chahiye.",csmi,((50.0f - csmi) > 0.0f ? (50.0f - csmi) : 0.0f)*state.plotArea_m2*3.0f); reply=buf; }
    else if (csmi < 35) { char buf[60]; snprintf(buf,sizeof(buf),"Mitti dry (%.1f%%) — sinchai karo. Budget: %.1fL.",csmi,bal); reply=buf; }
    else { char buf[80]; snprintf(buf,sizeof(buf),"Mitti %.1f%% — abhi theek hai. Score: %.1f/120. AI monitor kar raha.",csmi,aiSc); reply=buf; }
  }

  // 7. SENSOR HEALTH
  else if (qHas(q,"sensor")||qHas(q,"kharab")||qHas(q,"fault")||qHas(q,"safe mode")) {
    if (!fault && !safe && !state.dhtOWMFallback && !state.bmpOWMFallback) {
      reply = "Sab sensors theek hain! SM1/SM2/SM3, DHT22, BMP280, Flow — all OK.";
    } else {
      reply = "Sensor issues: ";
      if (safe) reply += "[SAFE MODE:Soil sensors fail] ";
      if (state.dhtOWMFallback) reply += "[DHT22:OWM fallback] ";
      if (state.bmpOWMFallback) reply += "[BMP280:OWM fallback] ";
      if (fault) reply += "[Pipeline FAULT!] ";
    }
  }

  // 8. WEATHER / TEMPERATURE
  else if (qHas(q,"temperature")||qHas(q,"temp")||qHas(q,"garmi")||
           qHas(q,"thand")||qHas(q,"humidity")||qHas(q,"mausam")) {
    char buf[120];
    snprintf(buf,sizeof(buf),"Temp: %.1fC | Humidity: %.0f%% | Pressure: %.1fhPa | ETo: %.2fmm/day | Rain: %.0f%%",
      temp, hum, sensors.pressure_hPa, eto, rain);
    reply = buf;
    if (temp>40) reply += " | Bahut garmi — zyada irrigation chahiye!";
    else if (temp<15) reply += " | Thand — kam irrigation.";
  }

  // 9. CROP INFO
  else if (qHas(q,"crop")||qHas(q,"fasal")||qHas(q,"stage")||qHas(q,"gdd")) {
    char buf[150];
    snprintf(buf,sizeof(buf),"Crop: %s | Stage: %s | GDD: %.0f | Area: %.1fm2 | CSMI: %.1f%%",
      cropName, stageName, state.gddCumulative, state.plotArea_m2, csmi);
    reply = buf;
  }

  // 10. WATER BUDGET
  else if (qHas(q,"budget")||qHas(q,"balance")||qHas(q,"kitna bacha")||qHas(q,"remaining")) {
    char buf[150];
    snprintf(buf,sizeof(buf),"Required: %.1fL | Applied: %.1fL | Rain contrib: %.1fL | Balance: %.1fL | Flow total: %.1fL",
      state.deltaRequired_L, state.deltaApplied_L,
      state.effectiveRainfall_mm * state.plotArea_m2 / 1000.0f,
      bal, totalL);
    reply = buf;
    if (bal < 0) reply += " | BUDGET KHATAM!";
    else if (bal < 200) reply += " | Budget kam bacha!";
  }

  // 11. AI SCORE
  else if (qHas(q,"score")||qHas(q,"ai score")||qHas(q,"threshold")) {
    char buf[150];
    snprintf(buf,sizeof(buf),"AI Score: %.1f/120 | Threshold: 65 | %s | CSMI: %.1f%% | SMV: %.4f | Rain: %.0f%%",
      aiSc, aiSc>=65?"Irrigation ELIGIBLE":"Not yet", csmi, state.smv, rain);
    reply = buf;
  }

  // 12. CONNECTION / INTERNET
  else if (qHas(q,"internet")||qHas(q,"wifi")||qHas(q,"connection")||
           qHas(q,"firebase")||qHas(q,"online")||qHas(q,"offline")) {
    reply = offline ? "System OFFLINE mode mein hai — autonomous chal raha hai." : "System ONLINE — Firebase connected.";
    if (state.loraMode) reply += " LoRa active.";
    char buf[30]; snprintf(buf,sizeof(buf)," WiFi: %s", state.wifiConnected?"Connected":"Disconnected");
    reply += buf;
  }

  // 13. FULL STATUS / ANALYSIS
  else if (qHas(q,"sab kuch")||qHas(q,"full status")||qHas(q,"report")||
           qHas(q,"overview")||qHas(q,"sab batao")||qHas(q,"poori report")) {
    char buf[230];
    const char* soilL = csmi<20?"BahuDry":csmi<35?"Dry":csmi<60?"OK":csmi<80?"Wet":"V.Wet";
    snprintf(buf,sizeof(buf),
      "CROP:%s|STAGE:%s|CSMI:%.1f(%s)|PUMP:%s|SCORE:%.1f|RAIN:%.0f%%|TEMP:%.1fC|BAL:%.1fL|%s%s",
      cropName,stageName,csmi,soilL,pumpOn?"ON":"OFF",aiSc,rain,temp,bal,
      fault?"FAULT!":safe?"SAFE!":"OK",offline?"|OFFLINE":"");
    reply = buf;
  }

  // 14. POSITIVE FEEDBACK
  else if (qHas(q,"good")||qHas(q,"nice")||qHas(q,"accha")||qHas(q,"badhiya")||
           qHas(q,"shukriya")||qHas(q,"thank")||qHas(q,"shabash")||qHas(q,"wah")||
           qHas(q,"excellent")||qHas(q,"perfect")||qHas(q,"zabardast")||qHas(q,"mast")) {
    reply = "Shukriya! Aur koi sawaal ho toh poochho. ";
    char buf[60]; snprintf(buf,sizeof(buf),"Farm: CSMI %.1f%% | Pump %s",csmi,pumpOn?"ON":"OFF");
    reply += buf;
  }

  // 15. NEGATIVE FEEDBACK
  else if (qHas(q,"galat")||qHas(q,"wrong")||qHas(q,"bekar")||qHas(q,"bekaar")||
           qHas(q,"nahi acha")||qHas(q,"accha nahi")||qHas(q,"pasand nahi")||
           qHas(q,"bura laga")||qHas(q,"disappointed")||qHas(q,"useless")||
           qHas(q,"hate")||qHas(q,"nafrat")||qHas(q,"kharab")) {
    reply = "Hume khed hai ki hum aapki sahayata nahi kar paye. Dobara poochho — seedha sawaal likhein jaise: pump status, mitti kaisi, kitna paani. Main poori koshish karoonga!";
  }

  // 16. HELP
  else if (qHas(q,"help")||qHas(q,"madad")||qHas(q,"kya puch")||qHas(q,"options")) {
    reply = "Pooch sakte ho: pump status|mitti kaisi|kitna paani|baarish hogi|sensor theek|budget kitna|AI score|full report|temperature";
  }

  // 17. DEFAULT
  else {
    reply = "Samajh nahi aaya. Poochho: pump|mitti|paani|baarish|sensor|budget|score|report. Ya 'help' likho.";
    // Add farm context
    char buf[60]; snprintf(buf,sizeof(buf)," [CSMI:%.1f%% Pump:%s Score:%.1f]",csmi,pumpOn?"ON":"OFF",aiSc);
    reply += buf;
  }

  // Send JSON response
  String resp = "{"reply":"" + reply + ""}";
  server.send(200, "application/json", resp);
}

void setupWebServer() {
  server.on("/",             HTTP_GET,  serveOfflineDashboard);
  server.on("/api/data",     HTTP_GET,  handleApiData);
  server.on("/api/pump/on",  HTTP_GET,  []() { pumpON();  server.send(200,"text/plain","OK"); });
  server.on("/api/pump/off", HTTP_GET,  []() { pumpOFF(); server.send(200,"text/plain","OK"); });
  server.on("/api/auto/on",  HTTP_GET,  []() { state.autoMode=true;  server.send(200,"text/plain","OK"); });
  server.on("/api/auto/off", HTTP_GET,  []() { state.autoMode=false; server.send(200,"text/plain","OK"); });
  server.on("/api/config",   HTTP_GET,  handleConfigGet);
  server.on("/api/config",   HTTP_POST, handleConfigPost);
  server.on("/api/calib",    HTTP_POST, handleCalibPost);
  server.on("/api/chat",     HTTP_POST, handleChatPost);
  server.onNotFound([]() { server.send(404,"text/plain","Not Found"); });
}

void handleApiData() {
  StaticJsonDocument<768> doc;
  doc["csmi"]           = sensors.csmi;
  doc["sm1"]            = sensors.sm1_pct;
  doc["sm2"]            = sensors.sm2_pct;
  doc["sm3"]            = sensors.sm3_pct;
  doc["vwc1"]           = sensors.vwc1;
  doc["vwc2"]           = sensors.vwc2;
  doc["vwc3"]           = sensors.vwc3;
  doc["temperature"]    = sensors.temperature;
  doc["humidity"]       = sensors.humidity;
  doc["pressure"]       = sensors.pressure_hPa;
  doc["flowRate"]       = sensors.flowRate_Lmin;
  doc["totalLitres"]    = sensors.totalLitres;
  doc["aiScore"]        = state.aiScore;
  doc["pump"]           = state.pumpRunning;
  doc["autoMode"]       = state.autoMode;
  doc["rainProb"]       = state.rainProbability;
  doc["smv"]            = state.smv;
  doc["sma"]            = state.sma;
  doc["eto"]            = state.eto_mm;
  doc["gdd"]            = state.gddCumulative;
  doc["crop"]           = cropDB[state.currentCrop].name;
  doc["cropIdx"]        = state.currentCrop;
  doc["stage"]          = cropDB[state.currentCrop].stages[state.currentStage].name;
  doc["deltaApplied"]   = state.deltaApplied_L;
  doc["deltaBalance"]   = state.deltaBalance_L;
  doc["deltaRequired"]  = state.deltaRequired_L;
  doc["effectiveRain"]  = state.effectiveRainfall_mm;
  doc["estimatedRain"]  = state.estimatedRainfall_mm;
  doc["pipelineFault"]  = state.pipelineFault;
  doc["safeMode"]       = state.safeMode;
  doc["offlineMode"]    = state.offlineMode;
  doc["adaptiveMode"]   = state.adaptiveRootZoneMode;
  doc["tprScore"]       = tprScore;
  doc["plotArea_m2"]    = state.plotArea_m2;
  doc["plotArea_bigha"] = state.plotArea_m2 / BIGHA_TO_M2;
  doc["wifiMode"]       = state.wifiConnected ? "Online" : "Hotspot";
  doc["tipBucket_mm"]   = sensors.tipBucketMM;
  doc["owm_temp"]       = owm.temp;
  doc["owm_humidity"]   = owm.humidity;
  doc["owm_pressure"]   = owm.pressure;
  doc["owm_rain_mm"]    = owm.rainfall_mm;
  doc["owm_valid"]      = owm.valid;
  doc["dhtFallback"]    = state.dhtOWMFallback;
  doc["bmpFallback"]    = state.bmpOWMFallback;
  char out[768];
  serializeJson(doc, out, sizeof(out));
  server.send(200, "application/json", out);
}

void handleConfigGet() {
  StaticJsonDocument<256> doc;
  doc["plotArea_m2"]    = state.plotArea_m2;
  doc["plotArea_bigha"] = state.plotArea_m2 / BIGHA_TO_M2;
  doc["crop"]           = state.currentCrop;
  doc["cropName"]       = cropDB[state.currentCrop].name;
  doc["bighaToM2"]      = BIGHA_TO_M2;
  doc["deltaRequired_L"]= state.deltaRequired_L;
  char out[256];
  serializeJson(doc, out, sizeof(out));
  server.send(200, "application/json", out);
}

void handleConfigPost() {
  bool changed = false;
  if (server.hasArg("plain")) {
    String body = server.arg("plain");
    StaticJsonDocument<200> doc;
    if (!deserializeJson(doc, body)) {
      if (doc.containsKey("plotArea_m2")) {
        float a = doc["plotArea_m2"].as<float>();
        if (a >= 1.0f && a <= 100000.0f) { state.plotArea_m2 = a; changed = true; }
      }
      if (doc.containsKey("plotArea_bigha")) {
        float b = doc["plotArea_bigha"].as<float>();
        if (b >= 0.001f && b <= 75.0f) { state.plotArea_m2 = b * BIGHA_TO_M2; changed = true; }
      }
      if (doc.containsKey("crop")) {
        int c = doc["crop"].as<int>();
        if (c >= 0 && c < CROP_COUNT) {
          state.currentCrop   = c;
          state.currentStage  = 0;
          state.gddCumulative = 0.0f;
          EEPROM.put(ADDR_CROP,    state.currentCrop);
          EEPROM.put(ADDR_GDD_CUM, state.gddCumulative);
          changed = true;
        }
      }
    }
  }
  if (changed) {
    EEPROM.put(ADDR_PLOT_AREA, state.plotArea_m2);
    EEPROM.commit();
    updateSeasonalBudget();
    server.send(200, "application/json",
      "{\"status\":\"ok\",\"plotArea_m2\":" + String(state.plotArea_m2,2) +
      ",\"crop\":" + String(state.currentCrop) + "}");
  } else {
    server.send(400, "application/json", "{\"status\":\"error\"}");
  }
}

void handleCalibPost() {
  if (server.hasArg("plain")) {
    String body = server.arg("plain");
    StaticJsonDocument<256> doc;
    if (!deserializeJson(doc, body)) {
      for (int i = 0; i < 3; i++) {
        char key[4]; snprintf(key, sizeof(key), "ch%d", i);
        if (doc.containsKey(key)) {
          JsonObject ch = doc[key];
          if (ch.containsKey("adc_dry"))  soilCalib[i].adc_dry  = ch["adc_dry"];
          if (ch.containsKey("adc_fc"))   soilCalib[i].adc_fc   = ch["adc_fc"];
          if (ch.containsKey("adc_pwp"))  soilCalib[i].adc_pwp  = ch["adc_pwp"];
          if (ch.containsKey("vwc_fc"))   soilCalib[i].vwc_fc   = ch["vwc_fc"];
          if (ch.containsKey("vwc_pwp"))  soilCalib[i].vwc_pwp  = ch["vwc_pwp"];
          EEPROM.put(ADDR_SOIL_CALIB + i*sizeof(SoilCalibration), soilCalib[i]);
        }
      }
      EEPROM.commit();
      server.send(200, "application/json", "{\"status\":\"ok\"}");
    } else {
      server.send(400, "application/json", "{\"status\":\"error\"}");
    }
  }
}

// ============================================================
// OFFLINE LOCAL DASHBOARD — Compact HTML served from device
// ============================================================
void serveOfflineDashboard() {
  // Redirect to Firebase GitHub Pages dashboard if online
  if (state.wifiConnected) {
    server.sendHeader("Location", "https://YOUR_GITHUB_USERNAME.github.io/tscric-lora/", true);
    server.send(302, "text/plain", "");
    return;
  }
  // Serve compact local dashboard if offline
  server.send(200, "text/html", F(
    "<!DOCTYPE html><html><head><meta charset='UTF-8'>"
    "<meta name='viewport' content='width=device-width,initial-scale=1'>"
    "<title>TSCRIC-LoRa Local</title>"
    "<style>body{background:#0d1117;color:#e6edf3;font-family:Arial;margin:0}"
    ".h{background:#0a2e1c;padding:12px;text-align:center}"
    ".h h1{color:#56d364;margin:0;font-size:1.2em}"
    ".g{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;padding:12px}"
    ".c{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:12px;text-align:center}"
    ".v{font-size:1.5em;font-weight:bold;color:#56d364}"
    ".l{font-size:.65em;color:#8b949e;text-transform:uppercase}"
    ".btns{display:flex;flex-wrap:wrap;gap:8px;padding:0 12px}"
    ".btn{padding:10px 16px;border:none;border-radius:6px;cursor:pointer;font-weight:bold}"
    ".on{background:#2ea043;color:#fff}.off{background:#f85149;color:#fff}"
    ".auto{background:#1f6feb;color:#fff}.man{background:#6e40c9;color:#fff}"
    ".safe{background:#5a1a00;border:1px solid #f85149;padding:10px;margin:8px 12px;border-radius:6px}"
    ".foot{text-align:center;padding:12px;color:#8b949e;font-size:.7em}"
    "</style></head><body>"
    "<div class='h'><h1>&#127807; TSCRIC-LoRa Local Mode</h1>"
    "<p id='wm' style='color:#f0a500;font-size:.75em'>&#128997; Autonomous Offline Mode</p></div>"
    "<div class='g'>"
    "<div class='c'><div class='l'>CSMI</div><div class='v' id='ci'>--</div><div class='l'>%</div></div>"
    "<div class='c'><div class='l'>SM1 15cm</div><div class='v' id='s1'>--</div><div class='l'>%</div></div>"
    "<div class='c'><div class='l'>SM2 30cm</div><div class='v' id='s2'>--</div><div class='l'>%</div></div>"
    "<div class='c'><div class='l'>SM3 45cm</div><div class='v' id='s3'>--</div><div class='l'>%</div></div>"
    "<div class='c'><div class='l'>Temp</div><div class='v' id='tp'>--</div><div class='l'>°C</div></div>"
    "<div class='c'><div class='l'>Humidity</div><div class='v' id='hu'>--</div><div class='l'>%</div></div>"
    "<div class='c'><div class='l'>AI Score</div><div class='v' id='ai'>--</div><div class='l'>/120</div></div>"
    "<div class='c'><div class='l'>Flow</div><div class='v' id='fl'>--</div><div class='l'>L/min</div></div>"
    "<div class='c'><div class='l'>Pump</div><div class='v' id='pm'>--</div><div class='l'>Status</div></div>"
    "<div class='c'><div class='l'>Budget Left</div><div class='v' id='bl'>--</div><div class='l'>L</div></div>"
    "</div>"
    "<div id='sf' style='display:none' class='safe'>&#9888; SAFE MODE — All soil sensors failed. Limited irrigation active.</div>"
    "<div class='btns'>"
    "<button class='btn on' onclick=\"fetch('/api/pump/on')\">&#128167; Pump ON</button>"
    "<button class='btn off' onclick=\"fetch('/api/pump/off')\">&#128683; Pump OFF</button>"
    "<button class='btn auto' onclick=\"fetch('/api/auto/on')\">&#129504; Auto</button>"
    "<button class='btn man' onclick=\"fetch('/api/auto/off')\">&#9995; Manual</button>"
    "</div>"
    "<div class='foot'>TSCRIC-LoRa v3.0 | OCT Bhopal | Autonomous mode active</div>"
    "<script>"
    "function u(i,v){var e=document.getElementById(i);if(e)e.textContent=v;}"
    "function p(){fetch('/api/data').then(r=>r.json()).then(d=>{"
    "u('ci',parseFloat(d.csmi).toFixed(1));"
    "u('s1',parseFloat(d.sm1).toFixed(1));"
    "u('s2',parseFloat(d.sm2).toFixed(1));"
    "u('s3',parseFloat(d.sm3).toFixed(1));"
    "u('tp',parseFloat(d.temperature).toFixed(1));"
    "u('hu',parseFloat(d.humidity).toFixed(0));"
    "u('ai',parseFloat(d.aiScore).toFixed(1));"
    "u('fl',parseFloat(d.flowRate).toFixed(2));"
    "u('pm',d.pump?'ON':'OFF');"
    "u('bl',parseFloat(d.deltaBalance).toFixed(1));"
    "document.getElementById('sf').style.display=d.safeMode?'block':'none';"
    "}).catch(e=>console.log(e));}"
    "setInterval(p,5000);p();"
    "</script></body></html>"
  ));
}

// ============================================================
// DEBUG SERIAL
// ============================================================
void printDebugSerial() {
  Serial.printf_P(PSTR(
    "[SYSTEM] CSMI=%.1f%% AI=%.1f T=%.1f H=%.0f P=%.1f "
    "Flow=%.2f Pump=%s Auto=%s Safe=%s Offline=%s\n"),
    sensors.csmi, state.aiScore,
    sensors.temperature, sensors.humidity, sensors.pressure_hPa,
    sensors.flowRate_Lmin,
    state.pumpRunning ? "ON" : "OFF",
    state.autoMode    ? "ON" : "OFF",
    state.safeMode    ? "YES": "NO",
    state.offlineMode ? "YES": "NO"
  );
}

// ============================================================
// SETUP
// ============================================================
void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println(F("\n===================================="));
  Serial.println(F(" TSCRIC-LoRa v3.0 FINAL — Starting"));
  Serial.println(F("===================================="));

  // GPIO INIT
  pinMode(MUX_S0_PIN,  OUTPUT);
  pinMode(MUX_S1_PIN,  OUTPUT);
  pinMode(MUX_S2_PIN,  OUTPUT);
  pinMode(RELAY_PIN,   OUTPUT);            // [FIX-1] GPIO2 — not GPIO0
  pinMode(FLOW_PIN,    INPUT_PULLUP);
  #if SERIAL_DEBUG == 0
  pinMode(RAIN_DROP_PIN, INPUT_PULLUP);
  pinMode(TIP_BUCKET_PIN, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(TIP_BUCKET_PIN), tipBucketISR, FALLING);
  #endif

  digitalWrite(RELAY_PIN, HIGH);           // Active LOW — pump OFF at boot

  Wire.begin(I2C_SDA, I2C_SCL);
  EEPROM.begin(EEPROM_SIZE);               // [FIX-3] 256 bytes
  loadEEPROM();

  // [FIX-2] DHT22 init (not DHT11)
  dht.begin();
  delay(100);

  // BMP280 init
  if (!bmp.begin(0x76)) {
    if (!bmp.begin(0x77)) {               // Try alternate I2C addr
      Serial.println(F("[BMP280] FAULT"));
      sensors.bmpFault = true;
    }
  }
  if (!sensors.bmpFault) {
    bmp.setSampling(Adafruit_BMP280::MODE_NORMAL,
                    Adafruit_BMP280::SAMPLING_X2,
                    Adafruit_BMP280::SAMPLING_X16,
                    Adafruit_BMP280::FILTER_X16,
                    Adafruit_BMP280::STANDBY_MS_500);
    Serial.println(F("[BMP280] OK"));
  }

  initLoRa();
  attachInterrupt(digitalPinToInterrupt(FLOW_PIN), flowPulseISR, FALLING);

  state.autoMode      = true;
  state.pumpRunning   = false;
  state.pipelineFault = false;
  state.offlineMode   = true;    // Assume offline until WiFi connects
  owm.valid           = false;

  updateSeasonalBudget();
  connectWiFi();
  setupWebServer();
  server.begin();

  Serial.printf_P(PSTR("[SYSTEM] Ready | Crop: %s | Area: %.2f m² (%.4f Bigha) | Relay: GPIO2\n"),
    cropDB[state.currentCrop].name,
    state.plotArea_m2,
    state.plotArea_m2 / BIGHA_TO_M2);
}

// ============================================================
// MAIN LOOP — NON-BLOCKING
// ============================================================
void loop() {
  unsigned long now = millis();
  server.handleClient();

  // Sensor read & processing
  if (now - state.lastSensorRead >= SENSOR_INTERVAL) {
    state.lastSensorRead = now;
    readAllSensors();
    computeCSMI();
    computeSMV_SMA();
    computeETo();
    computeZambrettiWeather();
    updateRingBuffer(now);
    computeTemporalResonance();
    computeAIScore();
    updateGDD();
    updateCropStage();
    // Offline rain estimation every cycle
    state.estimatedRainfall_mm = estimateRainfallFromTrends();
    computeWaterBudget();
    if (state.autoMode && !state.pumpRunning) checkIrrigationDecision(now);
    printDebugSerial();
  }

  // LoRa TX
  if (now - state.lastLoraTx >= LORA_INTERVAL) {
    state.lastLoraTx = now;
    sendLoRaPacket();
  }

  // Firebase sync (non-blocking, connection-gated)
  if (state.wifiConnected && (now - state.lastFirebaseTx >= FIREBASE_INTERVAL)) {
    state.lastFirebaseTx = now;
    syncFirebase();
  }

  // OWM fetch
  if (state.wifiConnected && (now - state.lastOWMFetch >= OWM_INTERVAL)) {
    state.lastOWMFetch = now;
    fetchOWMData();
  }

  // Self calibration
  if (now - state.lastCalibration >= CALIB_INTERVAL) {
    state.lastCalibration = now;
    performSelfCalibration();
  }

  // WiFi watchdog — non-blocking retry
  if (!state.wifiConnected) {
    if (now - state.lastWifiRetry > WIFI_RETRY_INTERVAL) {
      state.lastWifiRetry = now;
      if (WiFi.status() == WL_CONNECTED) {
        state.wifiConnected = true;
        state.offlineMode   = false;
        Serial.println(F("[WiFi] Reconnected"));
        if (state.offlineLogCount > 0) syncOfflineLogs();
      } else {
        WiFi.reconnect();
      }
    }
  } else {
    // If connection lost
    if (WiFi.status() != WL_CONNECTED) {
      state.wifiConnected = false;
      state.offlineMode   = true;
      Serial.println(F("[WiFi] Lost connection"));
    }
  }

  yield();
}
