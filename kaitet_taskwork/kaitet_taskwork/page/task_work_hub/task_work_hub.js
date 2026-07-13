// Copyright (c) 2026, Upande and contributors
// For license information, please see license.txt

frappe.pages["task-work-hub"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __("Task Work Hub"),
		single_column: true,
	});
	page.set_primary_action(__("New Task Request"), () => frappe.new_doc("Task Work Request"), "add");
	page.set_secondary_action(__("Refresh"), () => wrapper.twhub.load(), "refresh");
	wrapper.twhub = new TaskWorkHub(page);
};

frappe.pages["task-work-hub"].on_page_show = function (wrapper) {
	if (!wrapper.twhub) return;
	const view = frappe.get_route()[1];
	if (view && wrapper.twhub.views.includes(view)) {
		wrapper.twhub.view = view;
	}
	if (wrapper.twhub.loaded_once) {
		wrapper.twhub.load(true);
	}
};

class TaskWorkHub {
	constructor(page) {
		this.page = page;
		this.$main = $(page.main);
		this.views = ["overview", "pipeline", "assignments", "workers", "disbursements"];
		const route_view = frappe.get_route()[1];
		this.view = this.views.includes(route_view) ? route_view : "overview";
		this.inject_css();
		this.load();
	}

	load(quiet) {
		if (!quiet) {
			this.$main.html(`<div class="twhub twhub--loading">${__("Loading task work…")}</div>`);
		}
		return frappe
			.call("kaitet_taskwork.kaitet_taskwork.page.task_work_hub.task_work_hub.get_hub_data")
			.then((r) => {
				this.data = r.message;
				this.loaded_once = true;
				this.render();
			});
	}

	// ------------------------------------------------------------------ utils

	esc(v) {
		return frappe.utils.escape_html(String(v == null ? "" : v));
	}

	kes(v, compact) {
		v = flt(v);
		if (compact && Math.abs(v) >= 1000000) return (v / 1000000).toFixed(2) + "m";
		if (compact && Math.abs(v) >= 1000) return Math.round(v / 1000) + "k";
		return v.toLocaleString("en-KE", { maximumFractionDigits: 0 });
	}

	initials(name) {
		return String(name || "?")
			.split(/\s+/)
			.map((p) => p[0])
			.filter(Boolean)
			.slice(0, 2)
			.join("")
			.toUpperCase();
	}

	route(doctype, name) {
		frappe.set_route("Form", doctype, name);
	}

	// ----------------------------------------------------------------- render

	render() {
		const d = this.data;
		const views = [
			["overview", __("Overview"), ""],
			["pipeline", __("Pipeline"), d.pipeline.requested.length + d.pipeline.planned.length + d.pipeline.running.length],
			["assignments", __("Assignments"), d.assignments.length],
			["workers", __("Workers"), d.workers.total],
			["disbursements", __("Disbursements"), d.disbursements.list.length],
		];
		const nav = views
			.map(
				([key, label, n]) => `
				<a class="twh-navlink ${this.view === key ? "on" : ""}" data-view="${key}">
					${this.icon(key)}${label}${n ? `<span class="n">${n}</span>` : ""}
				</a>`
			)
			.join("");

		this.$main.html(`
			<div class="twhub">
				<aside class="twh-side">
					<div class="twh-label">${__("Views")}</div>
					<nav class="twh-nav">${nav}</nav>
					<div class="twh-label" style="margin-top:18px">${__("Week")} ${d.week.number} · ${frappe.datetime.str_to_user(d.week.start)} – ${frappe.datetime.str_to_user(d.week.end)}</div>
					<div class="twh-stats">
						<div><small>${__("Active workers")}</small><b>${d.kpis.workers_active}</b></div>
						<div><small>${__("On assignment")}</small><b>${d.kpis.workers_assigned}</b></div>
						<div><small>${__("Running assignments")}</small><b>${d.kpis.active_assignments}</b></div>
						<div><small>${__("Awaiting my action")}</small><b>${d.inbox.length}</b></div>
					</div>
					<div class="twh-label" style="margin-top:18px">${__("Legend")}</div>
					<div class="twh-legend">
						<span><i style="background:var(--twh-ok)"></i>${__("On track / paid")}</span>
						<span><i style="background:var(--twh-warn)"></i>${__("Understaffed / due")}</span>
						<span><i style="background:var(--twh-hot)"></i>${__("Overdue / unpaid")}</span>
						<span><i style="background:var(--twh-clay)"></i>${__("Awaiting action")}</span>
					</div>
				</aside>
				<div class="twh-main">${this["render_" + this.view]()}</div>
			</div>
		`);
		this.bind();
	}

