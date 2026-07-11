import { Regex } from '@companion-module/base'

export function getConfigFields() {
	return [
		{
			type: 'static-text',
			id: 'info',
			width: 12,
			label: 'Information',
			value:
				'Connects to a "The Pill by Shelly" (Gen3) device over its local HTTP RPC API. ' +
				'Attached sensors (DS18B20 temperature, humidity, voltmeter, inputs, switches) are discovered automatically ' +
				'and exposed as variables and feedbacks.',
		},
		{
			type: 'textinput',
			id: 'host',
			label: 'Device IP / hostname',
			width: 8,
			regex: Regex.HOSTNAME,
			required: true,
		},
		{
			type: 'textinput',
			id: 'password',
			label: 'Password (if device auth is enabled)',
			width: 4,
		},
		{
			type: 'number',
			id: 'pollInterval',
			label: 'Poll interval (ms)',
			width: 4,
			min: 250,
			max: 60000,
			default: 1000,
		},
	]
}
