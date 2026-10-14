# The Pill by Shelly

Monitors sensors attached to a [The Pill by Shelly](https://us.shelly.com/products/the-pill-by-shelly) (Gen3) — temperature probes, humidity, voltage, digital inputs and outputs — as Companion variables, feedbacks and buttons.

## Setup

1. Pick the Pill from the **Device** list (or choose **Manual** and type its IP address). That's it — sensors are found
   automatically and appear as variables within a second or two. The list may show the same Pill twice (its
   `shellypill-<mac>` name and its friendly name); either works. The address is captured when you pick it, so give the
   Pill a **DHCP reservation** in your router. Without one, use Manual with `<device-id>.local` (e.g.
   `shellypill-9070694614d4.local`): it follows the Pill to a new address but is slower, and mDNS on Windows varies.
2. Drag a preset from **Temperature** (or Humidity / Voltage / Inputs / Switches) onto a button.
   Sensor presets already include a grey **OFFLINE** overlay (shown whenever the reading is not real), and temperature
   presets turn amber at 27 °C / 81 °F and red at 32 °C / 90 °F (ASHRAE recommended / allowable inlet limits). The
   thresholds are per button: edit the feedbacks on the button to change them. The **Device** preset shows the Pill's
   name and WiFi signal, turns red `PILL OFFLINE` when it stops answering, and refreshes when pressed.
3. Leave **Push updates over WebSocket** on. Companion connects to the device's own WebSocket, so readings arrive the moment they change. Nothing on the device is changed and nothing reboots.

Temperatures are always published in both °C and °F. Pick the unit per button — each sensor gets a preset in each scale, and every temperature feedback has its own **Unit** dropdown.

## Configuration

| Setting                         | Description                                                  |
| ------------------------------- | ------------------------------------------------------------ |
| **Device**                      | Pill found on the network, or Manual.                        |
| **Device IP / hostname**        | Manual only. IP, or `<device-id>.local` (no `http://`).      |
| **Password**                    | Only if device auth is enabled (username is always `admin`). |
| **Push updates over WebSocket** | On by default. See _Push updates_ below.                     |
| **Logging**                     | Normal / Verbose / Trace. See below.                         |
| **Poll interval**               | Fallback while push is off or unavailable. Default 1000 ms.  |

## Variables

| Variable                                                                                                                           | Description                                                |
| ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `temp_<id>_c` / `temp_<id>_f`                                                                                                      | Temperature in each scale (e.g. `temp_200_c`)              |
| `humidity_<id>`                                                                                                                    | Relative humidity %                                        |
| `voltmeter_<id>`                                                                                                                   | Measured pin voltage (V)                                   |
| `voltmeter_<id>_x`                                                                                                                 | Scaled value, when a transformation is set (0–30 V add-on) |
| `input_<id>`                                                                                                                       | Input state — On/Off, analog %, or count                   |
| `switch_<id>`                                                                                                                      | Switch output state                                        |
| `script_<id>_running`                                                                                                              | Whether a script is running                                |
| `device_name`, `device_model`, `firmware`, `uptime`, `uptime_text`, `wifi_rssi`, `wifi_ip`, `update_available`, `restart_required` | Device info                                                |

Peripheral IDs start at 200 and count up per pin — five probes are `temperature:200` … `temperature:204`.

## Feedbacks

- **Temperature above / below threshold** — with a °C/°F dropdown
- **Humidity above / below threshold**
- **Voltage above / below threshold** — uses the scaled value when available
- **Digital input is in state** — on/closed or off/open
- **Switch is on**
- **Script is running**
- **Sensor has an error / no reading**
- **Device is offline**

## Actions

- **Temperature: Rename sensor** — labels and presets refresh automatically
- **Switch: Set state** — on / off / toggle
- **Script: Start / Stop / Toggle** — the preset toggles, **Script: Eval code in running script**
- **Custom RPC call** — any [Shelly Gen2+ method](https://shelly-api-docs.shelly.cloud/gen2/) with JSON params
- **Reboot device**, **Refresh status now**

Actions and feedbacks for a component type the Pill doesn't have (e.g. switches) are hidden once it has been read.

`Shelly.FactoryReset` and `Shelly.ResetWiFiConfig` are blocked from Custom RPC — a mis-click on a surface would be unrecoverable. Use the device web UI.

## Device health and calibration

- `update_available` — stable firmware version on offer, or `None`; `restart_required` — `Yes`/`No`; `uptime_text` — e.g. `1d 2h 3m`. Watch them with Companion's internal variable-check feedback.
- **Learn** on any above/below feedback sets its threshold to the current reading.
- **Temperature: Calibrate sensor** — writes the probe's `offset_C` (added to every reading) and `report_thr_C` (minimum change before the device pushes a new value) via `Temperature.SetConfig`.

## Peripheral support

| Pill mode                      | Components                           | Status                |
| ------------------------------ | ------------------------------------ | --------------------- |
| Temperature, DS18B20 (up to 5) | `temperature:<id>`                   | Verified on hardware  |
| Digital input                  | `input:<id>`                         | Verified on hardware  |
| Digital output / SSR add-on    | `switch:<id>`                        | Verified on hardware  |
| Temperature & humidity, DHT22  | `temperature:<id>` + `humidity:<id>` | Implemented, untested |
| Analog input / voltmeter       | `voltmeter:<id>`                     | Implemented, untested |

Digital I/O combines with any mode, set per pin in the device web UI under _Pill configuration_ (no reboot needed).

## Push updates

Companion opens a WebSocket to the device (`ws://<device>/rpc`) and the device pushes each reading as it changes. Traffic scales with how often values change, not with sensor count — leave this on if you have several sensors.

- Nothing on the device is configured and nothing reboots. Several Companions can connect to the same device at once.
- A ping every 5 s detects a device that lost power; two missed replies close the socket.
- While connected, the module still polls every 15s as a safety net. An unplugged sensor reads `-` within 15 s; the
  yellow _Sensor offline_ status follows on the next safety poll (~30 s). The device deletes the component silently
  instead of raising an event, so only a poll catches it.
- If the socket drops, it falls back to the poll interval immediately and reconnects on its own (2 s, backing off to 30 s).
- **Upgrading from 1.8.x:** that version set the device's _Settings → Outbound WebSocket_ to point at Companion. It is no longer used — turn it off in the device web UI so the device stops dialling an address nobody listens on.

## Gotchas

**Renaming a sensor doesn't change buttons you already made.** Variables, dropdown labels and presets all refresh within a second. But dragging a preset _copies_ its text into the button, and the module can't reach back in — the name there is literal text. Edit the button, or re-drag the preset. Reconnecting won't help.

**The Pill's own limits are narrower than its probe's.** The device is rated -20 to 40 °C (-5 to 105 °F) and 30–70 % RH. A DS18B20 on a lead isn't bound by that — a reading well above 40 °C is normal for a probe in a rack or tank, but if it reflects the air around the Pill, the device is out of spec.

## Logging

Set **Logging** on the connection, then read the Companion log.

| Level       | Adds                                                                                               |
| ----------- | -------------------------------------------------------------------------------------------------- |
| **Normal**  | Connect, disconnect, sensor online/offline alerts, errors.                                         |
| **Verbose** | Push connect/disconnect and reconnect attempts, device config-change resyncs, failed safety polls. |
| **Trace**   | Every WebSocket frame in and out, and every HTTP RPC call with its result. Noisy.                  |

Verbose and Trace are written at _info_ level on purpose. Companion normally runs with `--log-level=info` and
discards module debug output, so logging at debug would produce nothing visible — this setting works without
relaunching Companion.

Start at Verbose. Trace is for when you need to see what the device actually sent.

## Troubleshooting

**A sensor doesn't appear.** Check it's listed under _Peripherals_ in the device web UI. If the device can't see it, no Companion setting will help — check wiring and the Pill's mode.

**A sensor reads `-` just after a reboot.** Normal; clears on the first reading.

**Readings show `-` whenever the device or a probe is unreachable**, never a stale last value. A probe seen this
session stays listed (reading `-`) until the connection is re-saved, so its buttons keep their variables; the
connection also stays yellow (_Sensor offline_) until then. Removed a probe for good? Re-save the connection.

**How fast a dropout shows.** A reboot shows OFFLINE immediately. A silent power or network loss is caught in about
10–15 s with push on (ping watchdog), or about the poll interval plus 5 s with push off. An unplugged probe takes two
polls (about 30 s with push).

**The device was powered off or left the network.** The log shows `Device offline: no response from <ip>` as an
error, once — not once per retry — and the connection turns red. `Device is back online at <ip>` when it returns.
A WebSocket disconnect on its own only means push stopped; the device-offline error is what confirms the unit
itself is unreachable.

**A sensor was unplugged.** The log shows `Sensor offline: <name> (temperature:200) is no longer reported by
the device` as a warning, and `Sensor back online: <name>` when it returns. A sensor must be missing from two
consecutive reads before this fires, so a reconnect cannot raise a false alarm. The device deletes the component rather
than reporting a fault, so this is caught by the 15s safety poll — not instantly. The **Sensor has an error /
no reading** feedback also turns on and the connection turns yellow naming the sensor.

**Password-protected device.** Enter the password on the connection (the username is always `admin`). A wrong or
missing password turns the connection red with `Authentication failed — check the device password`, logged once, and
the module retries every 30 s rather than every poll. That restraint matters: the device answers `429 Too many
requests` to rapid failed logins **from any client**, so a Companion hammering it with a wrong password would also
block the Shelly app and every other Companion. If you see `Device is rate-limiting requests`, look for another client
with a stale password. Push still works with a password set, and several Companions can share one protected device.

**Firmware.** The module reads the device with `Shelly.GetComponents`, which every Gen3 firmware has. `Shelly.GetStatus` is not used because it omits Pill peripherals.
