# companion-module-shelly-the-pill

A [Bitfocus Companion](https://bitfocus.io/companion) module for [The Pill by Shelly](https://us.shelly.com/products/the-pill-by-shelly) (Gen3), a USB-C powered Wi-Fi/BLE device that connects to sensors and low-voltage peripherals.

Talks to the device's local [Shelly Gen2+ RPC API](https://shelly-api-docs.shelly.cloud/gen2/Devices/Gen3/ThePill) over HTTP (with SHA-256 digest auth support) and automatically discovers attached components:

- **Temperature** sensors (e.g. DS18B20 probes) — variables in °C and °F, above/below-threshold feedbacks
- **Humidity** sensors — variable + threshold feedback
- **Voltmeter**, **inputs**, **switches** — variables, switch on/off/toggle actions and feedback
- **Scripts** — start/stop/eval actions, running feedback ([Shelly scripting](https://shelly-api-docs.shelly.cloud/gen2/Scripts/Overview))
- **Custom RPC** action for anything else the API offers

Presets are generated for every discovered sensor, switch, and script.

## Installation (development)

Requires Companion 3.x+ and Node.js 22.

```sh
git clone https://github.com/matteasterday/companion-module-shelly-the-pill.git
cd companion-module-shelly-the-pill
npm install
```

Then in Companion, set your **developer modules path** (Settings → Developer) to the folder *containing* this repo, and add a **shelly-the-pill** connection with the device's IP address.

## Configuration

See [companion/HELP.md](companion/HELP.md).

## License

MIT