	bind() {
		const me = this;
		this.$main.find(".twh-navlink").on("click", function () {
			me.view = $(this).data("view");
			me.render();
		});
		this.$main.find("[data-route-dt]").on("click", function (e) {
			e.stopPropagation();
			me.route($(this).attr("data-route-dt"), $(this).attr("data-route-name"));
		});
		this.$main.find("[data-method]").on("click", function (e) {
			e.stopPropagation();
			const $btn = $(this);
			$btn.prop("disabled", true).text(__("Working…"));
			frappe
				.call(
					"kaitet_taskwork.kaitet_taskwork.page.task_work_hub.task_work_hub." + $btn.attr("data-method"),
					{ [$btn.attr("data-arg")]: $btn.attr("data-name") }
				)
				.then((r) => {
					frappe.show_alert({ message: __("Created {0}", [r.message.name]), indicator: "green" });
					me.route(r.message.doctype, r.message.name);
				})
				.finally(() => $btn.prop("disabled", false));
		});
		this.$main.find("[data-newdoc]").on("click", function () {
			frappe.new_doc($(this).attr("data-newdoc"));
		});
		this.$main.find("[data-listview]").on("click", function () {
			frappe.set_route("List", $(this).attr("data-listview"));
		});
		this.$main.find(".twh-search input").on("input", function () {
			const q = $(this).val().toLowerCase();
			me.$main.find(".twh-wcard").each(function () {
				$(this).toggle($(this).text().toLowerCase().includes(q));
			});
		});
	}

	// --------------------------------------------------------------- overview

	render_overview() {
		const d = this.data;
		const k = d.kpis;
		const kpis = [
			[__("Active Workers"), k.workers_active, `${k.workers_assigned} ${__("on an assignment")}`],
			[__("Committed Cost"), this.kes(k.week_cost, true), `KES · ${__("running assignments")}`],
			[__("Active Assignments"), k.active_assignments, `${k.ending_soon} ${__("ending within 3 days")}`],
			[__("Understaffed Tasks"), k.understaffed_tasks, __("across open plans")],
			[__("Pending Actions"), k.pending_requests + k.pending_plans + k.pending_changes, `${k.pending_requests} ${__("requests")} · ${k.pending_plans} ${__("plans")} · ${k.pending_changes} ${__("changes")}`],
			[__("Unpaid Weeks"), k.unpaid_weeks, k.unpaid_weeks ? `KES ${this.kes(k.unpaid_net)} · ${this.esc(k.unpaid_label)}` : __("all settled")],
		];
		return `
			${this.pagehead(__("Task Work Overview"), `${d.assignments.length} ${__("running assignments")} · ${d.workers.total} ${__("registered workers")}`)}
			<div class="twh-kpis">${kpis
				.map(
					([label, value, unit]) => `
				<div class="twh-kpi"><div class="l">${label}</div><div class="v">${value}</div><div class="u">${unit}</div></div>`
				)
				.join("")}</div>
			<div class="twh-card">
				<div class="twh-cardhead"><h3>${__("Needs Your Action")}</h3><span class="meta">${__("one click moves it to the next stage")}</span></div>
				${this.render_inbox()}
			</div>
			<div class="twh-row2">
				<div class="twh-card">
					<div class="twh-cardhead"><h3>${__("Weekly Labour Cost")}</h3><span class="meta">${__("gross per disbursement week")} · KES</span></div>
					${this.line_chart(d.cost_trend)}
				</div>
				<div class="twh-card">
					<div class="twh-cardhead"><h3>${__("Top Tasks by Cost")}</h3><span class="meta">${__("running assignments")}</span></div>
					${this.render_top_tasks()}
				</div>
			</div>
			<div class="twh-row2eq">
				<div class="twh-card">
					<div class="twh-cardhead"><h3>${__("Payment Mix")}</h3><span class="meta">${__("active workers")}</span></div>
					${this.donut(d.workers.payment_mix, d.workers.active, __("workers"))}
				</div>
				<div class="twh-card">
					<div class="twh-cardhead"><h3>${__("Registry Health")}</h3><span class="meta">${__("payment readiness")}</span></div>
					${this.health_bars(d.workers.health)}
				</div>
			</div>`;
	}

	render_inbox() {
		const rows = this.data.inbox;
		if (!rows.length) {
			return `<div class="twh-empty">${__("Nothing needs your action — the pipeline is clear.")}</div>`;
		}
		const tone = { payment: "hot", request: "warn", plan: "clay", change: "ok", draft: "ink" };
		return `<div class="twh-inbox">${rows
			.map((r) => {
				const btn =
					r.action.type === "method"
						? `<button class="twh-btn" data-method="${r.action.method}" data-arg="${r.action.method === "create_plan" ? "request_name" : "plan_name"}" data-name="${this.esc(r.action.name)}">${this.esc(r.action.label)}</button>`
						: `<button class="twh-btn ghost" data-route-dt="${this.esc(r.action.doctype)}" data-route-name="${this.esc(r.action.name)}">${this.esc(r.action.label)}</button>`;
				return `
				<div class="twh-inboxrow">
					<div class="ic ${tone[r.kind] || ""}">${this.icon(r.kind)}</div>
					<div><div class="t">${this.esc(r.title)}</div><div class="m">${this.esc(r.meta)}</div></div>
					<div class="age">${this.esc(r.age)}</div>
					${btn}
				</div>`;
			})
			.join("")}</div>`;
	}

	render_top_tasks() {
		const rows = this.data.top_tasks;
		if (!rows.length) return `<div class="twh-empty">${__("No running task lines yet.")}</div>`;
		return `<div class="twh-list">${rows
			.map(
				(t, i) => `
			<div class="twh-listrow">
				<div class="rank ${i === 0 ? "lead" : ""}">${i + 1}</div>
				<div><div class="t">${this.esc(t.task_name)}</div><div class="m">${t.workers} ${__("workers")}</div></div>
				<div class="qty">${this.kes(t.cost)}</div>
			</div>`
			)
			.join("")}</div>`;
	}

