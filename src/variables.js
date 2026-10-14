export const COMPONENT_RE = /^(temperature|humidity|voltmeter|input|switch|script):(\d+)$/

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
		{ variableId: 'uptime_text', name: 'Uptime (e.g. 1d 2h 3m)' },
		{ variableId: 'update_available', name: 'Firmware update available (stable version, or None)' },
		{ variableId: 'restart_required', name: 'Restart required (Yes/No)' },
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
				defs.push(
					{ variableId: `voltmeter_${c.id}`, name: `Voltage (V) — ${label}` },
					// Present only when the device has a transformation configured, e.g.
					// scaling a 0-2.5 V input to the 0-30 V add-on's real range.
					{ variableId: `voltmeter_${c.id}_x`, name: `Transformed value — ${label}` },
				)
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
 * Extract variable values for the discovered components; anything missing from `status` reads '-'.
 */
export function collectVariableValues(status, deviceInfo, components) {
	const sys = status.sys
	const up = sys?.uptime
	const values = {
		device_name: deviceInfo?.name ?? deviceInfo?.id ?? '-',
		device_model: deviceInfo?.model ?? '-',
		firmware: deviceInfo?.ver ?? '-',
		uptime: up ?? '-',
		uptime_text:
			typeof up === 'number'
				? `${Math.floor(up / 86400)}d ${Math.floor((up % 86400) / 3600)}h ${Math.floor((up % 3600) / 60)}m`
				: '-',
		update_available: sys?.available_updates?.stable?.version ?? (sys ? 'None' : '-'),
		restart_required: sys ? (sys.restart_required ? 'Yes' : 'No') : '-',
		wifi_rssi: status.wifi?.rssi ?? '-',
		wifi_ip: status.wifi?.sta_ip ?? '-',
	}

	for (const c of components) {
		const id = c.id
		const comp = status[`${c.type}:${id}`] ?? {}
		switch (c.type) {
			case 'temperature':
				values[`temp_${id}_c`] = fmt(comp.tC)
				values[`temp_${id}_f`] = fmt(comp.tF)
				break
			case 'humidity':
				values[`humidity_${id}`] = fmt(comp.rh)
				break
			case 'voltmeter':
				values[`voltmeter_${id}`] = fmt(comp.voltage, 2)
				values[`voltmeter_${id}_x`] = fmt(comp.xvoltage, 2)
				break
			case 'input':
				values[`input_${id}`] =
					typeof comp.state === 'boolean'
						? comp.state
							? 'On'
							: 'Off'
						: typeof (comp.xpercent ?? comp.percent) === 'number'
							? fmt(comp.xpercent ?? comp.percent, 0)
							: comp.counts
								? (comp.counts.xtotal ?? comp.counts.total)
								: '-'
				break
			case 'switch':
				values[`switch_${id}`] = comp.output == null ? '-' : comp.output ? 'On' : 'Off'
				break
			case 'script':
				values[`script_${id}_running`] = comp.running == null ? '-' : comp.running ? 'Yes' : 'No'
				break
		}
	}

	return values
}
