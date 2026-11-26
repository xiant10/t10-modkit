/**
 * Any module's ontology (the workspace's contracts/ontology), from a React app. It has the Go client's operations
 * (t10-modkit/ontology/client) with the same names and meaning, held to the same recorded answers. In a browser every
 * call goes through Workbench's /api/modules/{id} proxy or the app's own /api, so the page holds no t10 token.
 * It names no module: which modules exist comes from configuration.
 */
import { ApiError } from "./api.ts";

export type Kind = "string" | "text" | "integer" | "decimal" | "money_fen" | "boolean" | "date" | "timestamp" | "enum" | "ref";
export type Tier = "never" | "propose" | "undoable";

export interface Property {
	type: Kind;
	name?: string;
	name_zh?: string;
	values?: string[];
	to?: string;
	sensitivity?: "contact" | "identity" | "personal";
	derived?: boolean;
	sources?: boolean;
}

export interface Param extends Omit<Property, "derived" | "sources"> {
	required?: boolean;
	label?: boolean;
}

export interface Link {
	to: string;
	many: boolean;
	name?: string;
	name_zh?: string;
	properties?: Record<string, Property>;
}

export interface ObjectType {
	label: string;
	label_zh: string;
	description?: string;
	title: string;
	implements: string[];
	properties: Record<string, Property>;
	links: Record<string, Link>;
}

export interface ActionType {
	label: string;
	label_zh: string;
	description?: string;
	on?: string;
	params: Record<string, Param>;
	permission: string;
	idempotent: boolean;
	undo: boolean;
	undo_window?: number;
	agent: Tier;
}

export interface TenantLayer {
	revision: number;
	object_types?: Record<string, { values?: Record<string, string[]>; properties?: Record<string, Property>; links?: Record<string, { values?: Record<string, string[]>; properties?: Record<string, Property> }> }>;
	action_types?: Record<string, { values: Record<string, string[]> }>;
}

export interface Descriptor {
	module: string;
	version: number;
	object_types: Record<string, ObjectType>;
	action_types: Record<string, ActionType>;
	restricted: string[];
	interfaces: string[];
	events: Record<string, { on: string }>;
	tenant: TenantLayer;
}

export interface ActionState {
	action: string;
	allowed: boolean;
	reason?: string;
}

export interface ObjectAnswer {
	ref: string;
	type: string;
	title: string;
	revision: number;
	properties: Record<string, unknown>;
	actions: ActionState[];
	link?: Record<string, unknown>;
	sources?: Record<string, string[]>;
}

export interface ResolvedObject {
	ref: string;
	type: string;
	title: string;
	actions: ActionState[];
}

export interface SearchAnswer {
	objects: ObjectAnswer[];
	next_cursor?: string;
}

export interface FieldError {
	param: string;
	code: string;
}

export interface ActionRequest {
	object?: string;
	revision?: number;
	params?: Record<string, unknown>;
}

export interface ApplyAnswer {
	object: ObjectAnswer | null;
	undo?: { id: string; expires_at: string };
}

export interface Proposal {
	id: string;
	action: string;
	object?: string;
	params: Record<string, unknown>;
	agent: string;
	created_at: string;
	expires_at: string;
}

export interface ConfirmRequest {
	params?: Record<string, unknown>;
	revision?: number;
}

/** One configured module: its ID and the base its routes are under, such as /api/modules/property. */
export interface ModuleEndpoint {
	id: string;
	url: string;
}

export interface Loaded {
	descriptors: Record<string, Descriptor>;
	/** The modules that didn't answer. */
	unavailable: string[];
}

export interface Resolved {
	objects: ResolvedObject[];
	/** The modules that are absent, have no ontology or didn't answer. */
	unresolved: string[];
}

/** Workbench's proxy for each module the backend lists. */
export function workbenchModules(ids: string[]): ModuleEndpoint[] {
	return ids.map((id) => ({ id, url: `/api/modules/${encodeURIComponent(id)}` }));
}

export function splitRef(ref: string): { module: string; type: string; id: string } | undefined {
	const first = ref.indexOf(":");
	const second = ref.indexOf(":", first + 1);
	if (first <= 0 || second <= first + 1 || second === ref.length - 1) return undefined;
	return { module: ref.slice(0, first), type: ref.slice(first + 1, second), id: ref.slice(second + 1) };
}

const MAX_LIMIT = 100;

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface ClientOptions {
	modules: ModuleEndpoint[];
	/** The manifest api_versions it supports; 1 by default. */
	versions?: number[];
	/** fetch, by default the browser's, with the cookie. */
	fetch?: Fetch;
}

export class OntologyClient {
	private readonly options: ClientOptions;
	private loaded = new Map<string, ModuleEndpoint>();