	// --------------------------------------------------------------- pipeline

	render_pipeline() {
		const p = this.data.pipeline;
		const cols = [
			[__("Requested"), "var(--twh-warn)", p.requested],
			[__("Planned"), "var(--twh-clay)", p.planned],
			[__("Running"), "var(--twh-ok)", p.running],
			[__("Payment"), "var(--twh-teal)", p.payment],
		];
		return `
			${this.pagehead(__("Pipeline"), __("every job from request to payment — click a card to open it"))}
			<div class="twh-board">${cols
				.map(
					([title, color, cards]) => `
				<div class="twh-kcol">
					<div class="head"><i style="background:${color}"></i>${title}<b>${cards.length}</b></div>
					${cards.length ? cards.map((c) => this.kcard(c)).join("") : `<div class="twh-empty small">${__("Empty")}</div>`}
				</div>`
				)
				.join("")}</div>`;
	}

	kcard(c) {
		return `
			<div class="twh-kcard tone-${c.tone}" data-route-dt="${this.esc(c.doctype)}" data-route-name="${this.esc(c.id)}">
				<div class="id">${this.esc(c.id)}</div>
				<div class="t">${this.esc(c.name)}</div>
				<div class="m">${this.esc(c.meta)}</div>
				<div class="foot"><span class="twh-sev ${c.tone}">${this.esc(c.badge)}</span><span class="kes">${this.kes(c.amount)}</span></div>
			</div>`;
	}

	// ------------------------------------------------------------ assignments

	render_assignments() {
		const rows = this.data.assignments;
		const body = rows.length
			? `<div class="twh-tiles">${rows
					.map((a) => {
						const prog = a.days_total ? Math.round((a.day / a.days_total) * 100) : 0;
						const chip =
							a.spend_pct > 100
								? `<span class="twh-sev hot">${a.spend_pct}% ${__("of budget")}</span>`
								: a.ends_soon
								? `<span class="twh-sev warn">${__("ends soon")}</span>`
								: `<span class="twh-sev ok">${this.esc(a.stage.toLowerCase())}</span>`;
						return `
					<div class="twh-tile" data-route-dt="Task Work Assignment" data-route-name="${this.esc(a.name)}">
						<div class="head"><div class="t">${this.esc(a.title || a.name)}</div>${chip}</div>
						<div class="stats">
							<div><small>${__("Crew")}</small><b>${a.crew}</b></div>
							<div><small>${__("Day")}</small><b>${a.days_total ? `${a.day} / ${a.days_total}` : "—"}</b></div>
							<div><small>${__("Spend")}</small><b>${a.spend_pct}%</b></div>
							<div><small>${__("KES est.")}</small><b>${this.kes(a.total_estimated_cost, true)}</b></div>
						</div>
						<div class="bar"><i style="width:${Math.min(prog, 100)}%"></i></div>
					</div>`;
					})
					.join("")}</div>`
			: `<div class="twh-card"><div class="twh-empty">${__("No running assignments. Create one from a submitted plan on the Pipeline view.")}</div></div>`;
		return `${this.pagehead(__("Assignments"), __("running crews — click a tile to open the assignment"))}${body}`;
	}

	// ---------------------------------------------------------------- workers

	render_workers() {
		const w = this.data.workers;
		const cards = w.cards
			.map((c) => {
				const duty = c.current_assignment
					? `<span class="twh-sev ok">${__("assigned")}</span>`
					: c.status === "Active"
					? `<span class="twh-sev ink">${__("available")}</span>`
					: `<span class="twh-sev hot">${this.esc(c.status.toLowerCase())}</span>`;
				return `
				<div class="twh-wcard" data-route-dt="Task Worker" data-route-name="${this.esc(c.name)}">
					<div class="top"><div class="ava">${this.esc(this.initials(c.full_name))}</div>
						<div><div class="t">${this.esc(c.full_name || c.name)}</div><div class="id">${this.esc(c.payroll_number || c.name)}</div></div></div>
					<div class="rows">
						<span>${__("Assignment")}<b>${this.esc(c.current_assignment || "—")}</b></span>
						<span>${__("Phone")}<b>${this.esc(c.phone || c.mpesa_phone || "—")}</b></span>
					</div>
					<div class="foot"><span class="twh-sev clay">${this.esc(c.payment_method || __("no method"))}</span>${duty}</div>
				</div>`;
			})
			.join("");
		return `
			${this.pagehead(__("Task Workers"), `${w.total} ${__("registered")} · ${w.active} ${__("active")} · ${w.assigned} ${__("on assignment")}`)}
			<div class="twh-toolbar">
				<div class="twh-search"><input type="text" placeholder="${__("Search name, payroll no…")}"></div>
				<button class="twh-btn ghost" data-listview="Task Worker">${__("Open full list")}</button>
				<button class="twh-btn" data-newdoc="Task Worker">${__("Register Worker")}</button>
			</div>
			${w.cards.length ? `<div class="twh-wgrid">${cards}</div>` : `<div class="twh-card"><div class="twh-empty">${__("No task workers registered yet.")}</div></div>`}
			<div class="twh-row2eq" style="margin-top:14px">
				<div class="twh-card">
					<div class="twh-cardhead"><h3>${__("Payment Mix")}</h3><span class="meta">${__("active workers")}</span></div>
					${this.donut(w.payment_mix, w.active, __("workers"))}
				</div>
				<div class="twh-card">
					<div class="twh-cardhead"><h3>${__("Registry Health")}</h3><span class="meta">${__("data completeness")}</span></div>
					${this.health_bars(w.health)}
				</div>
			</div>`;
	}

