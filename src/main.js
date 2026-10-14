import { InstanceBase, InstanceStatus, runEntrypoint } from '@companion-module/base'
import { ShellyRpc } from './rpc.js'
import { ShellyWsClient } from './wsclient.js'
import { getConfigFields } from './config.js'
import { getVariableDefinitions, collectVariableValues, COMPONENT_RE } from './variables.js'
import { getActionDefinitions } from './actions.js'
import { getFeedbackDefinitions } from './feedbacks.js'
import { getPresetDefinitions } from './presets.js'

// Safety poll while pushing: an unplugged probe is silently deleted, not pushed, so this is its detection latency
const IDLE_POLL_INTERVAL = 15000
// While the password is wrong or the device is rate-limiting: every failed login extends the lockout for all clients
const FAULT_POLL_INTERVAL = 30000

const describe = (c) => (c.name ? `${c.name} (${c.type}:${c.id})` : `${c.type}:${c.id}`)

class ShellyPillInstance extends InstanceBase {
	rpc = null
	ws = null
	pollTimer = null
	lastStatus = null
	/** Component configs from the last full read; reused by pushed deltas. */
	lastConfigs = null
	deviceInfo = null
	/** Discovered components: [{ type, id, name }] */
	components = []
	#componentsKey = ''
	#polling = false
	/** key -> { c, misses, offline }. Survives across polls so absence can be debounced. */
	#knownSensors = new Map()
	#sensorBaseline = false
	/** null = unknown, true/false = last known reachability, so we log transitions only. */
	#deviceReachable = null
	/** Bumped whenever polling restarts, so a tick that was mid-poll doesn't re-arm a second chain. */
	#pollChain = 0
	#status = null
	#statusMessage = null
	/** An action asked for a poll while one was in flight; run one more afterwards. */
	#pollAgain = false
	/** Push just dropped while state came from push: probe with a short timeout so a dead device blanks fast. */
	#pushLost = false
	/** 'auth' | 'ratelimit' while the device refuses us; slows polling and is logged once. */
	#fault = null
	/** Pushes received while a poll is in flight; replayed over its (older) snapshot. */
	#pushesDuringPoll = null

	async init(config) {
		this.config = config
		await this.configUpdated(config)
	}

	async configUpdated(config) {
		this.config = config
		this.#teardown()

		this.lastStatus = null
		this.lastConfigs = null
		this.deviceInfo = null
		this.components = []
		this.#componentsKey = ''
		this.#knownSensors.clear()
		this.#sensorBaseline = false
		this.#deviceReachable = null
		this.#polling = false
		this.#pollAgain = false
		this.#pushLost = false
		this.#fault = null
		this.#pushesDuringPoll = null

		const host = config.bonjour_host || config.host || ''
		// Display only: a Bonjour pick is stored as 'ip:80'
		this.host = host.replace(/:80$/, '')
		if (!host) {
			this.updateStatus(InstanceStatus.BadConfig, 'No device IP configured')
			return
		}

		this.rpc = new ShellyRpc(host, config.password, (m) => this.vlog('trace', m))
		this.updateStatus(InstanceStatus.Connecting)

		// Definitions are rebuilt after the first successful poll discovers components
		this.#rebuildDefinitions()

		// Poll immediately either way: it proves the device is reachable and fills
		// values before the socket is up.
		this.#startPolling()

		if (config.useWebSocket) {
			this.ws = new ShellyWsClient(this, host, config.password)
			this.ws.connect()
		}
	}

	async destroy() {
		this.#teardown()
		this.rpc = null
		this.updateStatus(InstanceStatus.Disconnected)
	}

