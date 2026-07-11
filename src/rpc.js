import { createHash, randomBytes } from 'node:crypto'

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

	constructor(host, password) {
		this.#host = host
		this.#password = password || ''
	}

	async call(method, params = undefined, timeoutMs = 5000) {
		const body = JSON.stringify({ id: this.#msgId++, src: 'companion', method, params })

		let res = await this.#post(body, timeoutMs)
		if (res.status === 401) {
			if (!this.#password) throw new Error('Device requires a password but none is configured')
			this.#challenge = this.#parseChallenge(res.headers.get('www-authenticate'))
			res = await this.#post(body, timeoutMs)
			if (res.status === 401) throw new Error('Authentication failed — check the device password')
		}
		if (!res.ok) throw new Error(`HTTP ${res.status} from device`)

		const json = await res.json()
		if (json.error) throw new Error(`RPC error ${json.error.code}: ${json.error.message}`)
		return json.result
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
		const nc = '00000001'
		const ha1 = sha256(`admin:${realm}:${this.#password}`)
		const ha2 = sha256('POST:/rpc')
		const response = sha256(`${ha1}:${nonce}:${nc}:${cnonce}:${qop || 'auth'}:${ha2}`)
		return (
			`Digest username="admin", realm="${realm}", nonce="${nonce}", uri="/rpc", ` +
			`response="${response}", qop=${qop || 'auth'}, nc=${nc}, cnonce="${cnonce}", algorithm=SHA-256`
		)
	}
}
