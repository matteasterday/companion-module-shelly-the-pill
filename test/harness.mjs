// Runs the real module against a live device with InstanceBase stubbed out.
// Usage: [PILL_PASSWORD=...] node test/harness.mjs <host> [seconds] [useWebSocket=1]
// Exits 0 only if the connection ends Ok with temperature variables.
import { register } from 'node:module'
import { InstanceBase } from './stub.mjs'
const [host, secs = '25', useWs = '1'] = process.argv.slice(2)
const password = process.env.PILL_PASSWORD ?? ''
const stub = JSON.stringify(new URL('./stub.mjs', import.meta.url).href)
register(
	'data:text/javascript,' +
		encodeURIComponent(
			`export async function resolve(s,c,n){return s==='@companion-module/base'?{url:${stub},shortCircuit:true}:n(s,c)}`,
		),
)
process.env.STUB_LOG = '1'
const { updateStatus, setVariableValues } = InstanceBase.prototype
InstanceBase.prototype.updateStatus = function (s, m) {
	console.log('  STATUS', s, m ?? '')
	updateStatus.call(this, s, m)
}
InstanceBase.prototype.setVariableValues = function (v) {
	for (const [k, x] of Object.entries(v))
		if (this.vars[k] !== x && /^temp|humid|volt|input|switch|script/.test(k)) console.log('  VAR', k, x)
	setVariableValues.call(this, v)
}
await import('../src/main.js')
const inst = globalThis.__inst
await inst.init({ host, password, useWebSocket: useWs === '1', pollInterval: 1000, logLevel: 'verbose' })
globalThis.inst = inst
setTimeout(
	async () => {
		console.log('FINAL', inst.status, 'ws.connected=', inst.ws?.connected, JSON.stringify(inst.vars))
		const ok = inst.status === 'ok' && Object.keys(inst.vars).some((k) => k.startsWith('temp'))
		await inst.destroy()
		process.exit(ok ? 0 : 1)
	},
	Number(secs) * 1000,
)