	// ----------------------------------------------------------- disbursements

	render_disbursements() {
		const d = this.data.disbursements;
		const latest = d.latest;
		const by_week = {};
		d.list.forEach((r) => (by_week[r.week_number] = r));

		let strip = "";
		for (let w = 1; w <= 52; w++) {
			const doc = by_week[w];
			let cls = "";
			let title = `${__("Wk")} ${w}`;
			if (doc) {
				title += ` · ${doc.status} · KES ${this.kes(doc.total_net)}`;
				cls = doc.status === "Paid" ? "p" : "u";
			} else if (w === d.current_week) {
				cls = "c";
				title += ` · ${__("collecting")}`;
			}
			strip += `<span class="${cls}" title="${this.esc(title)}" ${doc ? `data-route-dt="TW Weekly Disbursement" data-route-name="${this.esc(doc.name)}"` : ""}></span>`;
		}

		const totals = latest
			? `
			<div class="twh-kpis four">
				<div class="twh-kpi"><div class="l">${__("Workers")}</div><div class="v">${cint(latest.total_workers)}</div><div class="u">${__("week")} ${latest.week_number} · ${this.esc(latest.status)}</div></div>
				<div class="twh-kpi"><div class="l">${__("Gross")}</div><div class="v">${this.kes(latest.total_gross, true)}</div><div class="u">KES ${this.kes(latest.total_gross)}</div></div>
				<div class="twh-kpi"><div class="l">${__("Deductions")}</div><div class="v">${this.kes(latest.total_deductions, true)}</div><div class="u">KES ${this.kes(latest.total_deductions)}</div></div>
				<div class="twh-kpi"><div class="l">${__("Net Payable")}</div><div class="v">${this.kes(latest.total_net, true)}</div><div class="u">KES ${this.kes(latest.total_net)}</div></div>
			</div>`
			: "";

		const table = d.entries.length
			? `
			<div class="twh-card">
				<div class="twh-cardhead"><h3>${__("Worker Payments")} · ${__("Week")} ${latest.week_number}</h3>
					<button class="twh-btn ghost" data-route-dt="TW Weekly Disbursement" data-route-name="${this.esc(latest.name)}">${__("Open")} ${this.esc(latest.name)}</button></div>
				<table class="twh-table">
					<thead><tr><th>${__("Worker")}</th><th>${__("Method")}</th><th class="num">${__("Gross")}</th><th class="num">${__("Deduct")}</th><th class="num">${__("Net · KES")}</th><th>${__("Paid")}</th></tr></thead>
					<tbody>${d.entries
						.slice(0, 15)
						.map(
							(e) => `
						<tr data-route-dt="Task Worker" data-route-name="${this.esc(e.task_worker)}">
							<td><div class="who"><i>${this.esc(this.initials(e.worker_name))}</i><b>${this.esc(e.worker_name || e.task_worker)}</b></div></td>
							<td><span class="twh-sev ${e.payment_method === "M-Pesa" ? "clay" : "ink"}">${this.esc(e.payment_method || "—")}</span></td>
							<td class="num">${this.kes(e.gross_amount)}</td>
							<td class="num">${this.kes(e.deductions)}</td>
							<td class="num"><b>${this.kes(e.net_amount)}</b></td>
							<td>${e.paid ? `<span class="twh-sev ok">${__("paid")}</span>` : `<span class="twh-sev hot">${__("pending")}</span>`}</td>
						</tr>`
						)
						.join("")}</tbody>
				</table>
				${d.entries.length > 15 ? `<div class="twh-empty small">${__("Showing 15 of {0} — open the document for the full list.", [d.entries.length])}</div>` : ""}
			</div>`
			: `<div class="twh-card"><div class="twh-empty">${__("No disbursement for this period yet. Disbursements are drafted per week from submitted assignments.")}</div></div>`;

		return `
			${this.pagehead(__("Weekly Disbursements"), __("one payment per worker per week — click a week cell or row to open it"))}
			${totals}
			<div class="twh-card">
				<div class="twh-cardhead"><h3>${__("Payment Year")} · ${d.year}</h3><span class="meta">${__("one cell per week")}</span></div>
				<div class="twh-wk">${strip}</div>
				<div class="twh-legend row">
					<span><i style="background:var(--twh-ok)"></i>${__("Paid")}</span>
					<span><i style="background:var(--twh-hot)"></i>${__("Unpaid / in progress")}</span>
					<span><i style="background:var(--twh-clay)"></i>${__("Current week")}</span>
					<span><i style="background:rgba(10,10,10,0.06)"></i>${__("No disbursement")}</span>
				</div>
			</div>
			${table}`;
	}

	// ------------------------------------------------------------- components

	pagehead(title, sub) {
		return `
			<div class="twh-pagehead">
				<div class="eyebrow">${__("Kaitet · Task Work · Week")} ${this.data.week.number}</div>
				<h1>${title}</h1>
				<p>${sub}</p>
			</div>`;
	}

