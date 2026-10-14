import WebSocket from 'ws'
import { createHash, randomBytes } from 'node:crypto'

const sha256 = (s) => createHash('sha256').update(s).digest('hex')

/**
 * Client for the device's own WebSocket at ws://<device>/rpc.
 *
 * Every Gen2+ Shelly hosts this endpoint and pushes NotifyStatus / NotifyEvent to
 * each connected client once that client has sent one request (which tells the
 * device its `src`). Many clients can connect at once, so any number of Companion
 * instances can watch one device, and nothing on the device has to be configured
 * or rebooted — unlike outbound WebSocket, which holds a single server address.
 */

// Two missed pongs close the socket: a device that loses power never sends a TCP close
const PING_INTERVAL = 5000
/** Reconnect backoff bounds. */
const RECONNECT_MIN = 2000
const RECONNECT_MAX = 30000

export class ShellyWsClient {
	#instance
	#host
	#password
	/** Unique per connection: the device routes replies by src, so two Companions must not share one. */
	#src = `companion-${randomBytes(4).toString('hex')}`
	#socket = null
	#destroyed = false
	#msgId = 1
	#pending = new Map()
	#pingTimer = null
	#missedPongs = 0
	#reconnectTimer = null
	#reconnectDelay = RECONNECT_MIN
	/** Digest challenge from the last 401, reused until the device rejects it. */
	#challenge = null
	#nc = 0
	#lastError = null

	constructor(instance, host, password) {
		this.#instance = instance
		this.#host = host
		this.#password = password || ''
	}

	/** True once the socket is open and the device has accepted a request (so it is pushing). */
	connected = false

