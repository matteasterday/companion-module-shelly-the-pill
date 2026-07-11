const fmt = (v, digits = 1) => (typeof v === 'number' ? v.toFixed(digits) : '-')

/**
 * Build variable definitions from the discovered component list.
 * `components` is an array of { type, id, name } (name may be null).
 */
export function getVariableDefinitions(components) {
	const defs = [
		{ variableId: 'device_name', name: 'Device name' },
		{ variableId: 'device_model', name: 'Device model' },
		{ variableId: 'firmware', name: 'Firmware version' },
		{ variableId: 'uptime', name: 'Uptime (seconds)' },
		{ variableId: 'wifi_rssi', name: 'WiFi signal (dBm)' },
		{ variableId: 'wifi_ip', name: 'WiFi IP address' },
	]

	for (const c of components) {
		const label = c.name ? `${c.name} (${c.type}:${c.id})` : `${c.type}:${c.id}`
		switch (c.type) {
			case 'temperature':
				defs.push(
					{ variableId: `temp_${c.id}_c`, name: `Temperature °C — ${label}` },
					{ variableId: `temp_${c.id}_f`, name: `Temperature °F — ${label}` },
				)
				break
			case 'humidity':
				defs.push({ variableId: `humidity_${c.id}`, name: `Relative humidity % — ${label}` })
				break
			case 'voltmeter':
				defs.push({ variableId: `voltmeter_${c.id}`, name: `Voltage — ${label}` })
				break
			case 'input':
				defs.push({ variableId: `input_${c.id}`, name: `Input state — ${label}` })
				break
			case 'switch':
				defs.push({ variableId: `switch_${c.id}`, name: `Switch output — ${label}` })
				break
			case 'script':
				defs.push({ variableId: `script_${c.id}_running`, name: `Script running — ${label}` })
				break
		}
	}

	return defs
}

/**
 * Extract variable values from a Shelly.GetStatus result.
 */
export function collectVariableValues(status, deviceInfo) {
	const values = {
		device_name: deviceInfo?.name ?? deviceInfo?.id ?? '-',
		device_model: deviceInfo?.model ?? '-',
		firmware: deviceInfo?.ver ?? '-',
		uptime: status.sys?.uptime ?? '-',
		wifi_rssi: status.wifi?.rssi ?? '-',
		wifi_ip: status.wifi?.sta_ip ?? '-',
	}

	for (const [key, comp] of Object.entries(status)) {
		const m = key.match(/^(temperature|humidity|voltmeter|input|switch|script):(\d+)$/)
		if (!m) continue
		const [, type, id] = m
		switch (type) {
			case 'temperature':
				values[`temp_${id}_c`] = fmt(comp.tC)
				values[`temp_${id}_f`] = fmt(comp.tF)
				break
			case 'humidity':
				values[`humidity_${id}`] = fmt(comp.rh)
				break
			case 'voltmeter':
				values[`voltmeter_${id}`] = fmt(comp.voltage, 2)
				break
			case 'input':
				values[`input_${id}`] = comp.state === true ? 'On' : comp.state === false ? 'Off' : fmt(comp.percent, 0)
				break
			case 'switch':
				values[`switch_${id}`] = comp.output ? 'On' : 'Off'
				break
			case 'script':
				values[`script_${id}_running`] = comp.running ? 'Yes' : 'No'
				break
		}
	}

	return values
}