	health_bars(health) {
		return Object.entries(health)
			.map(
				([label, val]) => `
			<div class="twh-hb">
				<div class="n">${this.esc(label)}</div>
				<div class="lane"><i class="${val >= 90 ? "ok" : val >= 70 ? "warn" : "hot"}" style="width:${val}%"></i></div>
				<div class="p">${val}%</div>
			</div>`
			)
			.join("");
	}

	donut(mix, total, unit) {
		const palette = ["#c25a2e", "#2a2a26", "#8a8780", "#e07a4f", "#228883"];
		const entries = Object.entries(mix);
		if (!entries.length) return `<div class="twh-empty">${__("No data yet.")}</div>`;
		const sum = entries.reduce((s, [, v]) => s + v, 0) || 1;
		const C = 502.65;
		let offset = 0;
		const arcs = entries
			.map(([, v], i) => {
				const len = (v / sum) * C;
				const seg = `<circle r="80" fill="none" stroke="${palette[i % palette.length]}" stroke-width="46" stroke-dasharray="${len.toFixed(1)} ${C}" stroke-dashoffset="${(-offset).toFixed(1)}" transform="rotate(-90)"/>`;
				offset += len;
				return seg;
			})
			.join("");
		const legend = entries
			.map(
				([k, v], i) =>
					`<span><i style="background:${palette[i % palette.length]}"></i>${this.esc(k)} · ${Math.round((v / sum) * 100)}%</span>`
			)
			.join("");
		return `
			<div class="twh-pie">
				<svg viewBox="0 0 300 300"><g transform="translate(150 150)">${arcs}</g></svg>
				<div class="center"><b>${total}</b><small>${unit}</small></div>
			</div>
			<div class="twh-legend row">${legend}</div>`;
	}

