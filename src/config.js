import { Regex } from '@companion-module/base'

export function getConfigFields() {
	return [
		{
			type: 'bonjour-device',
			id: 'bonjour_host',
			label: 'Device',
			description: 'Pick a Pill found on the network, or choose Manual and enter its address below.',
		},
		{
			type: 'textinput',
			id: 'host',
			label: 'Device IP / hostname',
			description: 'The Pill’s IP address (from the Shelly app or your router), or <device-id>.local.',
			regex: Regex.HOSTNAME,
			isVisibleExpression: '!$(options:bonjour_host)',
		},
		{
			type: 'textinput',
			id: 'password',
			label: 'Password (if device auth is enabled)',
		},
		{
			type: 'checkbox',
			id: 'useWebSocket',
			label: 'Push updates over WebSocket',
			description: 'Readings arrive the moment they change instead of being polled; nothing on the device is changed.',
			default: true,
		},
		{
			type: 'dropdown',
			id: 'logLevel',
			label: 'Logging',
			description:
				'Verbose adds connection detail, Trace every message, both at info level; leave on Normal day to day.',
			default: 'normal',
			choices: [
				{ id: 'normal', label: 'Normal' },
				{ id: 'verbose', label: 'Verbose — connection detail' },
				{ id: 'trace', label: 'Trace — every message' },
			],
		},
		{
			type: 'number',
			id: 'pollInterval',
			label: 'Poll interval (ms)',
			description:
				'Used while push is off or down; with push connected the module still polls every 15 s as a safety net.',
			min: 250,
			max: 60000,
			default: 1000,
		},
	]
}
