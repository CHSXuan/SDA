# AirPods periodic output interruption — 2026-09-13

## Evidence

Windows Audio/Operational event 65 reports the AirPods stereo endpoint changing from ACTIVE (1) to UNPLUGGED (8) and back roughly every 50 seconds. SDA receives AUDCLNT_E_DEVICE_INVALIDATED (0x88890004). The endpoint interruptions continued with SdaNativeRenderer stopped, so they do not require the SDA output process.

A second controlled test temporarily disabled only the SDA AACP motion device for 120 seconds. Interruptions remained at 14:24:57 and 14:25:47 UTC. The script restored the motion device successfully. This excludes that device's active operation as a necessary trigger in this observation; it does not identify the underlying Bluetooth cause.

## Completed

- Native output retries the selected endpoint after invalidation, without falling back to another device.
- Device discovery reads the endpoint format property rather than activating an audio client every second. This did not eliminate the periodic endpoint interruptions.
- Three recovery/property parsing regression tests passed.
- Hardware confirmed: Intel AX201, ASUS TUF Gaming F15 FX506LI.
- Old Bluetooth driver 22.150.0.6 (oem135.inf) exported to `D:/SDA/tmp/bluetooth-driver-repair/backup-22.150`.
- Installed Intel official Bluetooth driver 24.70.0.4 (oem158.inf). Authenticode signature valid, publisher Intel Corporation; SHA-256 matched the official page: `001DF2E294E86D051645EA1367F4A19518CA8C2A52782CDD4C1CB81C3C0F038A`.
- Official source: https://www.intel.com/content/www/us/en/download/18649/intel-wireless-bluetooth-for-windows-10-and-windows-11.html

## Required next verification

The MSI log explicitly requests a Windows restart, despite the wrapper returning exit code 0. No system restart was initiated. After restart, verify the active driver version and play for at least 3 minutes, correlating audio with endpoint events and SDA output/underrun logs. Do not claim the interruption fixed before this verification.

Local evidence: `tmp/bluetooth-motion-isolation-result.json`, `tmp/bluetooth-driver-repair/result.json`, `tmp/bluetooth-driver-repair/install.log`, and Windows Audio/Operational log.
