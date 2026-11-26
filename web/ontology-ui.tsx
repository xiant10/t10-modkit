/**
 * Any module's objects, actions and proposals, drawn from its descriptor and the caller's answers (ontology.ts), in the
 * caller's language. They show only the actions whose `allowed` is true, and name no module.
 */
import { type FormEvent, useState } from "react";
import { useI18n } from "./i18n.tsx";
import {
	type ActionState,
	actionLabel,
	allowedActions,
	type Descriptor,
	type FieldError,
	formatValue,
	type ObjectAnswer,
	paramsOf,
	paramValue,
	type Proposal,
	propertiesOf,
	propertyLabel,
	type ResolvedObject,
	splitRef,
	typeLabel,
} from "./ontology.ts";

/** A reference: the object's title when it resolved, else the reference itself as plain text, with no link. */
export function RefChip({ reference, resolved, descriptor, href }: { reference: string; resolved?: ResolvedObject; descriptor?: Descriptor; href?: string }) {
	const { language } = useI18n();
	if (resolved === undefined) return <span className="chip muted ontology-ref">{reference}</span>;
	const type = descriptor ? typeLabel(descriptor, resolved.type, language) : (splitRef(reference)?.type ?? "");
	const label = `${type} · ${resolved.title}`;
	return href ? (
		<a className="chip ontology-ref" href={href} title={reference}>
			{label}
		</a>
	) : (
		<span className="chip ontology-ref" title={reference}>
			{label}
		</span>
	);
}

function ActionButtons({ descriptor, actions, onAction }: { descriptor: Descriptor; actions: ActionState[]; onAction?: (action: string) => void }) {
	const { language } = useI18n();
	const allowed = allowedActions({ actions });
	if (onAction === undefined || allowed.length === 0) return null;
	return (
		<div className="row-actions ontology-actions">
			{allowed.map((action) => (
				<button key={action} type="button" onClick={() => onAction(action)}>
					{actionLabel(descriptor, action, language)}
				</button>
			))}
		</div>
	);
}

/** One object: its type, title, the properties the caller may see, and the actions allowed now. */
export function ObjectCard({ descriptor, object, onAction }: { descriptor: Descriptor; object: ObjectAnswer; onAction?: (action: string) => void }) {
	const { language } = useI18n();
	const props = propertiesOf(descriptor, object.type);
	return (
		<section className="card ontology-card" aria-label={object.title}>
			<p className="ontology-type">{typeLabel(descriptor, object.type, language)}</p>
			<h3>{object.title}</h3>
			<dl className="ontology-properties">
				{Object.entries(object.properties).map(([name, value]) => (
					<div key={name}>
						<dt>{propertyLabel(props[name], name, language)}</dt>
						<dd>{formatValue(props[name], value, language)}</dd>
					</div>
				))}
			</dl>
			<ActionButtons descriptor={descriptor} actions={object.actions} onAction={onAction} />
		</section>
	);
}

/** A page of objects of one type, one column per property, or per `columns`. */
export function ObjectTable({ descriptor, type, objects, columns, onOpen }: { descriptor: Descriptor; type: string; objects: ObjectAnswer[]; columns?: string[]; onOpen?: (object: ObjectAnswer) => void }) {
	const { language } = useI18n();
	const props = propertiesOf(descriptor, type);
	const shown = columns ?? Object.keys(props).filter((name) => objects.some((o) => name in o.properties));
	return (
		<table className="ontology-table">
			<thead>
				<tr>
					<th scope="col">{typeLabel(descriptor, type, language)}</th>
					{shown.map((name) => (
						<th key={name} scope="col">
							{propertyLabel(props[name], name, language)}
						</th>
					))}
				</tr>
			</thead>
			<tbody>
				{objects.map((object) => (
					<tr key={object.ref}>
						<td>
							{onOpen ? (
								<button type="button" className="link-button" onClick={() => onOpen(object)}>
									{object.title}
								</button>
							) : (
								object.title
							)}
						</td>
						{shown.map((name) => (
							<td key={name}>{formatValue(props[name], object.properties[name], language)}</td>
						))}
					</tr>
				))}
			</tbody>
		</table>
	);
}

