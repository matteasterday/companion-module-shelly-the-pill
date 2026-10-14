// The real module against the in-process fake Pill. Append scenarios here.
import assert from 'node:assert'
import { test } from 'node:test'
import { register } from 'node:module'
import { startFakePill } from './fake-pill.mjs'
const stub = JSON.stringify(new URL('./stub.mjs', import.meta.url).href)
register(
	'data:text/javascript,' +
		encodeURIComponent(
			`export async function resolve(s,c,n){return s==='@companion-module/base'?{url:${stub},shortCircuit:true}:n(s,c)}`,
		),
)
await import('../src/main.js')
const Instance = globalThis.__inst.constructor

const until = async (cond, ms = 5000) => {
	for (const end = Date.now() + ms; !cond(); await new Promise((r) => setTimeout(r, 20))) {
		if (Date.now() > end) throw new Error(`Timed out waiting for ${cond}`)
	}
}

/** Start a fake and a fresh instance on it; the caller must `await stop()`. */
async function connect(config = {}, fakeOpts) {
	const fake = await startFakePill(fakeOpts)
	const inst = new Instance()
	await inst.init({ host: fake.host, pollInterval: 250, useWebSocket: true, logLevel: 'normal', ...config })
	const stop = async () => {
		await inst.destroy()
		await fake.close()
	}
	return { fake, inst, stop }
}

for (const useWebSocket of [true, false]) {
	test(`baseline (useWebSocket=${useWebSocket})`, async () => {
		const { fake, inst, stop } = await connect({ useWebSocket })
		try {
			await until(() => /^-?\d+(\.\d+)?$/.test(inst.vars.temp_200_c ?? ''))
			if (useWebSocket) {
				await until(() => inst.ws?.connected)
				fake.push({ 'temperature:200': { tC: 30.25 } })
				await until(() => inst.vars.temp_200_c === '30.3')
			}
			assert.equal(inst.status, 'ok')
			assert.ok(inst.defs.vars.some((d) => d.variableId === 'temp_200_c'))
			assert.ok(fake.calls.includes('Shelly.GetComponents'))
		} finally {
			await stop()
		}
	})
}

test('push mode reads only GetComponents, over HTTP', async () => {
	const { fake, inst, stop } = await connect()
	try {
		await until(() => inst.ws?.connected && fake.calls.filter((m) => m === 'Shelly.GetComponents').length >= 2)
		assert.ok(!fake.calls.includes('Shelly.GetStatus'))
		assert.ok(!fake.calls.includes('Shelly.GetConfig'))
		assert.deepEqual(fake.wsCalls, ['Shelly.GetDeviceInfo'])
	} finally {
		await stop()
	}
})

test('a component vanishing mid-paging is not "Device offline"', async () => {
	const { fake, inst, stop } = await connect({ useWebSocket: false }, { pageSize: 4 })
	try {
		let cut = false
		fake.beforeCall = (m, p) => {
			// 9 -> 8 components just before the offset-8 page, so the device answers -103
			if (m === 'Shelly.GetComponents' && p?.offset === 8 && !cut) {
				cut = true
				fake.components.delete('ble')
			}
		}
		await until(() => cut)
		const n = fake.calls.length
		await until(() => fake.calls.slice(n).filter((m) => m === 'Shelly.GetComponents').length >= 4)
		assert.ok(inst.statuses.every(([s]) => s !== 'connection_failure'))
		assert.equal(inst.status, 'ok')
		assert.ok(inst.vars.temp_200_c)
	} finally {
		await stop()
	}
})

const NUM = /^-?\d+(\.\d+)?$/
const polls = (fake) => fake.calls.filter((m) => m === 'Shelly.GetComponents').length

test('unplugged probe reads "-", stays defined, and logs offline/back online once', async () => {
	const { fake, inst, stop } = await connect({ useWebSocket: false })
	try {
		await until(() => NUM.test(inst.vars.temp_200_c ?? ''))
		const probe = fake.components.get('temperature:200')
		fake.components.delete('temperature:200')
		const n = polls(fake)
		await until(() => inst.vars.temp_200_c === '-')
		assert.ok(inst.defs.vars.some((d) => d.variableId === 'temp_200_c'))
		await until(() => polls(fake) >= n + 3)
		assert.equal(inst.logs.filter(([l, m]) => l === 'warn' && /Sensor offline/.test(m)).length, 1)
		assert.equal(inst.status, 'unknown_warning')
		// A push naming a component the last poll lacked must not drop the kept probe
		inst.onWsNotify({ 'switch:0': { output: false } })
		assert.ok(inst.components.some((c) => c.type === 'temperature' && c.id === 200))
		fake.components.set('temperature:200', probe)
		await until(() => inst.logs.some(([, m]) => /back online/.test(m)))
		await until(() => NUM.test(inst.vars.temp_200_c) && inst.status === 'ok')
	} finally {
		await stop()
	}
})

test('device offline blanks readings within 2 s', async () => {
	const { fake, inst, stop } = await connect({ useWebSocket: false })
	try {
		await until(() => NUM.test(inst.vars.temp_200_c ?? ''))
		fake.down = true
		await until(() => inst.vars.temp_200_c === '-' && inst.status === 'connection_failure', 2000)
		fake.down = false
		await until(() => NUM.test(inst.vars.temp_200_c) && inst.status === 'ok')
	} finally {
		await stop()
	}
})

