> **DISCLAIMER:** This document is entirely fictional and created for educational demonstration purposes only. All manufacturer names, model names, part numbers, and technical details are synthetic. No real vehicle data, proprietary OEM information, or actual service procedures are represented.

---

# Technical Service Bulletin: TSB-DEMO-009

## Metadata

| Field | Value |
|-------|-------|
| document_id | TSB-DEMO-009 |
| vehicle_system | adas |
| severity_keywords | sensor, calibration, parking |
| tsb_number | TSB-DEMO-009 |

## Affected Vehicles

- Nebula Cars Horizon (2022–2024)
- Nebula Cars Horizon Cross (2022–2024)

## Symptom Description

Parking assist sensors provide inaccurate distance readings, underreporting obstacle distance by 20–40 cm on the rear bumper sensors (positions 2 and 3). Drivers report near-contact events during automated parking maneuvers. The parking camera overlay graphics show green (safe) indicators when the actual clearance is less than the displayed safe zone. No diagnostic codes are stored.

## Root Cause

The ultrasonic parking sensor mounting brackets for rear positions 2 and 3 allow the sensors to shift by up to 3 degrees from their factory-calibrated angle after repeated exposure to high-pressure car wash jets or minor parking impacts. The shifted sensor angle causes the echo return timing calculation to underestimate distance to flat surfaces directly behind the vehicle while overestimating distance to curved or angled surfaces.

## Corrective Action

1. Inspect rear parking sensor mounting brackets at positions 2 and 3 for any deformation or looseness.
2. Replace mounting brackets with revised design featuring positive-lock retention tabs and increased wall thickness.
3. Reinstall sensors with calibrated torque (0.8 Nm) and apply thread-locking compound to mounting screws.
4. Perform parking sensor calibration procedure using the four-post reference target setup.
5. Validate distance accuracy at 30 cm, 60 cm, and 120 cm reference distances.

## Parts Required

| Part Number | Description |
|-------------|-------------|
| NC-PK-9201 | Revised sensor mounting bracket (position 2) |
| NC-PK-9202 | Revised sensor mounting bracket (position 3) |
| NC-PK-9210 | Thread-locking compound applicator |
| NC-PK-9215 | Calibration reference target set (4-post) |
| NC-PK-9220 | Sensor connector seal ring kit |
