// Unrecoverable from a mis-click (wipe / drop off the network); matched case-insensitively, still in the web UI
const BLOCKED_METHODS = ['Shelly.FactoryReset', 'Shelly.ResetWiFiConfig']
const BLOCKED_LOOKUP = new Set(BLOCKED_METHODS.map((m) => m.toLowerCase()))

/**
 * Action definitions. `self` is the module instance (provides rpc, components, poll()).
 */
export function getActionDefinitions(self) {
	const defs = {
		sensor_rename: {
			name: 'Temperature: Rename sensor',
			options: [
				self.sensorOption('temperature', 'Sensor'),
				{
					type: 'textinput',
					id: 'name',
					label: 'Name (leave blank to clear)',
					default: '',
					useVariables: true,
				},
			],
			callback: async (action, context) => {
				const id = Number(action.options.id)
				const raw = await context.parseVariablesInString(action.options.name ?? '')
				const name = raw.trim() || null
				await self.rpc.call('Temperature.SetConfig', { id, config: { id, name } })
				// Discovery keys on the name, so this poll rebuilds labels and presets
				await self.poll()
			},
		},

		sensor_calibrate: {
			name: 'Temperature: Calibrate sensor',
			options: [
				self.sensorOption('temperature', 'Sensor'),
				{ type: 'number', id: 'offset_C', label: 'Offset (°C)', default: 0, min: -50, max: 50, step: 0.1 },
				{
					type: 'number',
					id: 'report_thr_C',
					label: 'Report threshold (°C)',
					default: 0.1,
					min: 0.1,
					max: 5,
					step: 0.1,
				},
			],
			callback: async (action) => {
				const { offset_C, report_thr_C } = action.options
				await self.rpc.call('Temperature.SetConfig', {
					id: Number(action.options.id),
					config: { offset_C: Number(offset_C), report_thr_C: Number(report_thr_C) },
				})
				await self.poll()
			},
		},

		switch_set: {
			name: 'Switch: Set state',
			options: [
				self.sensorOption('switch', 'Switch'),
				{
					type: 'dropdown',
					id: 'state',
					label: 'State',
					default: 'toggle',
					choices: [
						{ id: 'on', label: 'On' },
						{ id: 'off', label: 'Off' },
						{ id: 'toggle', label: 'Toggle' },
					],
				},
			],
			callback: async (action) => {
				const id = Number(action.options.id)
				if (action.options.state === 'toggle') {
					await self.rpc.call('Switch.Toggle', { id })
				} else {
					await self.rpc.call('Switch.Set', { id, on: action.options.state === 'on' })
				}
				self.poll()
			},
		},

		script_control: {
			name: 'Script: Start / Stop',
			options: [
				self.sensorOption('script', 'Script'),
				{
					type: 'dropdown',
					id: 'op',
					label: 'Operation',
					default: 'start',
					choices: [
						{ id: 'start', label: 'Start' },
						{ id: 'stop', label: 'Stop' },
						{ id: 'toggle', label: 'Toggle' },
					],
				},
			],
			callback: async (action) => {
				const id = Number(action.options.id)
				let op = action.options.op
				if (op === 'toggle') op = self.lastStatus?.[`script:${id}`]?.running ? 'stop' : 'start'
				await self.rpc.call(op === 'start' ? 'Script.Start' : 'Script.Stop', { id })
				self.poll()
			},
		},

		script_eval: {
			name: 'Script: Eval code in running script',
			options: [
				self.sensorOption('script', 'Script'),
				{
					type: 'textinput',
					id: 'code',
					label: 'JavaScript expression',
					default: '',
					useVariables: true,
				},
			],
			callback: async (action, context) => {
				const code = await context.parseVariablesInString(action.options.code)
				await self.rpc.call('Script.Eval', { id: Number(action.options.id), code })
			},
		},

		custom_rpc: {
			name: 'Custom RPC call',
			options: [
				{
					type: 'textinput',
					id: 'method',
					label: 'Method (e.g. Shelly.Reboot)',
					default: '',
				},
				{
					type: 'static-text',
					id: 'blocked_info',
					label: '',
					value: `Blocked from buttons: ${BLOCKED_METHODS.join(', ')}. Use the device web UI if you need these.`,
				},
				{
					type: 'textinput',
					id: 'params',
					label: 'Params (JSON, optional)',
					default: '',
					useVariables: true,
				},
			],
			callback: async (action, context) => {
				const method = action.options.method?.trim()
				if (!method) throw new Error('No RPC method given')
				if (BLOCKED_LOOKUP.has(method.toLowerCase())) {
					throw new Error(
						`${method} is blocked from Companion — a mis-click on a surface is unrecoverable. ` +
							`Use the device web UI if you really need it.`,
					)
				}
				const paramsRaw = await context.parseVariablesInString(action.options.params ?? '')
				let params
				try {
					params = paramsRaw.trim() ? JSON.parse(paramsRaw) : undefined
				} catch (err) {
					throw new Error(`Custom RPC ${method}: params are not valid JSON (${err.message})`)
				}
				const result = await self.rpc.call(method, params)
				self.log('info', `RPC ${method} → ${JSON.stringify(result)}`)
			},
		},

		reboot: {
			name: 'Reboot device',
			options: [],
			callback: async () => {
				await self.rpc.call('Shelly.Reboot')
			},
		},

		refresh: {
			name: 'Refresh status now',
			options: [],
			callback: async () => {
				await self.poll()
			},
		},
	}
	// Hide what this Pill has nothing for, but only once discovery has run (unreachable at startup keeps all)
	const needs = {
		sensor_rename: 'temperature',
		sensor_calibrate: 'temperature',
		switch_set: 'switch',
		script_control: 'script',
		script_eval: 'script',
	}
	if (self.components.length) for (const [k, t] of Object.entries(needs)) if (!self.choicesFor(t).length) delete defs[k]
	return defs
}
