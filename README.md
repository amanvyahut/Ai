# 🌾 TSCRIC-LoRa — Smart Irrigation Dashboard

> **Temporal Soil-Crop Resonance Irrigation Controller** — A comprehensive web-based smart irrigation management system with AI-powered advisory, multi-sensor integration, and autonomous offline capabilities.

![Status](https://img.shields.io/badge/Status-Production-brightgreen)
![Language](https://img.shields.io/badge/Language-JavaScript-yellow)
![License](https://img.shields.io/badge/License-MIT-blue)
![Version](https://img.shields.io/badge/Version-3.1-orange)

---

## 📋 Overview

TSCRIC-LoRa is an advanced irrigation management system designed for smart agriculture. It leverages IoT sensors, cloud APIs, and AI to optimize water usage while maintaining crop health. The system features tri-depth soil monitoring, real-time environmental sensing, and intelligent irrigation scheduling based on crop water requirements.

### 🎯 Key Features

- **🌱 Tri-Depth Soil Moisture Monitoring** — 15cm, 30cm, 45cm sensors
- **📡 Dual Data Sources** — Local sensors + OpenWeatherMap API with smart fallback
- **🤖 AI Farm Assistant** — Powered by Google Gemini for crop advisory
- **💧 Water Budget Accounting** — Track seasonal water allocation and usage
- **🌧️ Rainfall Analytics** — Tipping bucket, cloud API, and trend-based estimation
- **📊 Real-Time Dashboards** — Environmental sensors, health status, irrigation logs
- **🔐 Secure Authentication** — Password-protected access with offline capability
- **📱 Responsive Web Design** — Works on desktop, tablet, and mobile
- **🔌 Offline-Capable** — LoRa fallback and autonomous mode
- **⚡ Auto & Manual Pump Control** — Intelligent scheduling with fault detection

---

## 🏗️ Project Structure

```
amanvyahut/AI/
├── index.html          # Main dashboard UI (708 lines)
├── app.js              # Core logic & Firebase integration (150KB+)
├── style.css           # Responsive styling & dark theme (39KB+)
├── .github/            # GitHub workflows & CI/CD
├── manifest.json       # PWA manifest (for offline support)
└── README.md           # This file
```

### 📁 Key Files

| File | Purpose |
|------|---------|
| `index.html` | Complete UI layout with all dashboard panels, charts, and controls |
| `app.js` | Firebase real-time database, sensor data processing, AI integration |
| `style.css` | Dark mode styling, responsive grid layouts, animations |

---

## 🔧 Technology Stack

### Frontend
- **HTML5** — Semantic markup with PWA support
- **CSS3** — Flexbox/Grid, dark theme, animations
- **Vanilla JavaScript** — No external dependencies (lightweight)

### Backend & Services
- **Firebase Realtime Database** — Real-time data sync with IoT devices

- **OpenWeatherMap API** — Weather forecasting & rainfall data
- **LoRa Communication** — Autonomous offline mesh network

### Hardware Integration
- **ESP8266** — WiFi microcontroller
- **SX1278 LoRa Module** — Long-range communication
- **Capacitive Soil Sensors** — 3x moisture sensors at different depths
- **DHT22** — Temperature & humidity sensor
- **BMP280** — Atmospheric pressure & altitude
- **YF-S201** — Flow rate sensor
- **Tipping Bucket** — Rainfall gauge

---

## 🚀 Getting Started

### Prerequisites
- Modern web browser (Chrome, Firefox, Safari, Edge)
- Firebase project credentials
- OpenWeatherMap API key
- Google Generative AI API key (for Gemini)
- IoT device running compatible ESP8266 firmware

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/amanvyahut/AI.git
   cd AI
   ```

2. **Open in browser**
   ```bash
   # Using Python (local server recommended)
   python -m http.server 8000
   
   # Or use any static server
   # Then visit: http://localhost:8000
   ```

3. **Configure Firebase**
   - Update Firebase credentials in `app.js`
   - Create database structure matching the app's expectations
   - Set up real-time listeners for sensor data

4. **Add API Keys**
   - OpenWeatherMap API key
   - Insert into `app.js` where indicated

5. **Login**
   - Default dashboard password (set in Firebase or hardcoded)
   - Access admin panel for configuration

---

## 📊 Dashboard Sections

### 1. **🔐 Authentication**
- Secure login with password protection
- Session management
- Logout functionality

### 2. **⚙️ Farm Configuration**
- Crop selection (Wheat, Rice, Maize, Cotton, Soybean, Chickpea, Mustard, Sugarcane)
- Plot area input (m² or Bigha units)
- Weather location selection (MP cities + major Indian cities)
- Water budget preview

### 3. **🌐 Online/Offline Status**
- WiFi & Firebase connection status
- LoRa fallback availability
- OpenWeatherMap API health
- Cloud vs Local sensor comparison
- Fallback badge indicators

### 4. **🤖 AI Score Hero**
- **SMV** — Soil Moisture Velocity (%/hr)
- **SMA** — Soil Moisture Acceleration (%/hr²)
- **TPR** — Temporal Precipitation Ratio (cos θ)
- **ETo** — Reference Evapotranspiration (mm/day)
- **Rain Probability** — Forecast confidence

### 5. **🩺 Sensor Health Status**
- SM1, SM2, SM3 soil moisture sensors
- DHT22 temperature/humidity
- BMP280 pressure
- YF-S201 flow sensor
- LoRa module status

### 6. **🌱 Tri-Depth Soil Profile**
- Individual depth readings (15, 30, 45 cm)
- CSMI (Crop Soil Moisture Index) weighted average
- Visual progress bars with color coding

### 7. **📡 Environmental Sensors**
- Local temperature (DHT22) vs Cloud (OWM)
- Humidity comparison
- Pressure monitoring
- Real-time flow rate

### 8. **🌧️ Rainfall Analytics**
- **Priority 1** — Tipping bucket (most accurate)
- **Priority 2** — OpenWeatherMap API
- **Priority 3** — Trend estimation
- **Effective Rainfall** — Applied to water balance
- Rain probability forecast bar

### 9. **💧 Water Budget Accounting**
- Total irrigation applied (L)
- Rainfall contribution
- Seasonal requirement
- Balance remaining
- Budget utilization percentage

### 10. **📊 Remaining Irrigation Analytics**
- Water remaining to meet seasonal delta
- Estimated days remaining
- Irrigation efficiency %

### 11. **🔬 Soil Calibration Engine**
- ADC value calibration (Dry, FC, PWP)
- VWC (Volumetric Water Content) input
- Per-sensor fine-tuning
- Automatic EEPROM persistence

### 12. **⚙️ Pump Control**
- Real-time pump status
- Manual ON/OFF buttons
- Auto/Manual mode toggle
- Pipeline fault detection
- Autonomous operation

### 13. **📋 Irrigation Event Log**
- Timestamp, CSMI, AI Score
- Dose applied (L)
- Trigger reason
- Historical event table

### 14. **🤖 AI Farm Assistant** 
- Natural language Q&A interface
- Quick question chips (Pump, Rain, Soil, Water, etc.)
- Auto-analysis feature
- Advisory-only (non-controlling)
- Context-aware responses

---

## 💾 Data Structure (Firebase)

```json
{
  "farms": {
    "farmId": {
      "config": {
        "crop": 0,
        "plotAreaM2": 6,
        "weatherLocation": "bhopal"
      },
      "sensors": {
        "sm1": 45.2,
        "sm2": 38.5,
        "sm3": 42.1,
        "temp": 28.3,
        "humidity": 65,
        "pressure": 1013.25,
        "flowRate": 2.1
      },
      "calibration": {
        "sensor_0": { "dry": 850, "fc": 600, "pwp": 750 },
        "sensor_1": { "dry": 845, "fc": 595, "pwp": 745 },
        "sensor_2": { "dry": 855, "fc": 605, "pwp": 755 }
      },
      "irrigation": {
        "mode": "auto",
        "pumpStatus": "off",
        "applied": 45000,
        "lastTrigger": "CSMI threshold"
      }
    }
  }
}
```

---

## 🔌 API Integration

### OpenWeatherMap
- **Endpoint** — `/weather?q={city}&appid={key}`
- **Data** — Temperature, humidity, pressure, rainfall, clouds
- **Fallback** — Local sensor data if API fails

### Google Generative AI (Gemini)
- **Model** — `gemini-pro`
- **Context** — Current farm state (CSMI, sensors, water budget, etc.)
- **Response** — Advisory recommendations, not automated actions

---

## 📱 Responsive Design

| Device | Support |
|--------|---------|
| Desktop | ✅ Full functionality |
| Tablet | ✅ Optimized layout |
| Mobile | ✅ Touch-friendly buttons |
| PWA | ✅ Offline capability |

---

## 🔐 Security Features

- **Password Protection** — Login screen with session management
- **Firebase Rules** — Real-time database access control
- **API Key Management** — Secure credential handling
- **Advisory Only** — AI cannot execute commands
- **Offline Mode** — Works without internet via LoRa

---

## ⚙️ Configuration

### Crop Selection
Default crops included with crop-specific water requirements and growth stages.

### Weather Locations
- **Madhya Pradesh** — Bhopal, Indore, Jabalpur, Gwalior, etc. (12 cities)
- **Other India** — Delhi, Mumbai, Pune, Bangalore, etc. (15 cities)

### Units
- **Area** — m² or Bigha (1 Bigha = 1333.33 m²)
- **Water** — Liters (L)
- **Soil Moisture** — Percentage (%)
- **Temperature** — Celsius (°C)
- **Pressure** — hPa

---

## 🎓 Educational Context

**Project** — TSCRIC-LoRa v3.1  
**Institution** — Oriental College of Technology, Bhopal  
**Department** — Civil Engineering  
**Year** — 2025–2026  
**Guide** — Dr. Yogesh Iyer Murthy  
**Team** — AMAN KUMAR, Aditya Kumar, Akash Khandgre, Akash Kumar  

---

## 📝 Key Concepts

### CSMI (Crop Soil Moisture Index)
Weighted average of tri-depth readings:
```
CSMI = (SM1 × 0.2) + (SM2 × 0.5) + (SM3 × 0.3)
```

### Water Budget
```
Balance = Seasonal Requirement - Irrigation Applied - Rainfall
Efficiency = (Applied + Rainfall) / Required × 100%
```

### ETo (Reference Evapotranspiration)
Calculated based on temperature, humidity, pressure, and solar radiation using Penman-Monteith method.

### AI Score
Composite indicator combining:
- Soil moisture velocity and acceleration
- Rainfall probability
- Evapotranspiration rate
- Plant water stress index

---

## 🛠️ Troubleshooting

| Issue | Solution |
|-------|----------|
| Sensors not updating | Check WiFi/Firebase connectivity, verify EEPROM calibration |
| OWM API fails | Verify API key, check rate limits, fall back to local sensors |
| Pump not responding | Check device power, verify Firebase sync, review fault logs |
| Login fails | Clear cookies/cache, verify password in Firebase |
| Offline mode inactive | Ensure LoRa hardware connected, check antenna, verify range |

---

## 📚 References

- [Firebase Realtime Database](https://firebase.google.com/docs/database)
- [OpenWeatherMap API](https://openweathermap.org/api)
- [Google Generative AI](https://ai.google.dev/)
- [IoT & LoRa Communication](https://www.thethingsnetwork.org/)
- [Crop Water Requirements (FAO)](http://www.fao.org/3/x0490e/x0490e00.htm)

---

## 📄 License

MIT License — See LICENSE file for details.

---

## 📞 Support

For issues, feature requests, or contributions:
- Open an [Issue](https://github.com/amanvyahut/AI/issues)
- Submit a [Pull Request](https://github.com/amanvyahut/AI/pulls)
- Contact: kumaraman5214@gmail.com

---

## 🎉 Acknowledgments

Built with ❤️ for sustainable agriculture and intelligent water resource management. Special thanks to Oriental College of Technology, Bhopal and all contributors.

**Last Updated** — May 12, 2026
