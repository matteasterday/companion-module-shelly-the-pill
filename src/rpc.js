import { createHash, randomBytes } from 'node:crypto'

/** `kind` lets the instance tell a config problem ('auth', 'ratelimit') from an unreachable device. */
const rpcError = (message, kind) => Object.assign(new Error(message), { kind })

const sha256 = (s) => createHash('sha256').update(s).digest('hex')

/**
 * Minimal JSON-RPC over HTTP client for Shelly Gen2+ devices.
 * Handles the SHA-256 HTTP digest authentication (RFC 7616) used by
 * password-protected Shelly devices (username is always "admin").
 */
export class ShellyRpc {
	#host
	#password
	#msgId = 1
	#challenge = null
	#nc = 0
	#onTrace = null

	/** `onTrace` receives a line per request when trace logging is enabled. */
	constructor(host, password, onTrace) {
		this.#host = host
		this.#password = password || ''
		this.#onTrace = onTrace
	}

	async call(method, params = undefined, timeoutMs = 5000) {
		const body = JSON.stringify({ id: this.#msgId++, src: 'companion', method, params })

		let res = await this.#post(body, timeoutMs)
		// A 401 on the cached challenge (stale nonce) earns one retry with the new one. If the
		// challenge we just fetched is rejected too, the password is wrong: every rejection carries
		// a fresh nonce, so retrying would only draw a 429. The exception is a concurrent call
		// replacing the challenge mid-flight, which resets our nc.
		let mine = null
		let retries = 0
		let throttled = 0
		for (;;) {
			// fw 2.0.1 answers 429 to a request for a new challenge within ~1-2 s of the last one
			// (e.g. concurrent first calls). It is a short penalty, not a lockout; by the retry
			// the challenge is usually known and the request goes through authenticated.
			if (res.status === 429) {
				if (++throttled > 3) {
					throw rpcError('Device is rate-limiting requests (too many failed logins from some client?)', 'ratelimit')
				}
				await new Promise((r) => setTimeout(r, 1000 * throttled))
				res = await this.#post(body, timeoutMs)
				continue
			}
			if (res.status !== 401) break
			if (!this.#password) throw rpcError('Device requires a password but none is configured', 'auth')
			if ((mine && this.#challenge === mine) || ++retries > 2) {
				throw rpcError('Authentication failed — check the device password', 'auth')
			}
			mine = this.#parseChallenge(res.headers.get('www-authenticate'))
			this.#challenge = mine
			this.#nc = 0
			res = await this.#post(body, timeoutMs)
		}
		if (!res.ok) throw new Error(`HTTP ${res.status} from device`)

		const json = await res.json()
		if (json.error) {
			this.#onTrace?.(`HTTP ${method} -> error ${json.error.code}: ${json.error.message}`)
			throw new Error(`RPC error ${json.error.code}: ${json.error.message}`)
		}
		this.#onTrace?.(`HTTP ${method} -> ${JSON.stringify(json.result).slice(0, 200)}`)
		return json.result
	}

	/**
	 * Every component's status and config, keyed like 'sys' / 'temperature:200'.
	 * Shelly.GetStatus omits Pill peripherals, so this pages Shelly.GetComponents.
	 */
	async getAllComponents(timeoutMs = 5000) {
		const status = {}
		const configs = {}
		let offset = 0
		for (;;) {
			let res
			try {
				res = await this.call('Shelly.GetComponents', { offset, include: ['status', 'config'] }, timeoutMs)
			} catch (err) {
				// A component vanished mid-paging; keep the partial set, the sensor debounce absorbs it
				if (offset > 0 && /-103/.test(err.message)) break
				throw err
			}
			const batch = res?.components ?? []
			for (const c of batch) {
				if (!c?.key) continue
				status[c.key] = c.status ?? {}
				configs[c.key] = c.config ?? {}
			}
			offset += batch.length
			// Guard against a device that returns an empty page while claiming more
			if (batch.length === 0 || offset >= Number(res?.total ?? offset)) break
		}
		return { status, configs }
	}

	async #post(body, timeoutMs) {
		const headers = { 'Content-Type': 'application/json' }
		if (this.#challenge) headers['Authorization'] = this.#authHeader()

		return fetch(`http://${this.#host}/rpc`, {
			method: 'POST',
			headers,
			body,
			signal: AbortSignal.timeout(timeoutMs),
		})
	}

	#parseChallenge(header) {
		if (!header) throw new Error('Device sent 401 without an authentication challenge')
		const fields = {}
		for (const m of header.matchAll(/(\w+)=(?:"([^"]*)"|([^,\s]+))/g)) {
			fields[m[1]] = m[2] ?? m[3]
		}
		return fields
	}

	#authHeader() {
		const { realm, nonce, qop } = this.#challenge
		const cnonce = randomBytes(8).toString('hex')
		// Firmware 2.0+ rejects a reused nc for the same nonce, so count up per request
		const nc = (++this.#nc).toString(16).padStart(8, '0')
		const ha1 = sha256(`admin:${realm}:${this.#password}`)
		const ha2 = sha256('POST:/rpc')
		const response = sha256(`${ha1}:${nonce}:${nc}:${cnonce}:${qop || 'auth'}:${ha2}`)
		return (
			`Digest username="admin", realm="${realm}", nonce="${nonce}", uri="/rpc", ` +
			`response="${response}", qop=${qop || 'auth'}, nc=${nc}, cnonce="${cnonce}", algorithm=SHA-256`
		)
	}
}