	#teardown() {
		this.#stopPolling()
		if (this.ws) {
			this.ws.destroy()
			this.ws = null
		}
	}

	getConfigFields() {
		return getConfigFields()
	}

	/** Every push frame re-asserts Ok; only forward real changes so the log isn't flooded. */
	updateStatus(status, message = null) {
		if (status === this.#status && message === this.#statusMessage) return
		this.#status = status
		this.#statusMessage = message
		super.updateStatus(status, message)
	}

	// Logs at 'info' on purpose: Companion runs with --log-level=info, which drops module debug output
	vlog(level, message) {
		const configured = this.config?.logLevel ?? 'normal'
		if (configured === 'normal') return
		if (level === 'trace' && configured !== 'trace') return
		this.log('info', `[${level}] ${message}`)
	}

	/** Dropdown choices for a component type, e.g. 'temperature' */
	choicesFor(type) {
		return this.components
			.filter((c) => c.type === type)
			.map((c) => ({
				id: c.id,
				fullId: `${c.type}:${c.id}`,
				label: describe(c),
			}))
	}

	/** Component picker (option id 'id'), falling back to the usual first id when none is discovered yet. */
	sensorOption(type, label) {
		const ch = this.choicesFor(type)
		const fb = type === 'switch' ? 0 : type === 'script' ? 1 : 200
		return {
			type: 'dropdown',
			id: 'id',
			label,
			default: ch[0]?.id ?? fb,
			choices: ch.length ? ch : [{ id: fb, label: `${type}:${fb}` }],
		}
	}

	// ---------------------------------------------------------------- WebSocket

	/** Called by the client once the device has accepted our first request. */
	onWsConnected(deviceInfo) {
		if (deviceInfo) this.#setDeviceInfo(deviceInfo)
		// Read full state now; later ticks slow to IDLE_POLL_INTERVAL because ws.connected is true
		this.#startPolling()
	}

	/** A rename in the Shelly web UI arrives as config_changed; re-read without waiting for the safety poll. */
	onWsConfigChanged() {
		this.vlog('verbose', 'Device reported a config change; re-syncing')
		this.poll()
	}

	/** Called by the client when an established socket closes. */
	onWsDisconnected() {
		this.vlog('verbose', 'Push lost; resuming poll interval')
		this.#pushLost = true
		this.#startPolling()
	}

	/** scheduled_restart: the device is going down now, so blank at once instead of after the ping watchdog. */
	onWsRebooting() {
		this.log('info', `Device at ${this.host} is rebooting`)
		this.#deviceReachable = false
		this.#markOffline('Device rebooting')
	}

	/** Record device info, logging the identity line whenever it is new or changed (e.g. after a firmware update). */
	#setDeviceInfo(info) {
		const prev = this.deviceInfo
		this.deviceInfo = info
		if (prev?.ver === info?.ver && prev?.name === info?.name && prev?.model === info?.model) return
		this.log('info', `Connected to ${info.model ?? 'Shelly'} "${info.name ?? info.id}" fw ${info.ver ?? '?'}`)
	}

	/**
	 * Apply a pushed notification.
	 *
	 * NotifyStatus carries only the fields that changed — a later frame for the same
	 * sensor may omit `errors` that an earlier one included — so merge per component
	 * rather than replacing, or unchanged fields would read as missing.
	 */
	onWsNotify(params) {
		this.#pushesDuringPoll?.push(params)
		if (!this.lastStatus) return // the poll onWsConnected starts seeds full state
		const status = { ...this.lastStatus }
		for (const [key, value] of Object.entries(params)) {
			if (key === 'ts') continue
			if (!(value && typeof value === 'object')) {
				status[key] = value
				continue
			}
			const merged = { ...(status[key] ?? {}), ...value }
			// A fresh reading without an errors field means the fault has cleared
			if (
				!('errors' in value) &&
				['tC', 'rh', 'voltage', 'state', 'percent'].some(
					(f) => typeof value[f] === 'number' || typeof value[f] === 'boolean',
				)
			) {
				delete merged.errors
			}
			status[key] = merged
		}
		this.applyStatus(status, null, false)
	}

	// ------------------------------------------------------------------ Polling

	/**
	 * Poll on a timer whose interval is recomputed each tick, so a WebSocket
	 * connecting or dropping mid-flight changes the cadence without a restart.
	 */
	#startPolling() {
		this.#stopPolling()
		const chain = this.#pollChain
		const configured = Math.max(250, Number(this.config.pollInterval) || 1000)
		const tick = async () => {
			await this.poll()
			// A restart while poll() was in flight already armed a new chain; let this one die.
			if (chain !== this.#pollChain) return
			this.pollTimer = setTimeout(
				tick,
				this.#fault ? FAULT_POLL_INTERVAL : this.ws?.connected ? IDLE_POLL_INTERVAL : configured,
			)
		}
		this.pollTimer = setTimeout(tick, 0)
	}

	#stopPolling() {
		this.#pollChain++
		if (this.pollTimer) {
			clearTimeout(this.pollTimer)
			this.pollTimer = null
		}
	}

	async poll() {
		if (!this.rpc) return
		if (this.#polling) {
			// An action's follow-up poll must not be lost to one that read pre-action state
			this.#pollAgain = true
			return
		}
		this.#polling = true
		this.#pushesDuringPoll = []
		const rpc = this.rpc
		try {
			const timeoutMs = this.#pushLost ? 1500 : 5000
			this.#pushLost = false
			const { status, configs } = await rpc.getAllComponents(timeoutMs)
			if (rpc !== this.rpc) return

			// Refetch after an outage too: it may have been a firmware update
			if (!this.deviceInfo || this.#deviceReachable === false) {
				const info = await rpc.call('Shelly.GetDeviceInfo')
				if (rpc !== this.rpc) return
				this.#setDeviceInfo(info)
			}

			if (this.#deviceReachable === false && !this.#fault) {
				this.log('info', `Device is back online at ${this.host}`)
			}
			if (this.#fault) this.log('info', `Device at ${this.host} is accepting requests again`)
			this.#fault = null
			this.#deviceReachable = true

			this.applyStatus(status, configs)
			// The snapshot was read before these arrived; without replaying them a fresh reading would regress
			const late = this.#pushesDuringPoll
			this.#pushesDuringPoll = null
			for (const p of late) this.onWsNotify(p)
		} catch (err) {
			if (rpc !== this.rpc) return
			// The device answered but refused us: a config problem, not an outage, and never hidden behind push
			if (err.kind) {
				if (this.#fault !== err.kind)
					this.log('error', `${err.message}. Retrying every ${FAULT_POLL_INTERVAL / 1000} s.`)
				this.#fault = err.kind
				this.#markOffline(
					err.message,
					err.kind === 'auth' ? InstanceStatus.AuthenticationFailure : InstanceStatus.ConnectionFailure,
				)
				return
			}
			// The socket has its own ping watchdog; one slow HTTP poll while push is healthy is not an outage
			if (this.ws?.connected) {
				this.vlog('verbose', `Safety poll failed while push is connected: ${err.message ?? err}`)
				return
			}
			// HTTP failing too (not just push) is what proves the unit itself is gone; say so once
			if (this.#deviceReachable !== false) {
				this.#deviceReachable = false
				if (/-109|shutting down/i.test(err.message ?? '')) {
					this.log('info', `Device at ${this.host} is rebooting`)
				} else
					this.log(
						'error',
						`Device offline: no response from ${this.host} (${err.message ?? err}). ` +
							`It may be powered off, off the network, or on a different address. All sensor readings are stale.`,
					)
			}
			this.#markOffline(`Device offline — no response from ${this.host}`)
		} finally {
			if (rpc === this.rpc) {
				this.#pushesDuringPoll = null
				this.#polling = false
			}
			if (this.#pollAgain && rpc === this.rpc) {
				this.#pollAgain = false
				await this.poll()
			}
		}
	}

	// ------------------------------------------------------------------- Shared

	/** Readings go to '-' rather than going stale. */
	#markOffline(message, status = InstanceStatus.ConnectionFailure) {
		this.lastStatus = null
		this.setVariableValues(collectVariableValues({}, this.deviceInfo, this.components))
		this.checkFeedbacks()
		this.updateStatus(status, message)
	}

	/** Single path for new state, whether it arrived by poll or by push. */
	applyStatus(status, configs, authoritative = true) {
		this.lastStatus = status
		if (configs) this.lastConfigs = configs
		this.#discoverComponents(status, configs, authoritative)
		this.vlog('trace', `Applying status: ${Object.keys(status).join(', ')}`)
		this.setVariableValues(collectVariableValues(status, this.deviceInfo, this.components))
		this.checkFeedbacks()
		const offline = [...this.#knownSensors.values()].filter((e) => e.offline).map((e) => describe(e.c))
		if (offline.length) this.updateStatus(InstanceStatus.UnknownWarning, `Sensor offline: ${offline.join(', ')}`)
		else this.updateStatus(InstanceStatus.Ok)
	}

	#discoverComponents(status, configs, authoritative = true) {
		const found = []
		for (const key of Object.keys(status)) {
			const m = key.match(COMPONENT_RE)
			if (m) found.push({ type: m[1], id: Number(m[2]), name: null })
		}

		// Push deltas pass configs=null; names then come from the last full read
		for (const c of found) c.name = (configs ?? this.lastConfigs)?.[`${c.type}:${c.id}`]?.name ?? null
		// Debounce before the unchanged-list early return, or misses would never count
		this.#announceSensorChanges(found, authoritative)
		// Keep a vanished sensor's variables, choice and preset (reading '-') until the connection is re-saved.
		// This also means a push frame (never a complete list) can only add components, never drop one.
		const present = new Set(found.map((c) => `${c.type}:${c.id}`))
		for (const c of this.components) if (!present.has(`${c.type}:${c.id}`)) found.push({ ...c })
		found.sort((a, b) => a.type.localeCompare(b.type) || a.id - b.id)

		// Names are part of the key so renaming a sensor on the device refreshes
		// variable labels and presets without disabling/re-enabling the connection.
		const key = found.map((c) => `${c.type}:${c.id}=${c.name ?? ''}`).join(',')
		if (key === this.#componentsKey) return
		this.#componentsKey = key

		this.components = found
		this.log('info', `Discovered components: ${found.length ? found.map(describe).join(', ') : 'none'}`)
		this.#rebuildDefinitions()
	}

	// Unplugging deletes the component silently. Only full reads count (NotifyFullStatus omits peripherals), and two misses in a row before "offline"
	#announceSensorChanges(found, authoritative) {
		if (!authoritative) return

		const seen = new Set()

		for (const c of found) {
			const key = `${c.type}:${c.id}`
			seen.add(key)
			const entry = this.#knownSensors.get(key)
			if (!entry) {
				this.#knownSensors.set(key, { c, misses: 0, offline: false })
				// The first read establishes the baseline; "Discovered components" covers it.
				if (this.#sensorBaseline) this.log('info', `Sensor online: ${describe(c)}`)
			} else {
				if (entry.offline) this.log('info', `Sensor back online: ${describe(c)}`)
				entry.c = c
				entry.misses = 0
				entry.offline = false
			}
		}

		for (const [key, entry] of this.#knownSensors) {
			if (seen.has(key)) continue
			entry.misses++
			if (!entry.offline && entry.misses >= 2) {
				entry.offline = true
				this.log('warn', `Sensor offline: ${describe(entry.c)} is no longer reported by the device`)
			}
		}

		this.#sensorBaseline = true
	}

	#rebuildDefinitions() {
		this.setVariableDefinitions(getVariableDefinitions(this.components))
		this.setActionDefinitions(getActionDefinitions(this))
		this.setFeedbackDefinitions(getFeedbackDefinitions(this))
		this.setPresetDefinitions(getPresetDefinitions(this))
	}
}

/**
 * 1.0.x had a module-wide tempUnit; temperature feedbacks now carry their own
 * unit, so stamp the old choice onto existing feedbacks instead of silently
 * switching them to °C.
 */
function upgradeTempUnit(_context, props) {
	const unit = props.config?.tempUnit === 'f' ? 'f' : 'c'
	const updatedFeedbacks = []
	for (const fb of props.feedbacks) {
		if (['temperature_above', 'temperature_below'].includes(fb.feedbackId) && fb.options.unit === undefined) {
			fb.options.unit = unit
			updatedFeedbacks.push(fb)
		}
	}
	let updatedConfig = null
	if (props.config && props.config.useWebSocket === undefined) {
		updatedConfig = { ...props.config, useWebSocket: true, logLevel: props.config.logLevel ?? 'normal' }
		delete updatedConfig.tempUnit
	}
	return { updatedConfig, updatedActions: [], updatedFeedbacks }
}

runEntrypoint(ShellyPillInstance, [upgradeTempUnit])
