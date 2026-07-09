> **DISCLAIMER:** This document is entirely fictional and created for educational demonstration purposes only. All manufacturer names, model names, part numbers, and technical details are synthetic. No real vehicle data, proprietary OEM information, or actual service procedures are represented.

---

# Technical Service Bulletin: TSB-DEMO-012

## Metadata

| Field | Value |
|-------|-------|
| document_id | TSB-DEMO-012 |
| vehicle_system | infotainment |
| severity_keywords | navigation, GPS, software |
| tsb_number | TSB-DEMO-012 |

## Affected Vehicles

- Solaris Motors Horizon EV (2023–2024)
- Solaris Motors Horizon Hybrid (2022–2024)

## Symptom Description

Navigation system displays incorrect vehicle position, often showing the vehicle offset by 50–200 meters from actual road position. The issue is most pronounced in urban canyon environments (tall buildings on both sides). After ignition cycling, position accuracy temporarily improves for 5–10 minutes before drifting again. Customers also report that route recalculation occurs excessively (every 30–60 seconds) during normal driving on known routes.

## Root Cause

The GNSS receiver firmware (version 2.3.x) contains a sensor fusion algorithm defect where the inertial measurement unit (IMU) drift correction weight is set too low after a cold start. The IMU accumulated error exceeds the correction threshold, causing the position filter to diverge from the satellite fix. Additionally, the map-matching algorithm fails to re-anchor the position when the GNSS signal quality indicator drops below 4 satellites, which occurs frequently in multipath environments.

## Corrective Action

1. Update GNSS receiver firmware to version 2.4.2 which increases IMU correction weighting during the first 15 minutes after cold start.
2. Update navigation software to version 8.1.0 which improves map-matching anchor point logic for urban environments.
3. Verify GPS antenna cable connection at the roof-mounted antenna base (torque to 0.8 Nm).
4. Perform a GNSS receiver cold reset and allow a 10-minute stationary satellite acquisition in an open-sky environment.
5. Confirm position accuracy within 5 meters during a 20-minute test drive through mixed urban and highway conditions.

## Parts Required

| Part Number | Description |
|-------------|-------------|
| SM-NV-6601 | GNSS receiver firmware update module |
| SM-NV-6610 | Navigation software update USB drive |
| SM-NV-6620 | GPS antenna cable (if damaged during inspection) |
| SM-NV-6625 | Antenna base gasket seal |
| SM-NV-6630 | IMU recalibration tool license key |