/**
 * A form for one action's parameters, with the tenant layer's values for its enums. `onSubmit` gets the typed params
 * and answers the field errors to show, empty when it went through.
 */
export function ActionForm({ descriptor, action, initial = {}, onSubmit, onCancel }: { descriptor: Descriptor; action: string; initial?: Record<string, unknown>; onSubmit: (params: Record<string, unknown>) => Promise<FieldError[]>; onCancel?: () => void }) {
	const { language, t } = useI18n();
	const params = paramsOf(descriptor, action);
	const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(initial).map(([k, v]) => [k, v === undefined || v === null ? "" : String(v)])));
	const [errors, setErrors] = useState<FieldError[]>([]);
	const [busy, setBusy] = useState(false);
	const submit = async (event: FormEvent) => {
		event.preventDefault();
		const typed: Record<string, unknown> = {};
		for (const [name, p] of Object.entries(params)) {
			const v = paramValue(p, values[name] ?? "");
			if (v !== undefined) typed[name] = v;
		}
		setBusy(true);
		try {
			setErrors(await onSubmit(typed));
		} finally {
			setBusy(false);
		}
	};
	const whole = errors.filter((e) => e.param === "");
	return (
		<form className="fields ontology-form" onSubmit={submit}>
			<h3>{actionLabel(descriptor, action, language)}</h3>
			{Object.entries(params).map(([name, p]) => {
				const id = `ontology-${action}-${name}`;
				const error = errors.find((e) => e.param === name);
				const set = (v: string) => setValues((old) => ({ ...old, [name]: v }));
				return (
					<label key={name} htmlFor={id}>
						<span>{propertyLabel(p, name, language)}</span>
						{p.type === "enum" && (p.values ?? []).length > 0 ? (
							<select id={id} value={values[name] ?? ""} required={p.required} onChange={(e) => set(e.target.value)}>
								<option value="" />
								{(p.values ?? []).map((v) => (
									<option key={v} value={v}>
										{v}
									</option>
								))}
							</select>
						) : p.type === "text" ? (
							<textarea id={id} value={values[name] ?? ""} required={p.required} onChange={(e) => set(e.target.value)} />
						) : p.type === "boolean" ? (
							<input id={id} type="checkbox" checked={values[name] === "true"} onChange={(e) => set(String(e.target.checked))} />
						) : (
							<input id={id} type={p.type === "integer" || p.type === "money_fen" ? "number" : p.type === "date" ? "date" : "text"} value={values[name] ?? ""} required={p.required} onChange={(e) => set(e.target.value)} />
						)}
						{error && <small className="danger-text">{t(error.code)}</small>}
					</label>
				);
			})}
			{whole.map((e) => (
				<p key={e.code} className="danger-text">
					{t(e.code)}
				</p>
			))}
			<div className="row-actions">
				{onCancel && (
					<button type="button" onClick={onCancel}>
						{t("Cancel")}
					</button>
				)}
				<button type="submit" className="primary" disabled={busy}>
					{actionLabel(descriptor, action, language)}
				</button>
			</div>
		</form>
	);
}

/** An agent's draft, for the person to confirm or dismiss. Nothing changes until they confirm. */
export function ProposalCard({ descriptor, proposal, onConfirm, onDismiss }: { descriptor: Descriptor; proposal: Proposal; onConfirm: () => void; onDismiss: () => void }) {
	const { language, t, ago } = useI18n();
	const params = paramsOf(descriptor, proposal.action);
	return (
		<section className="card ontology-proposal" aria-label={actionLabel(descriptor, proposal.action, language)}>
			<p className="ontology-type">
				{t("For you to confirm")} · {ago(Date.parse(proposal.created_at))}
			</p>
			<h3>{actionLabel(descriptor, proposal.action, language)}</h3>
			<dl className="ontology-properties">
				{Object.entries(proposal.params).map(([name, value]) => (
					<div key={name}>
						<dt>{propertyLabel(params[name], name, language)}</dt>
						<dd>{formatValue(params[name], value, language)}</dd>
					</div>
				))}
			</dl>
			<div className="row-actions">
				<button type="button" onClick={onDismiss}>
					{t("Dismiss")}
				</button>
				<button type="button" className="primary" onClick={onConfirm}>
					{t("Confirm")}
				</button>
			</div>
		</section>
	);
}
