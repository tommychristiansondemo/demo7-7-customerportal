> **DISCLAIMER:** This document is entirely fictional and created for educational demonstration purposes only. All manufacturer names, model names, part numbers, and technical details are synthetic. No real vehicle data, proprietary OEM information, or actual service procedures are represented.

---

# Technical Service Bulletin: TSB-DEMO-015

## Metadata

| Field | Value |
|-------|-------|
| document_id | TSB-DEMO-015 |
| vehicle_system | ev_battery |
| severity_keywords | charging, connector, error, intermittent |
| tsb_number | TSB-DEMO-015 |

## Affected Vehicles

- Zephyr Motors Volt-IX (2022–2024)
- Zephyr Motors Volt-IX GT (2024)
- Zephyr Motors Aura EV (2023–2024)

## Symptom Description

Vehicle fails to initiate AC Level 2 charging sessions intermittently. The charge port LED flashes amber three times then turns off, and the vehicle displays "Charge Session Could Not Start — Retry" on the instrument cluster. The issue occurs with multiple different EVSE units (both 32A and 48A), ruling out charger-side faults. DC fast charging operates normally. Some owners report that unplugging and re-inserting the J1772 connector 2–3 times eventually establishes a successful session.

## Root Cause

The AC charging pilot signal detection circuit on the onboard charger control board contains a comparator (U14) with a reference voltage that drifts +80 mV above specification at temperatures between 5°C and 15°C. This causes the pilot signal state transition from State B (vehicle detected) to State C (charging) to be intermittently missed during the initial handshake period. The fault window is narrow (approximately 200 ms) which explains why retry attempts often succeed. DC fast charging uses a separate CCS communication path and is unaffected.

## Corrective Action

1. Update onboard charger firmware to version 3.1.4 which extends the pilot signal detection window from 500 ms to 1200 ms and adds a secondary validation pass.
2. If firmware update alone does not resolve the issue, inspect comparator U14 reference voltage on the AC charger control board. If reference measures above 2.58 V (specification: 2.50 V ±50 mV), replace the charger control board assembly.
3. Inspect J1772 inlet connector pins for carbon deposits or pitting that could introduce contact resistance on the pilot signal pin (Pin 4).
4. Clean pilot signal pin with electronic contact cleaner and verify resistance below 0.5 Ω from pin tip to control board test point TP7.
5. Perform five consecutive charge session initiation tests across both 32A and 48A EVSE units to confirm resolution.

## Parts Required

| Part Number | Description |
|-------------|-------------|
| ZM-EV-9901 | Onboard charger firmware update module (v3.1.4) |
| ZM-EV-9910 | AC charger control board assembly (if U14 out of spec) |
| ZM-EV-9915 | J1772 inlet connector pin cleaning kit |
| ZM-EV-9920 | Pilot signal test harness |
| ZM-EV-9925 | Charge port LED indicator module (if damaged during inspection) |
