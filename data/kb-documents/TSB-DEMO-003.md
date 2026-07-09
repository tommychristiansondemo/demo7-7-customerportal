> **DISCLAIMER:** This document is entirely fictional and created for educational demonstration purposes only. All manufacturer names, model names, part numbers, and technical details are synthetic. No real vehicle data, proprietary OEM information, or actual service procedures are represented.

---

# Technical Service Bulletin: TSB-DEMO-003

## Metadata

| Field | Value |
|-------|-------|
| document_id | TSB-DEMO-003 |
| vehicle_system | ev_battery |
| severity_keywords | safety, isolation, fault |
| tsb_number | TSB-DEMO-003 |

## Affected Vehicles

- Stratos Electric Wanderer EV (2023–2024)
- Stratos Electric Wanderer EV Long Range (2023–2024)

## Symptom Description

Vehicle enters reduced power mode with "Isolation Fault Detected" displayed on the driver information center. Diagnostic scan reveals DTC related to high-voltage battery isolation resistance falling below 500 kΩ. Condition is intermittent and more frequent in high-humidity environments or after vehicle wading through standing water deeper than 15 cm.

## Root Cause

The battery pack lower enclosure seal at the rear service panel uses a single-bead adhesive application that is insufficient to maintain IP67 rating under repeated thermal expansion cycles. Moisture ingress through the compromised seal contacts the high-voltage bus bar insulation monitoring circuit, causing the isolation resistance reading to drop below the safety threshold.

## Corrective Action

1. Remove the battery pack rear service panel and inspect for moisture intrusion evidence.
2. Clean and dry all affected connector surfaces using approved dielectric solvent.
3. Apply revised dual-bead sealant using the updated application fixture (special tool required).
4. Replace the isolation monitoring sensor if resistance does not recover above 1 MΩ after drying.
5. Perform a 48-hour soak test at 90% humidity to confirm repair integrity.
6. Clear all related diagnostic codes and reset isolation monitoring baseline.

## Parts Required

| Part Number | Description |
|-------------|-------------|
| SE-WD-3301 | Revised dual-bead sealant kit |
| SE-WD-3302 | Sealant application fixture tool |
| SE-WD-3310 | Isolation monitoring sensor assembly |
| SE-WD-3315 | Dielectric cleaning solvent (500 mL) |
| SE-WD-3320 | Service panel gasket set |
| SE-WD-3325 | Bus bar insulation wrap (2 m roll) |
