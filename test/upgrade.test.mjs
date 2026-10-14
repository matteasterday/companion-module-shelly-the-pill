// Self-check for the 1.0.x -> 2.x upgrade script: node test/upgrade.test.mjs
import assert from 'node:assert'
import { register } from 'node:module'
const stub = JSON.stringify(new URL('./stub.mjs', import.meta.url).href)
register(
	'data:text/javascript,' +
		encodeURIComponent(
			`export async function resolve(s,c,n){return s==='@companion-module/base'?{url:${stub},shortCircuit:true}:n(s,c)}`,
		),
)
await import('../src/main.js')
const [upgrade] = globalThis.__up
const fb = (id, options) => ({ id: 'x', controlId: 'c', feedbackId: id, options })
const r = upgrade(
	{},
	{
		config: { host: '1.2.3.4', tempUnit: 'f' },
		actions: [],
		feedbacks: [
			fb('temperature_above', { id: 200, threshold: 86 }),
			fb('temperature_below', { id: 200, unit: 'c', threshold: 5 }),
			fb('switch_on', { id: 0 }),
		],
	},
)
assert.equal(r.updatedFeedbacks.length, 1)
assert.equal(r.updatedFeedbacks[0].options.unit, 'f')
assert.equal(r.updatedConfig.useWebSocket, true)
assert.equal(r.updatedConfig.tempUnit, undefined)
assert.equal(
	upgrade({}, { config: { host: 'h', useWebSocket: false }, actions: [], feedbacks: [] }).updatedConfig,
	null,
)
console.log('upgrade ok')
