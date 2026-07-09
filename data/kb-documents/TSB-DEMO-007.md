> **DISCLAIMER:** This document is entirely fictional and created for educational demonstration purposes only. All manufacturer names, model names, part numbers, and technical details are synthetic. No real vehicle data, proprietary OEM information, or actual service procedures are represented.

---

# Technical Service Bulletin: TSB-DEMO-007

## Metadata

| Field | Value |
|-------|-------|
| document_id | TSB-DEMO-007 |
| vehicle_system | adas |
| severity_keywords | safety, braking, false_activation |
| tsb_number | TSB-DEMO-007 |

## Affected Vehicles

- Quantum Drive Sentinel (2022–2024)
- Quantum Drive Sentinel GT (2023–2024)

## Symptom Description

Automatic emergency braking (AEB) system activates unexpectedly when approaching metal bridge expansion joints or passing under overhead highway signs at speeds between 50–80 km/h. Driver experiences sudden deceleration with "Collision Warning" displayed. No actual obstacle is present. Events occur more frequently in low-sun-angle conditions (dawn/dusk).

## Root Cause

The forward-facing radar module misinterprets the radar return signature from certain metal bridge expansion joints and overhead sign gantries as stationary obstacles in the vehicle path. The radar processing firmware version 1.4.x does not adequately filter metallic ground-plane reflections that create phantom targets with apparent closing velocities above the AEB activation threshold. Low sun angles contribute by causing the camera fusion system to lose confidence in its "no obstacle" classification, allowing the radar-only path to dominate the decision.

## Corrective Action

1. Update forward radar module firmware to version 2.1.0 which includes improved ground-plane clutter rejection and bridge overpass classification algorithms.
2. Recalibrate forward radar module using the approved static target alignment procedure.
3. Update camera fusion module software to version 3.0.2 for improved low-light confidence scoring.
4. Perform a 15-minute dynamic calibration drive on a controlled route to validate system operation.

## Parts Required

| Part Number | Description |
|-------------|-------------|
| QD-AD-1101 | Radar firmware update module |
| QD-AD-1105 | Radar calibration target reflector |
| QD-AD-1110 | Camera fusion ECU software cartridge |
| QD-AD-1115 | Radar alignment bracket (if damaged during service) |