	connect() {
		if (this.#destroyed) return
		const url = `ws://${this.#host}/rpc`
		this.#instance.vlog('verbose', `Opening WebSocket to ${url}`)
		const socket = new WebSocket(url, { handshakeTimeout: 5000 })
		this.#socket = socket

		socket.on('open', () => this.#onOpen(socket))
		socket.on('message', (data) => this.#onMessage(data))
		socket.on('pong', () => {
			this.#missedPongs = 0
		})
		socket.on('error', (err) => this.#instance.vlog('verbose', `WebSocket error: ${err.message}`))
		socket.on('close', () => this.#onClose(socket))
	}

	async #onOpen(socket) {
		if (socket !== this.#socket) return
		this.#missedPongs = 0
		this.#startPing()
		try {
			// The device only pushes to clients it has heard from. GetDeviceInfo doubles as
			// that registration and as the auth handshake when a password is set.
			const info = await this.call('Shelly.GetDeviceInfo')
			if (socket !== this.#socket) return
			this.connected = true
			this.#reconnectDelay = RECONNECT_MIN
			this.#lastError = null
			this.#instance.log('info', `Push connected to ws://${this.#host}/rpc`)
			this.#instance.onWsConnected(info)
		} catch (err) {
			if (this.#destroyed || socket !== this.#socket) return
			// Log once per failure kind, not on every backoff retry (a wrong password retries forever)
			if (err.message !== this.#lastError) {
				this.#lastError = err.message
				this.#instance.log('warn', `WebSocket handshake failed: ${err.message}. Continuing with polling.`)
			}
			socket.terminate()
		}
	}

	#onClose(socket) {
		if (socket !== this.#socket) return
		this.#socket = null
		this.#stopPing()
		this.#rejectAllPending(new Error('WebSocket closed'))
		const wasConnected = this.connected
		this.connected = false
		if (this.#destroyed) return
		if (wasConnected) {
			this.#instance.log('warn', 'Push disconnected — polling until it returns')
			this.#instance.onWsDisconnected()
		}
		this.#reconnectTimer = setTimeout(() => {
			this.#reconnectTimer = null
			this.connect()
		}, this.#reconnectDelay)
		this.#reconnectDelay = Math.min(this.#reconnectDelay * 2, RECONNECT_MAX)
	}

	#startPing() {
		this.#stopPing()
		this.#pingTimer = setInterval(() => {
			const socket = this.#socket
			if (!socket || socket.readyState !== WebSocket.OPEN) return
			if (this.#missedPongs >= 2) {
				this.#instance.log('warn', 'WebSocket ping timeout — closing dead socket')
				socket.terminate()
				return
			}
			this.#missedPongs++
			socket.ping()
		}, PING_INTERVAL)
	}

	#stopPing() {
		if (this.#pingTimer) {
			clearInterval(this.#pingTimer)
			this.#pingTimer = null
		}
	}

	#onMessage(data) {
		const raw = data.toString()
		this.#instance.vlog('trace', `WS in: ${raw.slice(0, 300)}`)

		let msg
		try {
			msg = JSON.parse(raw)
		} catch {
			this.#instance.log('warn', 'Ignoring non-JSON WebSocket frame')
			return
		}

		// Reply to one of our own requests
		if (msg.id != null && this.#pending.has(msg.id)) {
			const entry = this.#pending.get(msg.id)
			this.#pending.delete(msg.id)
			clearTimeout(entry.timer)
			if (msg.error?.code === 401 && !entry.retried) {
				this.#retryWithAuth(entry, msg.error)
				return
			}
			msg.error
				? entry.reject(new Error(`RPC error ${msg.error.code}: ${msg.error.message}`))
				: entry.resolve(msg.result)
			return
		}

		switch (msg.method) {
			case 'NotifyStatus':
			case 'NotifyFullStatus':
				this.#instance.onWsNotify(msg.params ?? {})
				break
			case 'NotifyEvent':
				for (const ev of msg.params?.events ?? []) {
					this.#instance.vlog('verbose', `Device event: ${ev.component} ${ev.event}`)
					if (ev.event === 'config_changed') this.#instance.onWsConfigChanged()
					if (ev.event === 'scheduled_restart') this.#instance.onWsRebooting()
				}
				break
			default:
				if (msg.method) this.#instance.vlog('verbose', `Unhandled WebSocket method: ${msg.method}`)
		}
	}

	/**
	 * Over WebSocket, digest auth travels inside the request as an `auth` object.
	 * The 401's message is a JSON challenge carrying realm and nonce.
	 */
	#retryWithAuth(entry, error) {
		if (!this.#password) return entry.reject(new Error('Device requires a password but none is configured'))
		try {
			this.#challenge = JSON.parse(error.message)
			this.#nc = 0
		} catch {
			return entry.reject(new Error(`Unexpected auth challenge: ${error.message}`))
		}
		this.#send(entry.method, entry.params, entry.timeoutMs, { ...entry, retried: true })
	}

	#authObject() {
		if (!this.#challenge) return undefined
		const { realm, nonce } = this.#challenge
		// Firmware 2.0+ tracks nc per nonce and wants it strictly increasing, as 8 hex digits
		const nc = (++this.#nc).toString(16).padStart(8, '0')
		const cnonce = randomBytes(8).toString('hex')
		const ha1 = sha256(`admin:${realm}:${this.#password}`)
		const ha2 = sha256('dummy_method:dummy_uri')
		const response = sha256(`${ha1}:${nonce}:${nc}:${cnonce}:auth:${ha2}`)
		return { realm, username: 'admin', nonce, cnonce, nc, response, algorithm: 'SHA-256' }
	}

	/** Issue an RPC request over the socket. */
	call(method, params = undefined, timeoutMs = 5000) {
		return new Promise((resolve, reject) => {
			this.#send(method, params, timeoutMs, { resolve, reject, retried: false })
		})
	}

	#send(method, params, timeoutMs, entry) {
		const socket = this.#socket
		if (!socket || socket.readyState !== WebSocket.OPEN) {
			return entry.reject(new Error('No WebSocket connection to the device'))
		}
		const id = this.#msgId++
		const timer = setTimeout(() => {
			this.#pending.delete(id)
			entry.reject(new Error(`WebSocket RPC ${method} timed out`))
		}, timeoutMs)
		this.#pending.set(id, { ...entry, method, params, timeoutMs, timer })

		const frame = { id, src: this.#src, method, params }
		const auth = this.#authObject()
		if (auth) frame.auth = auth
		this.#instance.vlog('trace', `WS out: ${method} ${params ? JSON.stringify(params) : ''}`)
		socket.send(JSON.stringify(frame), (err) => {
			if (!err) return
			this.#pending.delete(id)
			clearTimeout(timer)
			entry.reject(err)
		})
	}

	#rejectAllPending(err) {
		for (const { reject, timer } of this.#pending.values()) {
			clearTimeout(timer)
			reject(err)
		}
		this.#pending.clear()
	}

	destroy() {
		this.#destroyed = true
		this.connected = false
		this.#stopPing()
		if (this.#reconnectTimer) {
			clearTimeout(this.#reconnectTimer)
			this.#reconnectTimer = null
		}
		this.#rejectAllPending(new Error('Module shutting down'))
		if (this.#socket) {
			this.#socket.removeAllListeners()
			this.#socket.on('error', () => {})
			this.#socket.terminate()
			this.#socket = null
		}
	}
}