test('scheduled_restart blanks readings at once', async () => {
	const { fake, inst, stop } = await connect()
	try {
		await until(() => inst.ws?.connected && NUM.test(inst.vars.temp_200_c ?? ''))
		fake.event([{ component: 'sys', event: 'scheduled_restart' }])
		await until(() => inst.vars.temp_200_c === '-' && inst.status === 'connection_failure', 500)
		assert.ok(!inst.logs.some(([l]) => l === 'error'))
	} finally {
		await stop()
	}
})

test('collectVariableValues blanks a component missing from status', async () => {
	const { collectVariableValues } = await import('../src/variables.js')
	assert.equal(collectVariableValues({}, null, [{ type: 'temperature', id: 200 }]).temp_200_c, '-')
})

test('presets end with the OFFLINE overlay; absent types are hidden', async () => {
	const { inst, stop } = await connect({ useWebSocket: false })
	try {
		await until(() => inst.defs.presets?.temp_200_c)
		const sensors = Object.values(inst.defs.presets).filter((p) => /Temperature|Humidity|Voltage/.test(p.category))
		assert.ok(sensors.length >= 2)
		for (const p of sensors) {
			assert.equal(p.feedbacks.at(-1).feedbackId, 'sensor_error')
			assert.equal(p.style.show_topbar, false)
		}
		assert.ok(inst.defs.feedbacks.temperature_above && !inst.defs.feedbacks.humidity_above)
	} finally {
		await stop()
	}
})

test('health variables, Calibrate and Learn', async () => {
	const { fake, inst, stop } = await connect({ useWebSocket: false })
	try {
		Object.assign(fake.components.get('sys').status, {
			available_updates: { stable: { version: '2.1.0' } },
			uptime: 93784,
		})
		await until(() => inst.vars.update_available === '2.1.0')
		assert.equal(inst.vars.uptime_text, '1d 2h 3m')
		assert.equal(inst.vars.restart_required, 'No')
		await inst.defs.actions.sensor_calibrate.callback({ options: { id: 200, offset_C: -1.5, report_thr_C: 0.5 } })
		assert.equal(fake.components.get('temperature:200').config.offset_C, -1.5)
		assert.equal(fake.components.get('temperature:200').config.report_thr_C, 0.5)
		const tC = fake.components.get('temperature:200').status.tC
		const learned = inst.defs.feedbacks.temperature_above.learn({ options: { id: 200, unit: 'c', threshold: 27 } })
		assert.equal(learned.threshold, Math.round(tC * 10) / 10)
	} finally {
		await stop()
	}
})

test('bonjour pick (ip:port) with empty manual host connects', async () => {
	const fake = await startFakePill()
	const inst = new Instance()
	try {
		await inst.init({ bonjour_host: fake.host, host: '', pollInterval: 250, useWebSocket: true, logLevel: 'normal' })
		await until(() => inst.status === 'ok' && inst.ws?.connected)
	} finally {
		await inst.destroy()
		await fake.close()
	}
})

test('wrong password and rate limit: named status, readings blank, no hammering, recovers', async () => {
	const { fake, inst, stop } = await connect({ useWebSocket: false, password: 'wrong' })
	try {
		await until(() => inst.status === 'ok')
		fake.httpStatus = 401
		await until(() => inst.status === 'authentication_failure')
		assert.equal(inst.vars.temp_200_c, '-')
		// One poll = initial request + at most two retries; then it waits 30 s instead of 250 ms
		const refused = fake.refused
		assert.ok(refused <= 3, `${refused} requests for one failed login`)
		await new Promise((r) => setTimeout(r, 1000))
		assert.equal(fake.refused, refused)
		assert.equal(inst.logs.filter(([, m]) => /Authentication failed/.test(m)).length, 1)
		assert.ok(!inst.logs.some(([, m]) => /Device offline/.test(m)))

		fake.httpStatus = 429
		inst.poll()
		// a short 429 is retried (1 + 2 + 3 s) before it counts as a fault
		await until(() => inst.statuses.at(-1)?.[1]?.includes('rate-limiting'), 10000)
		assert.equal(inst.status, 'connection_failure')

		// one 429 then success: retried inside the call, no fault
		fake.httpStatus = 0
		await inst.poll()
		assert.equal(inst.status, 'ok')
		fake.httpStatus = 429
		setTimeout(() => (fake.httpStatus = 0), 300)
		await inst.poll()
		assert.equal(inst.status, 'ok')
		assert.ok(inst.logs.some(([, m]) => /accepting requests again/.test(m)))
	} finally {
		await stop()
	}
})

test('a push that lands during a poll is not overwritten by the older snapshot', async () => {
	const { fake, inst, stop } = await connect({ useWebSocket: true })
	try {
		await until(() => inst.ws?.connected && inst.vars.temp_200_c !== undefined && inst.status === 'ok')
		let pushed = false
		// temperature:200 is on page 1, so by page 2 this poll's snapshot is already older than the push
		fake.beforeCall = (m, p) => {
			if (m === 'Shelly.GetComponents' && p?.offset > 0 && !pushed) {
				pushed = true
				// sent over WS before this page's HTTP reply, so it reaches the module mid-poll
				fake.push({ 'temperature:200': { tC: 33.33 } })
				return new Promise((r) => setTimeout(r, 50)) // hold the reply until the push has been applied
			}
		}
		const before = fake.components.get('temperature:200').status.tC
		await inst.poll()
		await until(() => pushed)
		await until(() => inst.vars.temp_200_c === '33.3')
		// The fake merges pushes into its own state, so restore the snapshot value to prove the replay, not a re-read
		fake.components.get('temperature:200').status.tC = before
		await new Promise((r) => setTimeout(r, 50))
		assert.equal(inst.vars.temp_200_c, '33.3')
	} finally {
		await stop()
	}
})
