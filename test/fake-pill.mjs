// In-process fake Pill: HTTP POST /rpc and ws://<host>/rpc on one port, seeded from a
// real 2.0.1 GetComponents dump. Tests mutate `components` / `down` directly.
// Manual use: node test/fake-pill.mjs [port]
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { WebSocketServer } from 'ws'

const fixture = JSON.parse(readFileSync(new URL('./fixtures/pill-2.0.1.json', import.meta.url)))

export async function startFakePill({ port = 0, pageSize = 8 } = {}) {
	const components = new Map(
		fixture.components.map((c) => [c.key, structuredClone({ status: c.status, config: c.config })]),
	)
	const server = createServer()
	const wss = new WebSocketServer({ server, path: '/rpc' })
	let down = false

	const component = (type, id) => {
		const c = components.get(`${type}:${id}`)
		if (!c) throw { code: -105, message: `Argument 'id', value ${id} not found!` }
		return c
	}
	const handlers = {
		'Shelly.GetDeviceInfo': () => fake.deviceInfo,
		'Shelly.GetComponents': ({ offset = 0, include = [] } = {}) => {
			const all = [...components]
			if (offset > 0 && offset >= all.length)
				throw { code: -103, message: `Invalid argument 'offset': should be >= 0 and <= ${all.length - 1}!` }
			return {
				components: all.slice(offset, offset + pageSize).map(([key, c]) => ({
					key,
					...(include.includes('status') && { status: c.status }),
					...(include.includes('config') && { config: c.config }),
				})),
				cfg_rev: 1,
				offset,
				total: all.length,
			}
		},
		'Temperature.SetConfig': ({ id, config }) => {
			Object.assign(component('temperature', id).config, config)
			return { restart_required: false }
		},
	}

	const handle = async ({ id, method, params }) => {
		fake.calls.push(method)
		await fake.beforeCall?.(method, params) // may return a promise to delay the reply
		const h = handlers[method]
		if (!h) return { id, error: { code: 404, message: `No handler for ${method}` } }
		try {
			return { id, src: fake.deviceInfo.id, result: h(params) }
		} catch (error) {
			return { id, error }
		}
	}

	server.on('request', (req, res) => {
		if (down) return req.socket.destroy()
		if (req.method !== 'POST' || req.url !== '/rpc') return res.writeHead(404).end()
		// fake.httpStatus = 401 (password rejected, fresh nonce each time) or 429 (rate-limited)
		if (fake.httpStatus) {
			fake.refused = (fake.refused ?? 0) + 1
			const nonce = `n${fake.refused}`
			return res
				.writeHead(fake.httpStatus, {
					'WWW-Authenticate': `Digest qop="auth", realm="fake", nonce="${nonce}", algorithm=SHA-256`,
				})
				.end()
		}
		let body = ''
		req.on('data', (d) => (body += d))
		req.on('end', async () => {
			const reply = await handle(JSON.parse(body))
			if (down) return req.socket.destroy()
			res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(reply))
		})
	})
	wss.on('connection', (ws) => {
		if (down) return ws.terminate()
		ws.on('message', async (data) => {
			const msg = JSON.parse(data)
			ws.peer = msg.src
			fake.wsCalls.push(msg.method)
			const reply = await handle(msg)
			if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ ...reply, dst: msg.src }))
		})
	})
	const send = (method, params) => {
		for (const ws of wss.clients) {
			if (ws.peer) ws.send(JSON.stringify({ src: fake.deviceInfo.id, dst: ws.peer, method, params }))
		}
	}

	await new Promise((r) => server.listen(port, '127.0.0.1', r))
	const fake = {
		host: `127.0.0.1:${server.address().port}`,
		components,
		deviceInfo: structuredClone(fixture.deviceInfo),
		calls: [],
		wsCalls: [],
		get down() {
			return down
		},
		/** While down, HTTP requests get their socket destroyed and WebSocket clients are dropped. */
		set down(v) {
			down = v
			if (v) for (const ws of wss.clients) ws.terminate()
		},
		/** Push a status delta; it is merged into `components` too so later polls agree. */
		push(params) {
			for (const [k, v] of Object.entries(params)) {
				if (components.has(k)) Object.assign(components.get(k).status, v)
			}
			send('NotifyStatus', { ts: Date.now() / 1000, ...params })
		},
		event(events) {
			send('NotifyEvent', { ts: Date.now() / 1000, events })
		},
		close() {
			for (const ws of wss.clients) ws.terminate()
			wss.close()
			server.closeAllConnections()
			return new Promise((r) => server.close(r))
		},
	}
	return fake
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
	const fake = await startFakePill({ port: Number(process.argv[2] ?? 8099) })
	console.log(`Fake Pill on http://${fake.host}/rpc`)
}
