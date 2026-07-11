import { combineRgb } from '@companion-module/base'

const WHITE = combineRgb(255, 255, 255)
const BLACK = combineRgb(0, 0, 0)
const RED = combineRgb(200, 0, 0)
const BLUE = combineRgb(0, 90, 200)
const GREEN = combineRgb(0, 160, 0)

/**
 * Preset definitions, generated per discovered component.
 */
export function getPresetDefinitions(self) {
	const presets = {}

	for (const c of self.components) {
		const label = c.name || `${c.type}:${c.id}`

		if (c.type === 'temperature') {
			presets[`temp_${c.id}`] = {
				type: 'button',
				category: 'Temperature',
				name: `Temperature ${label}`,
				style: { text: `${label}\n$(${self.label}:temp_${c.id}_c)°C`, size: '14', color: WHITE, bgcolor: BLACK },
				steps: [{ down: [], up: [] }],
				feedbacks: [
					{
						feedbackId: 'temperature_above',
						options: { id: c.id, threshold: 30, unit: 'c' },
						style: { bgcolor: RED, color: WHITE },
					},
					{
						feedbackId: 'temperature_below',
						options: { id: c.id, threshold: 5, unit: 'c' },
						style: { bgcolor: BLUE, color: WHITE },
					},
				],
			}
		}

		if (c.type === 'humidity') {
			presets[`hum_${c.id}`] = {
				type: 'button',
				category: 'Humidity',
				name: `Humidity ${label}`,
				style: { text: `${label}\n$(${self.label}:humidity_${c.id})%`, size: '14', color: WHITE, bgcolor: BLACK },
				steps: [{ down: [], up: [] }],
				feedbacks: [
					{
						feedbackId: 'humidity_above',
						options: { id: c.id, threshold: 60 },
						style: { bgcolor: RED, color: WHITE },
					},
				],
			}
		}

		if (c.type === 'switch') {
			presets[`switch_${c.id}`] = {
				type: 'button',
				category: 'Switches',
				name: `Toggle ${label}`,
				style: { text: `${label}\n$(${self.label}:switch_${c.id})`, size: '14', color: WHITE, bgcolor: BLACK },
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
				style: { text: `${label}`, size: '14', color: WHITE, bgcolor: BLACK },
				steps: [
					{
						down: [{ actionId: 'script_control', options: { id: c.id, op: 'start' } }],
						up: [],
					},
					{
						down: [{ actionId: 'script_control', options: { id: c.id, op: 'stop' } }],
						up: [],
					},
				],
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