	constructor(options: ClientOptions) {
		this.options = options;
	}

	private async call<T>(module: ModuleEndpoint, method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
		const doFetch = this.options.fetch ?? ((input, init) => fetch(input, { credentials: "same-origin", ...init }));
		const init: RequestInit = { method, headers: { ...headers } };
		if (body !== undefined) {
			init.body = JSON.stringify(body);
			(init.headers as Record<string, string>)["content-type"] = "application/json";
		}
		const response = await doFetch(module.url.replace(/\/+$/, "") + path, init);
		const text = await response.text();
		if (response.status >= 300) {
			let error: { error?: string; message?: string; errors?: FieldError[] } = {};
			try {
				error = JSON.parse(text);
			} catch {
				// The code below says it.
			}
			throw Object.assign(new ApiError(response.status, error.error ?? "unavailable", error.message ?? response.statusText), { errors: error.errors });
		}
		return (text === "" ? undefined : JSON.parse(text)) as T;
	}

	private module(id: string): ModuleEndpoint {
		const module = this.loaded.get(id);
		if (module === undefined) throw new ApiError(404, "unknown_module", `no loaded module ${id} has an ontology`);
		return module;
	}

	private byRef(ref: string): { module: ModuleEndpoint; type: string; id: string } {
		const parts = splitRef(ref);
		if (parts === undefined) throw new ApiError(400, "invalid_request", "not a reference");
		return { module: this.module(parts.module), type: parts.type, id: parts.id };
	}

	/** Reads each manifest, and the descriptor of each module that lists ontology with a supported api_version. */
	async load(): Promise<Loaded> {
		const versions = this.options.versions ?? [1];
		const out: Loaded = { descriptors: {}, unavailable: [] };
		const loaded = new Map<string, ModuleEndpoint>();
		for (const module of this.options.modules) {
			let manifest: { api_version?: number; features?: string[] };
			try {
				manifest = await this.call(module, "GET", "/v1/module");
			} catch {
				out.unavailable.push(module.id);
				continue;
			}
			if (!(manifest.features ?? []).includes("ontology") || !versions.includes(manifest.api_version ?? 0)) continue;
			try {
				out.descriptors[module.id] = await this.call<Descriptor>(module, "GET", "/v1/ontology");
				loaded.set(module.id, module);
			} catch {
				out.unavailable.push(module.id);
			}
		}
		this.loaded = loaded;
		return out;
	}

	describe(module: string): Promise<Descriptor> {
		return this.call(this.module(module), "GET", "/v1/ontology");
	}

	search(module: string, type: string, query: Record<string, unknown> = {}): Promise<SearchAnswer> {
		return this.call(this.module(module), "POST", `/v1/objects/${encodeURIComponent(type)}/search`, query);
	}

	get(ref: string, sources?: string): Promise<ObjectAnswer> {
		const { module, type, id } = this.byRef(ref);
		const query = sources ? `?sources=${encodeURIComponent(sources)}` : "";
		return this.call(module, "GET", `/v1/objects/${encodeURIComponent(type)}/${encodeURIComponent(id)}${query}`);
	}

	links(ref: string, link: string, limit?: number, cursor?: string): Promise<SearchAnswer> {
		const { module, type, id } = this.byRef(ref);
		const query = new URLSearchParams();
		if (cursor) query.set("cursor", cursor);
		if (limit) query.set("limit", String(limit));
		query.sort();
		const suffix = query.size > 0 ? `?${query}` : "";
		return this.call(module, "GET", `/v1/objects/${encodeURIComponent(type)}/${encodeURIComponent(id)}/links/${encodeURIComponent(link)}${suffix}`);
	}

	/** Groups references by module, asks each module once, and merges the answers in the order given. */
	async resolve(refs: string[]): Promise<Resolved> {
		const groups = new Map<string, string[]>();
		for (const ref of refs) {
			const parts = splitRef(ref);
			if (parts === undefined) continue;
			groups.set(parts.module, [...(groups.get(parts.module) ?? []), ref]);
		}
		const found = new Map<string, ResolvedObject>();
		const out: Resolved = { objects: [], unresolved: [] };
		for (const [id, group] of groups) {
			const module = this.loaded.get(id);
			if (module === undefined) {
				out.unresolved.push(id);
				continue;
			}
			try {
				for (let start = 0; start < group.length; start += MAX_LIMIT) {
					const answer = await this.call<{ objects: ResolvedObject[] }>(module, "POST", "/v1/objects/resolve", { refs: group.slice(start, start + MAX_LIMIT) });
					for (const object of answer.objects) found.set(object.ref, object);
				}
			} catch {
				out.unresolved.push(id);
			}
		}
		for (const ref of refs) {
			const object = found.get(ref);
			if (object !== undefined) {
				out.objects.push(object);
				found.delete(ref);
			}
		}
		return out;
	}

