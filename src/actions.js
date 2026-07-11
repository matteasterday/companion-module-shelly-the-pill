/**
 * Action definitions. `self` is the module instance (provides rpc, components, poll()).
 */
export function getActionDefinitions(self) {
	const switchChoices = self.choicesFor('switch')
	const scriptChoices = self.choicesFor('script')

	return {
		switch_set: {
			name: 'Switch: Set state',
			options: [
				{
					type: 'dropdown',
					id: 'id',
					label: 'Switch',
					default: switchChoices[0]?.id ?? 0,
					choices: switchChoices.length ? switchChoices : [{ id: 0, label: 'Switch 0' }],
				},
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
				{
					type: 'dropdown',
					id: 'id',
					label: 'Script',
					default: scriptChoices[0]?.id ?? 1,
					choices: scriptChoices.length ? scriptChoices : [{ id: 1, label: 'Script 1' }],
				},
				{
					type: 'dropdown',
					id: 'op',
					label: 'Operation',
					default: 'start',
					choices: [
						{ id: 'start', label: 'Start' },
						{ id: 'stop', label: 'Stop' },
					],
				},
			],
			callback: async (action) => {
				const method = action.options.op === 'start' ? 'Script.Start' : 'Script.Stop'
				await self.rpc.call(method, { id: Number(action.options.id) })
				self.poll()
			},
		},

		script_eval: {
			name: 'Script: Eval code in running script',
			options: [
				{
					type: 'dropdown',
					id: 'id',
					label: 'Script',
					default: scriptChoices[0]?.id ?? 1,
					choices: scriptChoices.length ? scriptChoices : [{ id: 1, label: 'Script 1' }],
				},
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
				const paramsRaw = await context.parseVariablesInString(action.options.params ?? '')
				const params = paramsRaw.trim() ? JSON.parse(paramsRaw) : undefined
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
}
