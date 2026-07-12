import { InstanceBase, InstanceStatus, runEntrypoint } from '@companion-module/base'
import { ShellyRpc } from './rpc.js'
import { getConfigFields } from './config.js'
import { getVariableDefinitions, collectVariableValues } from './variables.js'
import { getActionDefinitions } from './actions.js'
import { getFeedbackDefinitions } from './feedbacks.js'
import { getPresetDefinitions } from './presets.js'

const COMPONENT_RE = /^(temperature|humidity|voltmeter|input|switch|script):(\d+)$/

class ShellyPillInstance extends InstanceBase {
	rpc = null
	pollTimer = null
	lastStatus = null
	deviceInfo = null
	/** Discovered components: [{ type, id, name }] */
	components = []
	#componentsKey = ''
	#polling = false

	async init(config) {
		this.config = config
		await this.configUpdated(config)
	}

	async configUpdated(config) {
		this.config = config
		this.#stopPolling()
		this.lastStatus = null
		this.deviceInfo = null
		this.components = []
		this.#componentsKey = ''

		if (!config.host) {
			this.updateStatus(InstanceStatus.BadConfig, 'No device IP configured')
			return
		}

		this.rpc = new ShellyRpc(config.host, config.password)
		this.updateStatus(InstanceStatus.Connecting)

		// Definitions are rebuilt after the first successful poll discovers components
		this.#rebuildDefinitions()
		this.#startPolling()
	}

	async destroy() {
		this.#stopPolling()
	}

	getConfigFields() {
		return getConfigFields()
	}

	/** Configured temperature unit: 'c' or 'f' */
	get tempUnit() {
		return this.config?.tempUnit === 'f' ? 'f' : 'c'
	}

	/** Dropdown choices for a component type, e.g. 'temperature' */
	choicesFor(type) {
		return this.components
			.filter((c) => c.type === type)
			.map((c) => ({
				id: c.id,
				fullId: `${c.type}:${c.id}`,
				label: c.name ? `${c.name} (${c.type}:${c.id})` : `${c.type}:${c.id}`,
			}))
	}

	#startPolling() {
		const interval = Math.max(250, Number(this.config.pollInterval) || 1000)
		const tick = async () => {
			await this.poll()
			this.pollTimer = setTimeout(tick, interval)
		}
		tick()
	}

	#stopPolling() {
		if (this.pollTimer) {
			clearTimeout(this.pollTimer)
			this.pollTimer = null
		}
	}

	async poll() {
		if (!this.rpc || this.#polling) return
		this.#polling = true
		try {
			const status = await this.rpc.call('Shelly.GetStatus')
			this.lastStatus = status

			if (!this.deviceInfo) {
				this.deviceInfo = await this.rpc.call('Shelly.GetDeviceInfo')
				this.log('info', `Connected to ${this.deviceInfo.model ?? 'Shelly'} "${this.deviceInfo.name ?? this.deviceInfo.id}" fw ${this.deviceInfo.ver ?? '?'}`)
			}

			await this.#discoverComponents(status)

			this.setVariableValues(collectVariableValues(status, this.deviceInfo))
			this.checkFeedbacks()
			this.updateStatus(InstanceStatus.Ok)
		} catch (err) {
			this.lastStatus = null
			this.checkFeedbacks()
			this.updateStatus(InstanceStatus.ConnectionFailure, String(err.message ?? err))
		} finally {
			this.#polling = false
		}
	}

	async #discoverComponents(status) {
		const found = []
		for (const key of Object.keys(status)) {
			const m = key.match(COMPONENT_RE)
			if (m) found.push({ type: m[1], id: Number(m[2]), name: null })
		}
		found.sort((a, b) => a.type.localeCompare(b.type) || a.id - b.id)

		const key = found.map((c) => `${c.type}:${c.id}`).join(',')
		if (key === this.#componentsKey) return
		this.#componentsKey = key

		// Fetch config once to pick up user-assigned component names
		try {
			const cfg = await this.rpc.call('Shelly.GetConfig')
			for (const c of found) {
				c.name = cfg?.[`${c.type}:${c.id}`]?.name ?? null
			}
		} catch (err) {
			this.log('debug', `Could not fetch component names: ${err.message}`)
		}

		this.components = found
		this.log(
			'info',
			`Discovered components: ${found.length ? found.map((c) => c.name ? `${c.type}:${c.id} (${c.name})` : `${c.type}:${c.id}`).join(', ') : 'none'}`,
		)
		this.#rebuildDefinitions()
	}

	#rebuildDefinitions() {
		this.setVariableDefinitions(getVariableDefinitions(this.components))
		this.setActionDefinitions(getActionDefinitions(this))
		this.setFeedbackDefinitions(getFeedbackDefinitions(this))
		this.setPresetDefinitions(getPresetDefinitions(this))
	}
}

runEntrypoint(ShellyPillInstance, [])
