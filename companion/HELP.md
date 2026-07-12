# The Pill by Shelly

Connects to a [The Pill by Shelly](https://us.shelly.com/products/the-pill-by-shelly) (Gen3) device over its local HTTP RPC API and exposes attached sensors and peripherals to Companion.

## Configuration

| Setting | Description |
| --- | --- |
| **Device IP / hostname** | The IP address of The Pill on your network (find it in the Shelly app or via `http://ShellyPill-XXXX.local`). |
| **Password** | Only needed if you enabled authentication on the device (username is always `admin`). |
| **Temperature unit** | Celsius or Fahrenheit. Sets the unit used by temperature presets and how temperature feedback thresholds are interpreted. Default Celsius. |
| **Poll interval** | How often to fetch status from the device, in milliseconds. Default 1000. |

Attached peripherals — DS18B20 temperature probes, humidity sensors, voltmeters, inputs, switches, and scripts — are discovered automatically. Variables, feedbacks, and presets are (re)generated when the component set changes.

## Variables

- `temp_<id>_c` / `temp_<id>_f` — temperature per sensor (e.g. `temp_100_c` for the first DS18B20)
- `humidity_<id>` — relative humidity %
- `voltmeter_<id>` — measured voltage
- `input_<id>` — input state (On/Off or analog %)
- `switch_<id>` — switch output state
- `script_<id>_running` — whether a script is running
- `device_name`, `device_model`, `firmware`, `uptime`, `wifi_rssi`, `wifi_ip`

## Feedbacks

- **Temperature above / below threshold** (in the configured temperature unit)
- **Humidity above threshold**
- **Switch is on**
- **Script is running**
- **Sensor has an error / no reading**

## Actions

- **Switch: Set state** (on / off / toggle)
- **Script: Start / Stop**
- **Script: Eval code in running script**
- **Custom RPC call** — call any [Shelly Gen2+ RPC method](https://shelly-api-docs.shelly.cloud/gen2/) with JSON params
- **Reboot device**
- **Refresh status now**

## Presets

Ready-made buttons are generated for every discovered temperature sensor, humidity sensor, switch, and script.
