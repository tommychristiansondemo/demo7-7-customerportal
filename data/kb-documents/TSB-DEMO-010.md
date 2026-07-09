> **DISCLAIMER:** This document is entirely fictional and created for educational demonstration purposes only. All manufacturer names, model names, part numbers, and technical details are synthetic. No real vehicle data, proprietary OEM information, or actual service procedures are represented.

---

# Technical Service Bulletin: TSB-DEMO-010

## Metadata

| Field | Value |
|-------|-------|
| document_id | TSB-DEMO-010 |
| vehicle_system | infotainment |
| severity_keywords | connectivity, bluetooth, audio |
| tsb_number | TSB-DEMO-010 |

## Affected Vehicles

- Solaris Motors Aria (2022–2024)
- Solaris Motors Aria Luxury (2022–2024)

## Symptom Description

Bluetooth audio streaming disconnects intermittently after 15–45 minutes of continuous playback. When disconnection occurs, the infotainment system displays "Device Not Found" and requires manual re-pairing. Phone call audio via Bluetooth hands-free is unaffected. The issue occurs across multiple phone brands and Bluetooth versions (4.2 through 5.3).

## Root Cause

The infotainment head unit Bluetooth module shares an internal USB bus with the wireless Apple CarPlay/Android Auto adapter. During extended A2DP (audio streaming) sessions, the wireless adapter periodically polls for new device connections, generating USB bus contention that causes the Bluetooth module to drop its A2DP connection while maintaining the HFP (hands-free) connection on a separate logical channel.

## Corrective Action

1. Update infotainment head unit firmware to version 8.4.1 which implements USB bus arbitration priority for active audio streams.
2. Update wireless connectivity adapter firmware to version 2.3.0 which reduces polling frequency during active Bluetooth audio sessions.
3. Clear all paired device records from the infotainment system after update.
4. Re-pair customer devices and verify 60-minute continuous audio streaming stability.

## Parts Required

| Part Number | Description |
|-------------|-------------|
| SM-IF-3301 | Head unit firmware update USB drive |
| SM-IF-3305 | Wireless adapter firmware update cable |
| SM-IF-3310 | USB bus diagnostic adapter (for verification) |
