import { combineRgb } from '@companion-module/base'

const RED = combineRgb(200, 0, 0)
const BLUE = combineRgb(0, 90, 200)
const GREEN = combineRgb(0, 160, 0)
const WHITE = combineRgb(255, 255, 255)

/**
 * Feedback definitions. `self` is the module instance.
 */
export function getFeedbackDefinitions(self) {
	const sensorChoices = ['temperature', 'humidity', 'voltmeter', 'input'].flatMap((t) => self.choicesFor(t))

	// Temperature is reported in both scales, so each feedback carries its own
	// unit choice rather than depending on a module-wide setting.
	const unitOption = {
		type: 'dropdown',
		id: 'unit',
		label: 'Unit',
		default: 'c',
		choices: [
			{ id: 'c', label: 'Celsius (°C)' },
			{ id: 'f', label: 'Fahrenheit (°F)' },
		],
	}

	// The 0-30 V add-on reports through a transformation, so xvoltage is the real
	// reading when present; fall back to the raw pin voltage otherwise.
	const voltageOf = (id) => {
		const comp = self.lastStatus?.[`voltmeter:${id}`]
		return comp?.xvoltage ?? comp?.voltage
	}

	const tempValue = (id, unit) => {
		const comp = self.lastStatus?.[`temperature:${id}`]
		return unit === 'f' ? comp?.tF : comp?.tC
	}

	// "Learn" sets the threshold to the current reading
	const learnFrom = (get) => (fb) => {
		const v = get(fb.options)
		return typeof v === 'number' ? { ...fb.options, threshold: Math.round(v * 10) / 10 } : undefined
	}
	const learnTemp = learnFrom((o) => tempValue(o.id, o.unit))
	const learnRh = learnFrom((o) => self.lastStatus?.[`humidity:${o.id}`]?.rh)
	const learnVolt = learnFrom((o) => voltageOf(o.id))

	const defs = {
		temperature_above: {
			type: 'boolean',
			name: 'Temperature above threshold',
			defaultStyle: { bgcolor: RED, color: WHITE },
			options: [
				self.sensorOption('temperature', 'Sensor'),
				unitOption,
				{ type: 'number', id: 'threshold', label: 'Threshold', default: 27, min: -150, max: 950 },
			],
			callback: (feedback) => {
				const v = tempValue(feedback.options.id, feedback.options.unit)
				return typeof v === 'number' && v > Number(feedback.options.threshold)
			},
			learn: learnTemp,
		},

		temperature_below: {
			type: 'boolean',
			name: 'Temperature below threshold',
			defaultStyle: { bgcolor: BLUE, color: WHITE },
			options: [
				self.sensorOption('temperature', 'Sensor'),
				unitOption,
				{ type: 'number', id: 'threshold', label: 'Threshold', default: 5, min: -150, max: 950 },
			],
			callback: (feedback) => {
				const v = tempValue(feedback.options.id, feedback.options.unit)
				return typeof v === 'number' && v < Number(feedback.options.threshold)
			},
			learn: learnTemp,
		},

		humidity_above: {
			type: 'boolean',
			name: 'Humidity above threshold',
			defaultStyle: { bgcolor: RED, color: WHITE },
			options: [
				self.sensorOption('humidity', 'Sensor'),
				{ type: 'number', id: 'threshold', label: 'Threshold (%)', default: 60, min: 0, max: 100 },
			],
			callback: (feedback) => {
				const rh = self.lastStatus?.[`humidity:${feedback.options.id}`]?.rh
				return typeof rh === 'number' && rh > Number(feedback.options.threshold)
			},
			learn: learnRh,
		},

		humidity_below: {
			type: 'boolean',
			name: 'Humidity below threshold',
			defaultStyle: { bgcolor: BLUE, color: WHITE },
			options: [
				self.sensorOption('humidity', 'Sensor'),
				{ type: 'number', id: 'threshold', label: 'Threshold (%)', default: 30, min: 0, max: 100 },
			],
			callback: (feedback) => {
				const rh = self.lastStatus?.[`humidity:${feedback.options.id}`]?.rh
				return typeof rh === 'number' && rh < Number(feedback.options.threshold)
			},
			learn: learnRh,
		},

		voltmeter_above: {
			type: 'boolean',
			name: 'Voltage above threshold',
			defaultStyle: { bgcolor: RED, color: WHITE },
			options: [
				self.sensorOption('voltmeter', 'Voltmeter'),
				{
					type: 'number',
					id: 'threshold',
					label: 'Threshold (scaled value if a transformation is set, else V)',
					default: 1,
					min: -1000,
					max: 1000,
				},
			],
			callback: (feedback) => {
				const v = voltageOf(feedback.options.id)
				return typeof v === 'number' && v > Number(feedback.options.threshold)
			},
			learn: learnVolt,
		},

		voltmeter_below: {
			type: 'boolean',
			name: 'Voltage below threshold',
			defaultStyle: { bgcolor: BLUE, color: WHITE },
			options: [
				self.sensorOption('voltmeter', 'Voltmeter'),
				{
					type: 'number',
					id: 'threshold',
					label: 'Threshold (scaled value if a transformation is set, else V)',
					default: 1,
					min: -1000,
					max: 1000,
				},
			],
			callback: (feedback) => {
				const v = voltageOf(feedback.options.id)
				return typeof v === 'number' && v < Number(feedback.options.threshold)
			},
			learn: learnVolt,
		},

		input_state: {
			type: 'boolean',
			name: 'Digital input is in state',
			defaultStyle: { bgcolor: GREEN, color: WHITE },
			options: [
				self.sensorOption('input', 'Input'),
				{
					type: 'dropdown',
					id: 'state',
					label: 'State',
					default: 'true',
					choices: [
						{ id: 'true', label: 'On / closed' },
						{ id: 'false', label: 'Off / open' },
					],
				},
			],
			callback: (feedback) => {
				const state = self.lastStatus?.[`input:${feedback.options.id}`]?.state
				if (typeof state !== 'boolean') return false
				return state === (String(feedback.options.state) === 'true')
			},
		},

		switch_on: {
			type: 'boolean',
			name: 'Switch is on',
			defaultStyle: { bgcolor: GREEN, color: WHITE },
			options: [self.sensorOption('switch', 'Switch')],
			callback: (feedback) => self.lastStatus?.[`switch:${feedback.options.id}`]?.output === true,
		},

		script_running: {
			type: 'boolean',
			name: 'Script is running',
			defaultStyle: { bgcolor: GREEN, color: WHITE },
			options: [self.sensorOption('script', 'Script')],
			callback: (feedback) => self.lastStatus?.[`script:${feedback.options.id}`]?.running === true,
		},

		device_offline: {
			type: 'boolean',
			name: 'Device is offline',
			defaultStyle: { bgcolor: RED, color: WHITE },
			options: [],
			callback: () => self.lastStatus == null,
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
					default: sensorChoices[0]?.fullId ?? 'temperature:200',
					choices: sensorChoices.length
						? sensorChoices.map((c) => ({ id: c.fullId, label: c.label }))
						: [{ id: 'temperature:200', label: 'temperature:200' }],
				},
			],
			callback: (feedback) => {
				const comp = self.lastStatus?.[feedback.options.key]
				if (!comp) return true
				if (Array.isArray(comp.errors) && comp.errors.length > 0) return true
				return comp.tC === null || comp.rh === null || comp.voltage === null || comp.xvoltage === null
			},
		},
	}
	// Hide what this Pill has nothing for, but only once discovery has run (unreachable at startup keeps all)
	const needs = {
		temperature_above: 'temperature',
		temperature_below: 'temperature',
		humidity_above: 'humidity',
		humidity_below: 'humidity',
		voltmeter_above: 'voltmeter',
		voltmeter_below: 'voltmeter',
		input_state: 'input',
		switch_on: 'switch',
		script_running: 'script',
	}
	if (self.components.length) for (const [k, t] of Object.entries(needs)) if (!self.choicesFor(t).length) delete defs[k]
	return defs
}