	validate(module: string, action: string, request: ActionRequest): Promise<{ valid: boolean; errors: FieldError[] }> {
		return this.call(this.module(module), "POST", `/v1/actions/${encodeURIComponent(action)}/validate`, request);
	}

	/** key is the Idempotency-Key an idempotent action needs. */
	apply(module: string, action: string, request: ActionRequest, key?: string): Promise<ApplyAnswer> {
		return this.call(this.module(module), "POST", `/v1/actions/${encodeURIComponent(action)}/apply`, request, key ? { "idempotency-key": key } : {});
	}

	undo(module: string, id: string): Promise<ApplyAnswer> {
		return this.call(this.module(module), "POST", `/v1/undo/${encodeURIComponent(id)}`, {});
	}

	async proposals(module: string): Promise<Proposal[]> {
		return (await this.call<{ proposals: Proposal[] }>(this.module(module), "GET", "/v1/proposals")).proposals;
	}

	confirm(module: string, id: string, body: ConfirmRequest = {}): Promise<ApplyAnswer> {
		return this.call(this.module(module), "POST", `/v1/proposals/${encodeURIComponent(id)}/confirm`, body);
	}

	async dismiss(module: string, id: string): Promise<void> {
		await this.call(this.module(module), "POST", `/v1/proposals/${encodeURIComponent(id)}/dismiss`, {});
	}
}

// What the components draw, as plain functions, so they're tested without a browser.

type Language = "en" | "zh";

export function typeLabel(d: Descriptor, type: string, language: Language): string {
	const t = d.object_types[type];
	if (t === undefined) return type;
	return language === "zh" ? t.label_zh : t.label;
}

export function actionLabel(d: Descriptor, action: string, language: Language): string {
	const a = d.action_types[action];
	if (a === undefined) return action;
	return language === "zh" ? a.label_zh : a.label;
}

/** A type's properties with its tenant layer's, as the Go client's Descriptor.Properties. */
export function propertiesOf(d: Descriptor, type: string): Record<string, Property> {
	const layer = d.tenant.object_types?.[type];
	const out: Record<string, Property> = { ...(d.object_types[type]?.properties ?? {}), ...(layer?.properties ?? {}) };
	for (const [name, values] of Object.entries(layer?.values ?? {})) {
		const p = out[name];
		if (p !== undefined) out[name] = { ...p, values: [...new Set([...(p.values ?? []), ...values])] };
	}
	return out;
}

/** An action's parameters with the values its tenant layer adds. */
export function paramsOf(d: Descriptor, action: string): Record<string, Param> {
	const out: Record<string, Param> = {};
	for (const [name, p] of Object.entries(d.action_types[action]?.params ?? {})) {
		const added = d.tenant.action_types?.[action]?.values[name] ?? [];
		out[name] = added.length > 0 ? { ...p, values: [...new Set([...(p.values ?? []), ...added])] } : p;
	}
	return out;
}

export function propertyLabel(p: Property | Param | undefined, name: string, language: Language): string {
	if (p === undefined) return name;
	return (language === "zh" ? p.name_zh : p.name) ?? p.name ?? name;
}

/** A value as text: fen as yuan, timestamps in the reader's language; a reference is its reference. */
export function formatValue(p: Property | undefined, value: unknown, language: Language): string {
	if (value === null || value === undefined) return "";
	const tag = language === "zh" ? "zh-CN" : "en";
	switch (p?.type) {
		case "money_fen":
			return typeof value === "number" ? new Intl.NumberFormat(tag, { style: "currency", currency: "CNY" }).format(value / 100) : String(value);
		case "timestamp":
			return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? new Intl.DateTimeFormat(tag, { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(value)) : String(value);
		case "boolean":
			return value === true ? "✓" : "—";
		default:
			return typeof value === "object" ? JSON.stringify(value) : String(value);
	}
}

/** Only the actions the module says are allowed now; the module still refuses on apply. */
export function allowedActions(object: { actions: ActionState[] }): string[] {
	return object.actions.filter((a) => a.allowed).map((a) => a.action);
}

/** A form value as the parameter's type, or undefined when the field is empty. */
export function paramValue(p: Param, raw: string): unknown {
	const text = raw.trim();
	if (text === "") return undefined;
	switch (p.type) {
		case "integer":
		case "money_fen":
			return Number.isInteger(Number(text)) ? Number(text) : text;
		case "boolean":
			return text === "true";
		case "timestamp":
			return Number.isNaN(Date.parse(text)) ? text : new Date(text).toISOString().replace(/\.000Z$/, "Z");
		default:
			return text;
	}
}
