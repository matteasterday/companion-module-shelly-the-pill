import { combineRgb } from '@companion-module/base'

const WHITE = combineRgb(255, 255, 255)
const BLACK = combineRgb(0, 0, 0)
const RED = combineRgb(200, 0, 0)
const BLUE = combineRgb(0, 90, 200)
const GREEN = combineRgb(0, 160, 0)
const AMBER = combineRgb(220, 140, 0)
// Value first and auto-sized so it reads from across the room; no topbar stealing height
const BASE = { size: 'auto', color: WHITE, bgcolor: BLACK, show_topbar: false }

/**
 * Preset definitions, generated per discovered component.
 */
export function getPresetDefinitions(self) {
	const presets = {}
	// Last in the list so it wins over threshold colours: a missing reading is never "fine"
	const offline = (key, label) => ({
		feedbackId: 'sensor_error',
		options: { key },
		style: { bgcolor: combineRgb(80, 80, 80), color: combineRgb(255, 200, 0), text: `OFFLINE\n${label}` },
	})

	presets.device = {
		type: 'button',
		category: 'Device',
		name: 'Device status',
		style: { ...BASE, text: `$(${self.label}:device_name)\n$(${self.label}:wifi_rssi) dBm` },
		steps: [{ down: [{ actionId: 'refresh', options: {} }], up: [] }],
		feedbacks: [
			{ feedbackId: 'device_offline', options: {}, style: { bgcolor: RED, color: WHITE, text: 'PILL\nOFFLINE' } },
		],
	}

	for (const c of self.components) {
		const label = c.name || `${c.type}:${c.id}`

		if (c.type === 'temperature') {
			// One preset per scale. A button's text is copied from the preset when it
			// is created and never re-read, so a unit setting could not retroactively
			// change existing buttons — offering both is what actually works.
			for (const unit of ['c', 'f']) {
				const symbol = `°${unit.toUpperCase()}`
				const f = unit === 'f'
				presets[`temp_${c.id}_${unit}`] = {
					type: 'button',
					category: 'Temperature',
					name: `Temperature ${label} (${symbol})`,
					style: { ...BASE, text: `$(${self.label}:temp_${c.id}_${unit})${symbol}\n${label}` },
					steps: [{ down: [], up: [] }],
					// Warn 27 °C / critical 32 °C: ASHRAE recommended / allowable inlet limits
					feedbacks: [
						{
							feedbackId: 'temperature_above',
							options: { id: c.id, unit, threshold: f ? 81 : 27 },
							style: { bgcolor: AMBER, color: BLACK },
						},
						{
							feedbackId: 'temperature_above',
							options: { id: c.id, unit, threshold: f ? 90 : 32 },
							style: { bgcolor: RED, color: WHITE },
						},
						offline(`temperature:${c.id}`, label),
					],
				}
			}
		}

		if (c.type === 'humidity') {
			presets[`hum_${c.id}`] = {
				type: 'button',
				category: 'Humidity',
				name: `Humidity ${label}`,
				style: { ...BASE, text: `$(${self.label}:humidity_${c.id})%\n${label}` },
				steps: [{ down: [], up: [] }],
				feedbacks: [
					{
						feedbackId: 'humidity_above',
						options: { id: c.id, threshold: 60 },
						style: { bgcolor: AMBER, color: BLACK },
					},
					{
						feedbackId: 'humidity_below',
						options: { id: c.id, threshold: 20 },
						style: { bgcolor: BLUE, color: WHITE },
					},
					offline(`humidity:${c.id}`, label),
				],
			}
		}

		if (c.type === 'voltmeter') {
			presets[`volt_${c.id}`] = {
				type: 'button',
				category: 'Voltage',
				name: `Voltage ${label}`,
				// Show what the feedback compares: the scaled value when a transformation is set
				style: {
					...BASE,
					text:
						self.lastStatus?.[`voltmeter:${c.id}`]?.xvoltage != null
							? `$(${self.label}:voltmeter_${c.id}_x)\n${label}`
							: `$(${self.label}:voltmeter_${c.id})V\n${label}`,
				},
				steps: [{ down: [], up: [] }],
				feedbacks: [
					{ feedbackId: 'voltmeter_above', options: { id: c.id, threshold: 1 }, style: { bgcolor: RED, color: WHITE } },
					offline(`voltmeter:${c.id}`, label),
				],
			}
		}

		if (c.type === 'input') {
			presets[`input_${c.id}`] = {
				type: 'button',
				category: 'Inputs',
				name: `Input ${label}`,
				style: { ...BASE, text: `$(${self.label}:input_${c.id})\n${label}` },
				steps: [{ down: [], up: [] }],
				feedbacks: [
					{
						feedbackId: 'input_state',
						options: { id: c.id, state: 'true' },
						style: { bgcolor: GREEN, color: WHITE },
					},
				],
			}
		}

		if (c.type === 'switch') {
			presets[`switch_${c.id}`] = {
				type: 'button',
				category: 'Switches',
				name: `Toggle ${label}`,
				style: { ...BASE, text: `$(${self.label}:switch_${c.id})\n${label}` },
				steps: [
					{
						down: [{ actionId: 'switch_set', options: { id: c.id, state: 'toggle' } }],
						up: [],
					},
				],
				feedbacks: [
					{
						feedbackId: 'switch_on',
						options: { id: c.id },
						style: { bgcolor: GREEN, color: WHITE },
					},
				],
			}
		}

		if (c.type === 'script') {
			presets[`script_${c.id}`] = {
				type: 'button',
				category: 'Scripts',
				name: `Start/stop ${label}`,
				style: { ...BASE, text: label },
				steps: [{ down: [{ actionId: 'script_control', options: { id: c.id, op: 'toggle' } }], up: [] }],
				feedbacks: [
					{
						feedbackId: 'script_running',
						options: { id: c.id },
						style: { bgcolor: GREEN, color: WHITE },
					},
				],
			}
		}
	}

	return presets
}
