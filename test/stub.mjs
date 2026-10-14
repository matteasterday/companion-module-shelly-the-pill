// Stand-in for @companion-module/base so the real module runs under plain node.
// Tests swap it in with a resolve hook; set STUB_LOG=1 to print module logs.
export const InstanceStatus = {
	Ok: 'ok',
	Connecting: 'connecting',
	Disconnected: 'disconnected',
	ConnectionFailure: 'connection_failure',
	BadConfig: 'bad_config',
	UnknownError: 'unknown_error',
	UnknownWarning: 'unknown_warning',
	AuthenticationFailure: 'authentication_failure',
}
export const Regex = { HOSTNAME: '' }
export const combineRgb = (r, g, b) => ((r & 255) << 16) | ((g & 255) << 8) | (b & 255)

export class InstanceBase {
	label = 'pill'
	vars = {}
	defs = {}
	logs = []
	statuses = []
	status = null
	log(level, msg) {
		this.logs.push([level, msg])
		if (process.env.STUB_LOG) console.log(new Date().toISOString().slice(11, 23), level.toUpperCase(), msg)
	}
	updateStatus(status, msg = null) {
		this.statuses.push([status, msg])
		this.status = status
	}
	setVariableValues(v) {
		Object.assign(this.vars, v)
	}
	setVariableDefinitions(d) {
		this.defs.vars = d
	}
	setActionDefinitions(d) {
		this.defs.actions = d
	}
	setFeedbackDefinitions(d) {
		this.defs.feedbacks = d
	}
	setPresetDefinitions(d) {
		this.defs.presets = d
	}
	checkFeedbacks() {}
}

export function runEntrypoint(C, upgrades) {
	globalThis.__inst = new C()
	globalThis.__up = upgrades
}