	line_chart(points) {
		if (!points || points.length < 2) {
			return `<div class="twh-empty">${__("Not enough disbursement history for a trend yet.")}</div>`;
		}
		const W = 600, H = 240, PAD = 42;
		const max = Math.max(...points.map((p) => p.gross)) || 1;
		const x = (i) => PAD + (i * (W - PAD - 10)) / (points.length - 1);
		const y = (v) => H - 40 - (v / max) * (H - 90);
		const path = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.gross).toFixed(1)}`).join(" ");
		const labels = points
			.map((p, i) => `<text x="${x(i)}" y="${H - 14}" text-anchor="middle">${this.esc(p.label)}</text>`)
			.join("");
		const dots = points
			.map((p, i) => `<circle cx="${x(i)}" cy="${y(p.gross)}" r="4" fill="#9a3c1e" stroke="#fff" stroke-width="2"><title>KES ${this.kes(p.gross)} · ${p.workers} ${__("workers")}</title></circle>`)
			.join("");
		return `
			<svg class="twh-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
				<defs><linearGradient id="twhFill" x1="0" y1="0" x2="0" y2="1">
					<stop offset="0%" stop-color="#c25a2e" stop-opacity=".2"/><stop offset="100%" stop-color="#c25a2e" stop-opacity="0"/>
				</linearGradient></defs>
				<path d="${path} L${x(points.length - 1)},${H - 40} L${x(0)},${H - 40} Z" fill="url(#twhFill)"/>
				<path d="${path}" fill="none" stroke="#9a3c1e" stroke-width="3" stroke-linecap="round"/>
				${dots}
				<g class="axis">${labels}</g>
			</svg>`;
	}

	icon(kind) {
		const icons = {
			overview: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
			pipeline: '<rect x="2" y="4" width="5.5" height="16" rx="1.5"/><rect x="9.25" y="4" width="5.5" height="10" rx="1.5"/><rect x="16.5" y="4" width="5.5" height="13" rx="1.5"/>',
			assignments: '<path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 13l2 2 4-4"/>',
			workers: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
			disbursements: '<rect x="1" y="4" width="22" height="16" rx="2.5"/><line x1="1" y1="10" x2="23" y2="10"/><path d="M5 15h4"/>',
			payment: '<rect x="1" y="4" width="22" height="16" rx="2.5"/><line x1="1" y1="10" x2="23" y2="10"/>',
			request: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="15" y2="17"/>',
			draft: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
			plan: '<rect x="2" y="4" width="5.5" height="16" rx="1.5"/><rect x="9.25" y="4" width="5.5" height="10" rx="1.5"/><rect x="16.5" y="4" width="5.5" height="13" rx="1.5"/>',
			change: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/>',
		};
		return `<svg viewBox="0 0 24 24">${icons[kind] || icons.overview}</svg>`;
	}

	// -------------------------------------------------------------------- css

	inject_css() {
		if (document.getElementById("twhub-css")) return;
		const css = `
		.twhub{--twh-ink:#0a0a0a;--twh-ink3:#3a3a34;--twh-ink4:#5a5a52;--twh-mute:#8a8780;
			--twh-bg:#f4f3ef;--twh-card:#ffffff;--twh-hair:rgba(10,10,10,0.06);
			--twh-clay:#c25a2e;--twh-clay-deep:#7c2f16;--twh-ok:#3f8f4f;--twh-warn:#d9962e;--twh-hot:#c4302b;--twh-teal:#228883;
			--twh-shadow:0 1px 0 rgba(10,10,10,0.04),0 8px 32px -16px rgba(10,10,10,0.10);
			--twh-grad-ink:linear-gradient(135deg,#0a0a0a,#3a3a34);--twh-grad-clay:linear-gradient(135deg,#9a3c1e,#e07a4f);
			display:grid;grid-template-columns:230px minmax(0,1fr);gap:20px;align-items:start;
			background:var(--twh-bg);border-radius:16px;padding:20px;margin:8px 0 40px;
			font-size:13px;color:var(--twh-ink3);line-height:1.5}
		.twhub--loading{padding:60px;text-align:center;color:var(--twh-mute);display:block}
		.twhub svg{overflow:visible}
		.twh-side{position:sticky;top:70px;background:var(--twh-card);border-radius:18px;box-shadow:var(--twh-shadow);padding:18px 16px}
		.twh-label{font-size:9.5px;text-transform:uppercase;letter-spacing:1.6px;color:var(--twh-mute);font-weight:500;margin-bottom:8px}
		.twh-nav{display:flex;flex-direction:column;gap:2px}
		.twh-navlink{display:flex;align-items:center;gap:9px;padding:8px 11px;border-radius:10px;font-weight:500;color:var(--twh-ink4);cursor:pointer;text-decoration:none;transition:all .15s}
		.twh-navlink svg{width:14px;height:14px;stroke:currentColor;fill:none;stroke-width:2;flex-shrink:0}
		.twh-navlink:hover{background:rgba(10,10,10,0.04);color:var(--twh-ink);text-decoration:none}
		.twh-navlink.on{background:var(--twh-grad-ink);color:#fafaf6;box-shadow:0 4px 14px rgba(10,10,10,0.18)}
		.twh-navlink .n{margin-left:auto;font-size:10px;font-weight:600;background:rgba(10,10,10,0.06);border-radius:99px;padding:1px 7px;color:var(--twh-ink4)}
		.twh-navlink.on .n{background:rgba(255,255,255,0.16);color:#fafaf6}
		.twh-stats div{display:flex;justify-content:space-between;align-items:baseline;padding:6px 2px;border-bottom:1px solid var(--twh-hair)}
		.twh-stats div:last-child{border-bottom:0}
		.twh-stats small{color:var(--twh-ink4)}.twh-stats b{color:var(--twh-ink);font-variant-numeric:tabular-nums}
		.twh-legend{display:flex;flex-direction:column;gap:6px}
		.twh-legend.row{flex-direction:row;flex-wrap:wrap;gap:8px 14px;margin-top:12px}
		.twh-legend span{display:inline-flex;align-items:center;gap:8px;font-size:12px;color:var(--twh-ink3)}
		.twh-legend i{width:10px;height:10px;border-radius:3px;display:inline-block;flex-shrink:0}
		.twh-pagehead{margin-bottom:22px}
		.twh-pagehead .eyebrow{font-size:10px;text-transform:uppercase;letter-spacing:2px;color:var(--twh-mute);font-weight:500;margin-bottom:6px}
		.twh-pagehead h1{font-size:28px;font-weight:600;letter-spacing:-.8px;color:var(--twh-ink);margin:0;line-height:1.1}
		.twh-pagehead p{margin:6px 0 0;color:var(--twh-ink4);font-size:13px}
		.twh-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:16px}
		.twh-kpi{background:var(--twh-card);border-radius:16px;padding:18px 20px;box-shadow:var(--twh-shadow)}
		.twh-kpi .l{font-size:10px;text-transform:uppercase;letter-spacing:1.4px;color:var(--twh-mute);font-weight:500;margin-bottom:8px}
		.twh-kpi .v{font-size:30px;font-weight:600;letter-spacing:-1px;color:var(--twh-ink);line-height:1;font-variant-numeric:tabular-nums}
		.twh-kpi .u{font-size:11.5px;color:var(--twh-mute);margin-top:5px}
		.twh-card{background:var(--twh-card);border-radius:18px;padding:20px 24px;box-shadow:var(--twh-shadow);margin-bottom:14px}
		.twh-cardhead{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:14px}
		.twh-cardhead h3{margin:0;font-size:15px;font-weight:600;color:var(--twh-ink);letter-spacing:-.3px}
		.twh-cardhead .meta{font-size:11.5px;color:var(--twh-mute)}
		.twh-row2{display:grid;grid-template-columns:2fr 1fr;gap:14px}
		.twh-row2eq{display:grid;grid-template-columns:1fr 1fr;gap:14px}
		.twh-empty{padding:22px;text-align:center;color:var(--twh-mute)}
		.twh-empty.small{padding:10px;font-size:11.5px}
		.twh-btn{border:0;background:var(--twh-grad-ink);color:#fafaf6;font-weight:600;font-size:12px;padding:8px 16px;border-radius:999px;cursor:pointer;white-space:nowrap;box-shadow:0 2px 8px rgba(10,10,10,0.16);transition:all .15s}
		.twh-btn:hover{transform:translateY(-1px);color:#fff}
		.twh-btn.ghost{background:rgba(10,10,10,0.05);color:var(--twh-ink3);box-shadow:none}
		.twh-btn.ghost:hover{background:var(--twh-ink);color:#fafaf6}
		.twh-btn:disabled{opacity:.6;cursor:default;transform:none}
		.twh-inboxrow{display:grid;grid-template-columns:38px 1fr auto auto;gap:14px;align-items:center;padding:12px 8px;border-bottom:1px solid var(--twh-hair);border-radius:10px}
		.twh-inboxrow:last-child{border-bottom:0}
		.twh-inboxrow:hover{background:rgba(10,10,10,0.02)}
		.twh-inboxrow .ic{width:36px;height:36px;border-radius:12px;display:grid;place-items:center;background:rgba(10,10,10,0.04);color:var(--twh-ink3)}
		.twh-inboxrow .ic svg{width:15px;height:15px;stroke:currentColor;fill:none;stroke-width:2}
		.twh-inboxrow .ic.hot{background:rgba(196,48,43,0.10);color:var(--twh-hot)}
		.twh-inboxrow .ic.warn{background:rgba(217,150,46,0.14);color:#96650f}
		.twh-inboxrow .ic.clay{background:rgba(194,90,46,0.12);color:var(--twh-clay-deep)}
		.twh-inboxrow .ic.ok{background:rgba(63,143,79,0.12);color:#2e6b3a}
		.twh-inboxrow .t{font-weight:600;color:var(--twh-ink);font-size:13px}
		.twh-inboxrow .m{font-size:11.5px;color:var(--twh-mute);margin-top:1px}
		.twh-inboxrow .age{font-size:11px;color:var(--twh-mute);white-space:nowrap}
		.twh-list{display:flex;flex-direction:column}
		.twh-listrow{display:grid;grid-template-columns:30px 1fr auto;gap:12px;align-items:center;padding:10px 6px;border-bottom:1px solid var(--twh-hair)}
		.twh-listrow:last-child{border-bottom:0}
		.twh-listrow .rank{width:24px;height:24px;border-radius:50%;display:grid;place-items:center;font-size:11.5px;color:var(--twh-mute);background:rgba(10,10,10,0.04)}
		.twh-listrow .rank.lead{background:var(--twh-grad-clay);color:#fff}
		.twh-listrow .t{font-weight:600;color:var(--twh-ink);font-size:13px}
		.twh-listrow .m{font-size:11.5px;color:var(--twh-mute)}
		.twh-listrow .qty{font-weight:600;color:var(--twh-ink);font-variant-numeric:tabular-nums}
		.twh-sev{display:inline-block;padding:2px 9px;font-size:10px;font-weight:500;border-radius:99px;white-space:nowrap}
		.twh-sev.ok{background:rgba(63,143,79,0.13);color:#2e6b3a}
		.twh-sev.warn{background:rgba(217,150,46,0.15);color:#96650f}
		.twh-sev.hot{background:rgba(196,48,43,0.12);color:var(--twh-hot)}
		.twh-sev.clay{background:rgba(194,90,46,0.13);color:var(--twh-clay-deep)}
		.twh-sev.ink{background:rgba(10,10,10,0.07);color:var(--twh-ink3)}
		.twh-board{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;align-items:start}
		.twh-kcol{background:rgba(10,10,10,0.025);border-radius:16px;padding:12px;min-height:140px}
		.twh-kcol .head{display:flex;align-items:center;gap:8px;padding:2px 6px 10px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:1.2px;color:var(--twh-ink4)}
		.twh-kcol .head i{width:8px;height:8px;border-radius:3px}
		.twh-kcol .head b{margin-left:auto;font-size:10px;background:rgba(10,10,10,0.06);border-radius:99px;padding:1px 8px}
		.twh-kcard{background:var(--twh-card);border-radius:14px;padding:13px 15px;box-shadow:var(--twh-shadow);margin-bottom:9px;cursor:pointer;border-left:3px solid transparent;transition:all .15s}
		.twh-kcard:hover{transform:translateY(-2px)}
		.twh-kcard.tone-hot{border-left-color:var(--twh-hot)}
		.twh-kcard.tone-warn{border-left-color:var(--twh-warn)}
		.twh-kcard.tone-ok{border-left-color:var(--twh-ok)}
		.twh-kcard.tone-clay{border-left-color:var(--twh-clay)}
		.twh-kcard .id{font-size:9.5px;font-family:var(--font-stack-mono, monospace);letter-spacing:.4px;color:var(--twh-mute);margin-bottom:3px}
		.twh-kcard .t{font-weight:600;font-size:12.5px;color:var(--twh-ink);line-height:1.3}
		.twh-kcard .m{font-size:11px;color:var(--twh-mute);margin-top:3px}
		.twh-kcard .foot{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:10px}
		.twh-kcard .kes{font-weight:600;font-size:12px;color:var(--twh-ink);font-variant-numeric:tabular-nums}
		.twh-tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:12px}
		.twh-tile{background:var(--twh-card);border-radius:16px;padding:18px 20px;box-shadow:var(--twh-shadow);cursor:pointer;transition:all .15s}
		.twh-tile:hover{transform:translateY(-2px)}
		.twh-tile .head{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:12px}
		.twh-tile .t{font-weight:600;font-size:13px;color:var(--twh-ink)}
		.twh-tile .stats{display:grid;grid-template-columns:1fr 1fr;gap:10px 8px}
		.twh-tile .stats small{font-size:9px;text-transform:uppercase;letter-spacing:.8px;color:var(--twh-mute);display:block}
		.twh-tile .stats b{font-size:15px;color:var(--twh-ink);font-variant-numeric:tabular-nums}
		.twh-tile .bar{height:4px;border-radius:2px;background:rgba(10,10,10,0.06);margin-top:14px;overflow:hidden}
		.twh-tile .bar i{display:block;height:100%;border-radius:2px;background:var(--twh-grad-clay)}
		.twh-toolbar{display:flex;align-items:center;gap:10px;margin-bottom:14px}
		.twh-search{flex:1;max-width:320px;background:var(--twh-card);border-radius:999px;padding:8px 16px;box-shadow:var(--twh-shadow)}
		.twh-search input{border:0;background:transparent;outline:0;width:100%;font-size:13px;color:var(--twh-ink)}
		.twh-wgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}
		.twh-wcard{background:var(--twh-card);border-radius:16px;padding:16px 18px;box-shadow:var(--twh-shadow);cursor:pointer;transition:all .15s}
		.twh-wcard:hover{transform:translateY(-2px)}
		.twh-wcard .top{display:flex;align-items:center;gap:10px;margin-bottom:10px}
		.twh-wcard .ava{width:38px;height:38px;border-radius:50%;background:var(--twh-grad-clay);color:#fff;display:grid;place-items:center;font-weight:600;font-size:12px;flex-shrink:0}
		.twh-wcard .t{font-weight:600;font-size:13px;color:var(--twh-ink);line-height:1.25}
		.twh-wcard .id{font-size:10.5px;color:var(--twh-mute);font-family:var(--font-stack-mono, monospace)}
		.twh-wcard .rows span{display:flex;justify-content:space-between;gap:8px;font-size:11.5px;color:var(--twh-ink4);padding:2px 0}
		.twh-wcard .rows b{color:var(--twh-ink);font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:130px}
		.twh-wcard .foot{display:flex;gap:6px;margin-top:10px}
		.twh-table{width:100%;border-collapse:collapse}
		.twh-table th{font-size:9.5px;text-transform:uppercase;letter-spacing:1.2px;color:var(--twh-mute);font-weight:500;text-align:left;padding:8px 10px;border-bottom:1px solid var(--twh-hair)}
		.twh-table td{font-size:12.5px;color:var(--twh-ink3);padding:9px 10px;border-bottom:1px solid var(--twh-hair)}
		.twh-table tr{cursor:pointer}
		.twh-table tr:hover td{background:rgba(10,10,10,0.02)}
		.twh-table tr:last-child td{border-bottom:0}
		.twh-table .num{text-align:right;font-variant-numeric:tabular-nums}
		.twh-table td b{color:var(--twh-ink);font-weight:600}
		.twh-table .who{display:flex;align-items:center;gap:9px}
		.twh-table .who i{width:26px;height:26px;border-radius:50%;background:var(--twh-grad-clay);color:#fff;font-size:9px;font-weight:600;display:grid;place-items:center;font-style:normal;flex-shrink:0}
		.twh-wk{display:grid;grid-template-columns:repeat(26,1fr);gap:4px}
		.twh-wk span{aspect-ratio:1;border-radius:4px;background:rgba(10,10,10,0.05);cursor:pointer}
		.twh-wk span.p{background:rgba(63,143,79,0.55)}
		.twh-wk span.u{background:var(--twh-hot)}
		.twh-wk span.c{background:rgba(194,90,46,0.85);box-shadow:inset 0 0 0 2px var(--twh-clay-deep)}
		.twh-hb{display:grid;grid-template-columns:130px 1fr 44px;gap:14px;align-items:center;padding:8px 0;border-bottom:1px solid var(--twh-hair)}
		.twh-hb:last-child{border-bottom:0}
		.twh-hb .n{font-weight:600;font-size:12px;color:var(--twh-ink)}
		.twh-hb .lane{position:relative;height:14px;background:rgba(10,10,10,0.05);border-radius:999px;overflow:hidden}
		.twh-hb .lane i{position:absolute;left:0;top:2px;height:10px;border-radius:999px;display:block}
		.twh-hb .lane i.ok{background:linear-gradient(90deg,#2e6b3a,#3f8f4f)}
		.twh-hb .lane i.warn{background:linear-gradient(90deg,#9a5a00,#d9962e)}
		.twh-hb .lane i.hot{background:linear-gradient(90deg,#7a2218,#c4302b)}
		.twh-hb .p{font-weight:600;font-size:12px;text-align:right;color:var(--twh-ink3);font-variant-numeric:tabular-nums}
		.twh-pie{position:relative;display:grid;place-items:center}
		.twh-pie svg{width:100%;max-width:230px;height:auto;display:block}
		.twh-pie .center{position:absolute;text-align:center;pointer-events:none}
		.twh-pie .center b{display:block;font-size:26px;font-weight:600;color:var(--twh-ink);letter-spacing:-.8px}
		.twh-pie .center small{font-size:9px;text-transform:uppercase;letter-spacing:1.4px;color:var(--twh-mute)}
		.twh-chart{width:100%;height:230px;display:block}
		.twh-chart .axis text{font-size:10px;fill:var(--twh-mute)}
		@media (max-width:1200px){.twh-board{grid-template-columns:1fr 1fr}}
		@media (max-width:991px){.twhub{grid-template-columns:1fr}.twh-side{position:static}.twh-row2,.twh-row2eq{grid-template-columns:1fr}.twh-board{grid-template-columns:1fr}}
		`;
		const style = document.createElement("style");
		style.id = "twhub-css";
		style.textContent = css;
		document.head.appendChild(style);
	}
}
