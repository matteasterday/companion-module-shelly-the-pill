import { combineRgb } from '@companion-module/base'

const RED = combineRgb(200, 0, 0)
const BLUE = combineRgb(0, 90, 200)
const GREEN = combineRgb(0, 160, 0)
const WHITE = combineRgb(255, 255, 255)

/**
 * Feedback definitions. `self` is the module instance.
 */
export function getFeedbackDefinitions(self) {
	const tempChoices = self.choicesFor('temperature')
	const humChoices = self.choicesFor('humidity')
	const switchChoices = self.choicesFor('switch')
	const scriptChoices = self.choicesFor('script')
	const sensorChoices = [...tempChoices, ...humChoices, ...self.choicesFor('voltmeter')]

	const unit = self.tempUnit
	const unitLabel = unit === 'f' ? '°F' : '°C'

	const tempValue = (id) => {
		const comp = self.lastStatus?.[`temperature:${id}`]
		return unit === 'f' ? comp?.tF : comp?.tC
	}

	return {
		temperature_above: {
			type: 'boolean',
			name: 'Temperature above threshold',
			defaultStyle: { bgcolor: RED, color: WHITE },
			options: [
				{
					type: 'dropdown',
					id: 'id',
					label: 'Sensor',
					default: tempChoices[0]?.id ?? 100,
					choices: tempChoices.length ? tempChoices : [{ id: 100, label: 'temperature:100' }],
				},
				{ type: 'number', id: 'threshold', label: `Threshold (${unitLabel})`, default: unit === 'f' ? 86 : 30, min: -150, max: 950 },
			],
			callback: (feedback) => {
				const v = tempValue(feedback.options.id)
				return typeof v === 'number' && v > Number(feedback.options.threshold)
			},
		},

		temperature_below: {
			type: 'boolean',
			name: 'Temperature below threshold',
			defaultStyle: { bgcolor: BLUE, color: WHITE },
			options: [
				{
					type: 'dropdown',
					id: 'id',
					label: 'Sensor',
					default: tempChoices[0]?.id ?? 100,
					choices: tempChoices.length ? tempChoices : [{ id: 100, label: 'temperature:100' }],
				},
				{ type: 'number', id: 'threshold', label: `Threshold (${unitLabel})`, default: unit === 'f' ? 41 : 5, min: -150, max: 950 },
			],
			callback: (feedback) => {
				const v = tempValue(feedback.options.id)
				return typeof v === 'number' && v < Number(feedback.options.threshold)
			},
		},

		humidity_above: {
			type: 'boolean',
			name: 'Humidity above threshold',
			defaultStyle: { bgcolor: RED, color: WHITE },
			options: [
				{
					type: 'dropdown',
					id: 'id',
					label: 'Sensor',
					default: humChoices[0]?.id ?? 100,
					choices: humChoices.length ? humChoices : [{ id: 100, label: 'humidity:100' }],
				},
				{ type: 'number', id: 'threshold', label: 'Threshold (%)', default: 60, min: 0, max: 100 },
			],
			callback: (feedback) => {
				const rh = self.lastStatus?.[`humidity:${feedback.options.id}`]?.rh
				return typeof rh === 'number' && rh > Number(feedback.options.threshold)
			},
		},

		switch_on: {
			type: 'boolean',
			name: 'Switch is on',
			defaultStyle: { bgcolor: GREEN, color: WHITE },
			options: [
				{
					type: 'dropdown',
					id: 'id',
					label: 'Switch',
					default: switchChoices[0]?.id ?? 0,
					choices: switchChoices.length ? switchChoices : [{ id: 0, label: 'Switch 0' }],
				},
			],
			callback: (feedback) => self.lastStatus?.[`switch:${feedback.options.id}`]?.output === true,
		},

		script_running: {
			type: 'boolean',
			name: 'Script is running',
			defaultStyle: { bgcolor: GREEN, color: WHITE },
			options: [
				{
					type: 'dropdown',
					id: 'id',
					label: 'Script',
					default: scriptChoices[0]?.id ?? 1,
					choices: scriptChoices.length ? scriptChoices : [{ id: 1, label: 'Script 1' }],
				},
			],
			callback: (feedback) => self.lastStatus?.[`script:${feedback.options.id}`]?.running === true,
		},

		sensor_error: {
			type: 'boolean',
			name: 'Sensor has an error / no reading',
			defaultStyle: { bgcolor: RED, color: WHITE },
			options: [
				{
					type: 'dropdown',
					id: 'key',
					label: 'Sensor',
					default: sensorChoices[0]?.id != null ? String(sensorChoices[0].fullId) : 'temperature:100',
					choices: sensorChoices.length
						? sensorChoices.map((c) => ({ id: c.fullId, label: c.label }))
						: [{ id: 'temperature:100', label: 'temperature:100' }],
				},
			],
			callback: (feedback) => {
				const comp = self.lastStatus?.[feedback.options.key]
				if (!comp) return true
				if (Array.isArray(comp.errors) && comp.errors.length > 0) return true
				return comp.tC === null || comp.rh === null || comp.voltage === null
			},
		},
	}
}
