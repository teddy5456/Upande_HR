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
		this.views = ["overview", "pipeline", "assignments", "workers", "disbursements", "planner"];
		const route_view = frappe.get_route()[1];
		this.view = this.views.includes(route_view) ? route_view : "overview";
		this.collapsed = localStorage.getItem("twhub_sidebar") === "collapsed";
		this.inject_css();
		this.setup_realtime();
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
				if (this.view === "planner" && !this.planner) this.fetch_planner();
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

	count(n) {
		return n >= 100 ? n + "+" : n;
	}

	greeting() {
		const h = new Date().getHours();
		const g = h < 12 ? __("Good morning") : h < 17 ? __("Good afternoon") : __("Good evening");
		const name = (frappe.session.user_fullname || "").split(" ")[0];
		return name && name !== "Administrator" ? `${g}, ${name}` : g;
	}

	setup_realtime() {
		// live board: any change to a task work doctype refreshes the hub
		// quietly (debounced, only while the page is actually visible)
		const doctypes = new Set([
			"Task Work Request",
			"Task Work Plan",
			"Task Work Assignment",
			"TW Weekly Disbursement",
			"TW Employee Change Request",
			"Task Worker",
		]);
		frappe.realtime.on("list_update", (data) => {
			if (!data || !doctypes.has(data.doctype)) return;
			if (!$(this.page.wrapper).is(":visible")) return;
			clearTimeout(this._rt_timer);
			this._rt_timer = setTimeout(() => this.load(true), 1500);
		});
	}

	// ----------------------------------------------------------------- render

	render() {
		const d = this.data;
		const views = [
			["overview", __("Overview"), ""],
			["pipeline", __("Pipeline"), d.pipeline.requested.total + d.pipeline.planned.total + d.pipeline.running.total],
			["assignments", __("Assignments"), d.assignments.total],
			["workers", __("Workers"), d.workers.total],
			["disbursements", __("Disbursements"), d.disbursements.list.length],
			["planner", __("Planner"), ""],
		];
		const nav = views
			.map(
				([key, label, n]) => `
				<a class="twh-navlink ${this.view === key ? "on" : ""}" data-view="${key}" title="${label}">
					${this.icon(key)}<span class="lbl">${label}</span>${n ? `<span class="n">${this.count(n)}</span>` : ""}
				</a>`
			)
			.join("");

		const chevron = this.collapsed
			? '<polyline points="9 18 15 12 9 6"/>'
			: '<polyline points="15 18 9 12 15 6"/>';

		this.$main.html(`
			<div class="twhub ${this.collapsed ? "twhub--rail" : ""}">
				<aside class="twh-side">
					<button class="twh-collapse" title="${this.collapsed ? __("Expand sidebar") : __("Collapse sidebar")}">
						<svg viewBox="0 0 24 24">${chevron}</svg>
					</button>
					<div class="twh-label">${__("Views")}</div>
					<nav class="twh-nav">${nav}
						<a class="twh-navlink twh-desklink" title="${__("Back to Desk")}">${this.icon("desk")}<span class="lbl">${__("Desk")}</span></a>
					</nav>
					<div class="twh-collapsible">
						<div class="twh-label" style="margin-top:18px">${__("Week")} ${d.week.number} · ${frappe.datetime.str_to_user(d.week.start)} – ${frappe.datetime.str_to_user(d.week.end)}</div>
						<div class="twh-stats">
							<div><small>${__("Active workers")}</small><b>${d.kpis.workers_active}</b></div>
							<div><small>${__("On assignment")}</small><b>${d.kpis.workers_assigned}</b></div>
							<div><small>${__("Running assignments")}</small><b>${d.kpis.active_assignments}</b></div>
							<div><small>${__("Awaiting my action")}</small><b>${d.inbox.total}</b></div>
						</div>
						<div class="twh-label" style="margin-top:18px">${__("Legend")}</div>
						<div class="twh-legend">
							<span><i style="background:var(--twh-ok)"></i>${__("On track / paid")}</span>
							<span><i style="background:var(--twh-warn)"></i>${__("Understaffed / due")}</span>
							<span><i style="background:var(--twh-hot)"></i>${__("Overdue / unpaid")}</span>
							<span><i style="background:var(--twh-clay)"></i>${__("Awaiting action")}</span>
						</div>
					</div>
				</aside>
				<div class="twh-main">${this["render_" + this.view]()}</div>
			</div>
		`);
		this.bind();
	}

	bind() {
		const me = this;
		this.$main.find(".twh-collapse").on("click", function () {
			me.collapsed = !me.collapsed;
			localStorage.setItem("twhub_sidebar", me.collapsed ? "collapsed" : "open");
			me.render();
		});
		this.$main.find(".twh-navlink[data-view]").on("click", function () {
			me.view = $(this).data("view");
			me.render();
			if (me.view === "planner" && !me.planner) me.fetch_planner();
		});
		this.$main.find(".twh-desklink").on("click", function () {
			window.location.href = "/app/task-work";
		});
		this.$main.find("[data-plweek]").on("click", function () {
			me.fetch_planner($(this).attr("data-plweek") || null);
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
		this.$main.find("[data-more-asg]").on("click", function (e) {
			e.stopPropagation();
			const $btn = $(this).prop("disabled", true).text(__("Loading…"));
			frappe
				.call("kaitet_taskwork.kaitet_taskwork.page.task_work_hub.task_work_hub.get_assignment_rows", {
					start: me.data.assignments.items.length,
					limit: 25,
					search: me.asg_search || null,
				})
				.then((r) => {
					me.data.assignments.items = me.data.assignments.items.concat(r.message.items);
					me.data.assignments.total = r.message.total;
					me.render();
				})
				.finally(() => $btn.prop("disabled", false));
		});
		this.$main.find("[data-viewall]").on("click", function (e) {
			e.stopPropagation();
			try {
				frappe.route_options = JSON.parse($(this).attr("data-viewall-filters") || "{}");
			} catch (err) {
				frappe.route_options = {};
			}
			frappe.set_route("List", $(this).attr("data-viewall"));
		});
		this.$main.find("[data-actuals]").on("click", function (e) {
			e.stopPropagation();
			me.open_actuals($(this).attr("data-actuals"));
		});
		// board drag & drop — advance a card to the next column
		this.$main.find(".twh-kcard[draggable]").on("dragstart", function (e) {
			const from = $(this).attr("data-col");
			me._drag = { card: JSON.parse($(this).attr("data-card")), from: from };
			$(this).addClass("dragging");
			me.$main.find(`.twh-kcol[data-col="${me.next_col(from)}"]`).addClass("droppable");
			e.originalEvent.dataTransfer.effectAllowed = "move";
			e.originalEvent.dataTransfer.setData("text/plain", from);
		});
		this.$main.find(".twh-kcard[draggable]").on("dragend", function () {
			$(this).removeClass("dragging");
			me.$main.find(".twh-kcol").removeClass("droppable over");
		});
		this.$main
			.find(".twh-kcol")
			.on("dragover", function (e) {
				if ($(this).hasClass("droppable")) {
					e.preventDefault();
					$(this).addClass("over");
				}
			})
			.on("dragleave", function () {
				$(this).removeClass("over");
			})
			.on("drop", function (e) {
				if (!$(this).hasClass("droppable") || !me._drag) return;
				e.preventDefault();
				const { card, from } = me._drag;
				me._drag = null;
				me.$main.find(".twh-kcol").removeClass("droppable over");
				me.move_card(card, from);
			});
		this.$main.find(".twh-buchips .twh-chip").on("click", function () {
			me.$main.find(".twh-buchips .twh-chip").removeClass("on");
			$(this).addClass("on");
			const bu = $(this).attr("data-bu");
			me.$main.find(".twh-kcard").each(function () {
				$(this).toggle(!bu || $(this).attr("data-bu") === bu);
			});
		});
		this.$main.find("[data-createwk]").on("click", function (e) {
			e.stopPropagation();
			const wk = cint($(this).attr("data-createwk"));
			frappe.confirm(__("Draft the week {0} disbursement and load worker payments?", [wk]), () => {
				frappe
					.call("kaitet_taskwork.kaitet_taskwork.page.task_work_hub.task_work_hub.create_disbursement", {
						year: me.data.disbursements.year,
						week_number: wk,
					})
					.then((r) => {
						frappe.show_alert({
							message: __("Drafted {0} · {1} workers · KES {2}", [r.message.name, r.message.workers, me.kes(r.message.total_net)]),
							indicator: "green",
						});
						me.load(true);
					});
			});
		});
		this.$main.find("[data-printreg]").on("click", function (e) {
			e.stopPropagation();
			const name = $(this).attr("data-printreg");
			window.open(
				`/printview?doctype=${encodeURIComponent("TW Weekly Disbursement")}&name=${encodeURIComponent(name)}&format=${encodeURIComponent("Weekly Payment Register")}&no_letterhead=1`,
				"_blank"
			);
		});
		this.$main.find("[data-disb-reload]").on("click", function (e) {
			e.stopPropagation();
			frappe
				.call("kaitet_taskwork.kaitet_taskwork.page.task_work_hub.task_work_hub.reload_disbursement_payments", {
					disbursement_name: $(this).attr("data-disb-reload"),
				})
				.then((r) => {
					frappe.show_alert({
						message: __("Reloaded — {0} workers · KES {1}", [r.message.workers, me.kes(r.message.total_net)]),
						indicator: "green",
					});
					me.load(true);
				});
		});
		this.$main.find("[data-disb-action]").on("click", function (e) {
			e.stopPropagation();
			const action = $(this).attr("data-disb-action");
			const name = $(this).attr("data-disb-name");
			const run = () =>
				frappe
					.call("kaitet_taskwork.kaitet_taskwork.page.task_work_hub.task_work_hub.disbursement_action", {
						disbursement_name: name,
						action: action,
					})
					.then((r) => {
						frappe.show_alert({ message: __("{0} → {1}", [name, r.message.status]), indicator: "green" });
						me.load(true);
					});
			if (action === "Mark as Paid" || action === "Reject") {
				frappe.confirm(__("{0} — {1}?", [name, action]), run);
			} else {
				run();
			}
		});
		this.$main.find(".twh-search input").on("input", function () {
			if ($(this).attr("data-filter") === "asg") {
				const q = $(this).val();
				clearTimeout(me._asg_search_timer);
				me._asg_search_timer = setTimeout(() => me.search_assignments(q), 350);
			} else {
				const q = $(this).val().toLowerCase();
				me.$main.find(".twh-wcard").each(function () {
					$(this).toggle($(this).text().toLowerCase().includes(q));
				});
			}
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
			${this.pagehead(this.greeting(), `${d.assignments.total} ${__("running assignments")} · ${d.workers.total} ${__("registered workers")} · ${d.inbox.total} ${__("things waiting for you")}`)}
			<div class="twh-kpis">${kpis
				.map(
					([label, value, unit]) => `
				<div class="twh-kpi"><div class="l">${label}</div><div class="v">${value}</div><div class="u">${unit}</div></div>`
				)
				.join("")}</div>
			<div class="twh-card">
				<div class="twh-cardhead"><h3>${this.icon("zap")}${__("Needs Your Action")}</h3><span class="meta">${__("one click moves it to the next stage")}</span></div>
				${this.render_inbox()}
			</div>
			<div class="twh-row2">
				<div class="twh-card">
					<div class="twh-cardhead"><h3>${this.icon("trend")}${__("Weekly Labour Cost")}</h3><span class="meta">${__("gross per disbursement week")} · KES</span></div>
					${this.line_chart(d.cost_trend)}
				</div>
				<div class="twh-card">
					<div class="twh-cardhead"><h3>${this.icon("task")}${__("Top Tasks by Cost")}</h3><span class="meta">${__("running assignments")}</span></div>
					${this.render_top_tasks()}
				</div>
			</div>
			<div class="twh-row2eq">
				<div class="twh-card">
					<div class="twh-cardhead"><h3>${this.icon("payment")}${__("Payment Mix")}</h3><span class="meta">${__("active workers")}</span></div>
					${this.donut(d.workers.payment_mix, d.workers.active, __("workers"))}
				</div>
				<div class="twh-card">
					<div class="twh-cardhead"><h3>${this.icon("check")}${__("Registry Health")}</h3><span class="meta">${__("payment readiness")}</span></div>
					${this.health_bars(d.workers.health)}
				</div>
			</div>`;
	}

	render_inbox() {
		const inbox = this.data.inbox;
		if (!inbox.total) {
			return `<div class="twh-empty">${__("Nothing needs your action — the pipeline is clear.")}</div>`;
		}
		const tone = { payment: "hot", request: "warn", plan: "clay", change: "ok", draft: "ink" };
		return inbox.groups
			.map((g) => {
				const rows = g.items
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
					.join("");
				const overflow =
					g.total > g.items.length
						? `<button class="twh-btn ghost small" ${this.viewall_attrs(g.list)}>${__("View all {0}", [this.count(g.total)])}</button>`
						: "";
				return `
				<div class="twh-inboxgroup">
					<div class="twh-grouphead">
						<span class="ic ${tone[g.kind] || ""}">${this.icon(g.kind)}</span>
						<b>${this.esc(g.label)}</b><span class="n">${this.count(g.total)}</span>
						${overflow}
					</div>
					<div class="twh-inbox">${rows}</div>
				</div>`;
			})
			.join("");
	}

	viewall_attrs(list) {
		return `data-viewall="${this.esc(list.doctype)}" data-viewall-filters="${this.esc(JSON.stringify(list.filters || {}))}"`;
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
			["requested", __("Requested"), "var(--twh-warn)", p.requested],
			["planned", __("Planned"), "var(--twh-clay)", p.planned],
			["running", __("Running"), "var(--twh-ok)", p.running],
			["payment", __("Payment"), "var(--twh-teal)", p.payment],
		];
		const bus = [...new Set(cols.flatMap(([, , , col]) => col.items.map((c) => c.bu)).filter(Boolean))];
		const chips = bus.length
			? `<div class="twh-buchips"><button class="twh-chip on" data-bu="">${__("All units")}</button>${bus
					.map((b) => `<button class="twh-chip" data-bu="${this.esc(b)}">${this.esc(b)}</button>`)
					.join("")}</div>`
			: "";
		return `
			${this.pagehead(__("Pipeline"), __("drag a card to the next column to advance it — a popup collects what that step needs"))}
			${chips}
			<div class="twh-board">${cols
				.map(([key, title, color, col]) => {
					const more =
						col.total > col.items.length
							? `<div class="twh-kmore" ${this.viewall_attrs(col)}>+ ${col.total - col.items.length} ${__("more — open list")}</div>`
							: "";
					return `
				<div class="twh-kcol" data-col="${key}">
					<div class="head"><i style="background:${color}"></i>${title}<b>${this.count(col.total)}</b></div>
					<div class="cards">${col.items.length ? col.items.map((c) => this.kcard(c, key)).join("") : `<div class="twh-empty small">${__("Empty")}</div>`}</div>
					${more}
					<div class="drophint">${this.icon("plus")} ${__("Drop here")}</div>
				</div>`;
				})
				.join("")}</div>`;
	}

	kcard(c, col) {
		const draggable = ["requested", "planned", "running"].includes(col) && !c.draft;
		return `
			<div class="twh-kcard ${draggable ? "grab" : ""}" ${draggable ? 'draggable="true"' : ""}
				data-col="${col}" data-bu="${this.esc(c.bu || "")}" data-card="${this.esc(JSON.stringify(c))}"
				data-route-dt="${this.esc(c.doctype)}" data-route-name="${this.esc(c.id)}">
				<div class="id"><span class="dot ${c.tone}"></span>${this.esc(c.id)}${draggable ? `<span class="grip" title="${__("Drag to advance")}">⋮⋮</span>` : ""}</div>
				<div class="t">${this.esc(c.name)}</div>
				<div class="m">${this.esc(c.meta)}</div>
				<div class="foot"><span class="twh-sev ${c.tone}">${this.esc(c.badge)}</span><span class="kes">${this.kes(c.amount)}</span></div>
			</div>`;
	}

	// ----------------------------------------------------- board transitions

	next_col(col) {
		return { requested: "planned", planned: "running", running: "payment" }[col];
	}

	move_card(card, from) {
		if (from === "requested") this.dialog_request_to_plan(card);
		else if (from === "planned") this.dialog_plan_to_assignment(card);
		else if (from === "running") this.dialog_complete_assignment(card);
	}

	transition_dialog({ title, summary, fields, action_label, on_submit }) {
		const d = new frappe.ui.Dialog({
			title: title,
			fields: [
				{ fieldtype: "HTML", fieldname: "summary", options: `<div class="twhub twhub--dialog twh-movecard">${summary}</div>` },
				...fields,
			],
			primary_action_label: action_label,
			primary_action: (values) => {
				d.get_primary_btn().prop("disabled", true);
				on_submit(values, d);
			},
		});
		d.show();
		return d;
	}

	dialog_request_to_plan(card) {
		const me = this;
		this.transition_dialog({
			title: __("Plan · {0}", [card.name]),
			summary: `${this.icon("request")} <b>${this.esc(card.name)}</b><div class="sub">${this.esc(card.meta)} · ${__("est.")} KES ${this.kes(card.amount)}</div>
				<div class="hint">${__("Creates a Task Work Plan pre-filled from this request. Workers picked here become the plan's selected suggestions.")}</div>`,
			fields: [
				{ fieldtype: "Date", fieldname: "expected_start_date", label: __("Expected Start Date"), default: frappe.datetime.add_days(frappe.datetime.get_today(), 1) },
				{
					fieldtype: "MultiSelectList",
					fieldname: "workers",
					label: __("Suggest workers"),
					get_data: (txt) => frappe.db.get_link_options("Task Worker", txt, { status: "Active" }),
				},
				{ fieldtype: "Small Text", fieldname: "note", label: __("Note for the planner (optional)") },
			],
			action_label: __("Create Plan"),
			on_submit: (v, d) => {
				frappe
					.call("kaitet_taskwork.kaitet_taskwork.page.task_work_hub.task_work_hub.create_plan", {
						request_name: card.id,
						expected_start_date: v.expected_start_date,
						note: v.note,
						workers: v.workers || [],
					})
					.then((r) => {
						d.hide();
						frappe.show_alert({ message: __("Planned → {0}", [r.message.name]), indicator: "green" });
						me.load(true);
					})
					.finally(() => d.get_primary_btn().prop("disabled", false));
			},
		});
	}

	dialog_plan_to_assignment(card) {
		const me = this;
		this.transition_dialog({
			title: __("Assign · {0}", [card.name]),
			summary: `${this.icon("plan")} <b>${this.esc(card.name)}</b><div class="sub">${this.esc(card.meta)} · ${__("est.")} KES ${this.kes(card.amount)}</div>
				<div class="hint">${__("Creates the assignment and spreads the crew across its task lines - fine-tune quantities on the form if needed.")}</div>`,
			fields: [
				{ fieldtype: "Date", fieldname: "start_date", label: __("Start Date"), default: card.start || frappe.datetime.get_today(), reqd: 1 },
				{ fieldtype: "Date", fieldname: "expected_end_date", label: __("Expected End Date") },
				{
					fieldtype: "MultiSelectList",
					fieldname: "workers",
					label: __("Crew (leave empty to use the plan's selected workers)"),
					get_data: (txt) => frappe.db.get_link_options("Task Worker", txt, { status: "Active" }),
				},
				{ fieldtype: "Small Text", fieldname: "note", label: __("Note for the supervisor (optional)") },
			],
			action_label: __("Create Assignment"),
			on_submit: (v, d) => {
				frappe
					.call("kaitet_taskwork.kaitet_taskwork.page.task_work_hub.task_work_hub.create_assignment", {
						plan_name: card.id,
						start_date: v.start_date,
						expected_end_date: v.expected_end_date,
						note: v.note,
						workers: v.workers || [],
					})
					.then((r) => {
						d.hide();
						frappe.show_alert({ message: __("Assigned → {0}", [r.message.name]), indicator: "green" });
						me.load(true);
					})
					.finally(() => d.get_primary_btn().prop("disabled", false));
			},
		});
	}

	dialog_complete_assignment(card) {
		const me = this;
		const missing = cint(card.crew) - cint(card.actuals_done);
		const warn =
			missing > 0
				? `<div class="hint warn">${this.icon("x")} ${__("{0} of {1} workers have no actuals recorded — enter them first or they will be paid nothing.", [missing, card.crew])}</div>`
				: `<div class="hint ok">${this.icon("check")} ${__("All {0} workers have actuals recorded.", [card.crew])}</div>`;
		this.transition_dialog({
			title: __("Complete · {0}", [card.name]),
			summary: `${this.icon("task")} <b>${this.esc(card.name)}</b><div class="sub">${this.esc(card.meta)} · ${__("spend")} ${card.spend_pct || 0}%</div>${warn}
				<div class="hint">${__("Completing moves it out of Running; its worked days land in the week's disbursement.")}</div>`,
			fields: [
				{ fieldtype: "Date", fieldname: "completion_date", label: __("Completion Date"), default: frappe.datetime.get_today(), reqd: 1 },
				{ fieldtype: "Small Text", fieldname: "note", label: __("Closing note (optional)") },
			],
			action_label: __("Mark Completed"),
			on_submit: (v, d) => {
				frappe
					.call("kaitet_taskwork.kaitet_taskwork.page.task_work_hub.task_work_hub.complete_assignment", {
						assignment_name: card.id,
						completion_date: v.completion_date,
						note: v.note,
					})
					.then((r) => {
						d.hide();
						const m = r.message.workers_without_actuals;
						frappe.show_alert({
							message: m
								? __("{0} completed — {1} workers still have no actuals", [r.message.name, m])
								: __("{0} completed", [r.message.name]),
							indicator: m ? "orange" : "green",
						});
						me.load(true);
					})
					.finally(() => d.get_primary_btn().prop("disabled", false));
			},
		});
	}

	// ------------------------------------------------------------ assignments

	render_assignments() {
		const asg = this.data.assignments;
		const rows = asg.items;
		const attention = [];
		if (asg.over_budget) attention.push(`${asg.over_budget} ${__("over budget")}`);
		if (asg.ending_soon) attention.push(`${asg.ending_soon} ${__("ending soon")}`);
		const sub = `${asg.total} ${__("running, most urgent first")}${attention.length ? " · " + attention.join(" · ") : ""}`;
		const overflow =
			asg.total > rows.length
				? `<div class="twh-empty small">
					<button class="twh-btn ghost small" data-more-asg="1">${__("Show more ({0} of {1})", [rows.length, this.count(asg.total)])}</button>
				</div>`
				: "";
		const trs = rows
			.map((a) => {
				const chip =
					a.spend_pct > 100
						? `<span class="twh-sev hot">${a.spend_pct}% ${__("of budget")}</span>`
						: a.docstatus === 0
						? `<span class="twh-sev ink">${__("draft")}</span>`
						: a.ends_soon
						? `<span class="twh-sev warn">${__("ends soon")}</span>`
						: `<span class="twh-sev ok">${this.esc((a.stage || "").toLowerCase())}</span>`;
				const prog = a.days_total ? Math.round((a.day / a.days_total) * 100) : 0;
				return `
				<tr data-route-dt="Task Work Assignment" data-route-name="${this.esc(a.name)}">
					<td><b>${this.esc(a.title || a.name)}</b><div class="sub">${this.esc(a.name)}${a.business_unit ? " · " + this.esc(a.business_unit) : ""}</div></td>
					<td>${chip}</td>
					<td class="num">${a.crew}</td>
					<td class="num">${a.days_total ? `${a.day} / ${a.days_total}` : "—"}</td>
					<td class="prog"><div class="lane"><i style="width:${Math.min(prog, 100)}%"></i></div></td>
					<td class="num">${a.spend_pct}%</td>
					<td class="num">${this.kes(a.total_estimated_cost, true)}</td>
					<td class="act"><button class="twh-btn small" data-actuals="${this.esc(a.name)}">${this.icon("task")}${__("Enter Actuals")}</button></td>
				</tr>`;
			})
			.join("");
		const table = rows.length
			? `<table class="twh-table twh-asgtable">
					<thead><tr><th>${__("Assignment")}</th><th>${__("Status")}</th><th class="num">${__("Crew")}</th><th class="num">${__("Day")}</th><th></th><th class="num">${__("Spend")}</th><th class="num">${__("Est. KES")}</th><th></th></tr></thead>
					<tbody>${trs}</tbody>
				</table>
				${overflow}`
			: this.asg_search
			? `<div class="twh-empty">${__("Nothing matches “{0}” — clear the search to see all assignments.", [this.esc(this.asg_search)])}</div>`
			: `<div class="twh-empty">${__("No running assignments. Create one from a submitted plan on the Pipeline view.")}</div>`;
		const body = `<div class="twh-card">
				<div class="twh-cardhead">
					<div class="twh-search"><input type="text" data-filter="asg" value="${this.esc(this.asg_search || "")}" placeholder="${__("Search all assignments — title, unit, id, manager…")}"></div>
					<span class="meta">${__("click a row to open · Enter Actuals records work done")}</span>
				</div>
				${table}
			</div>`;
		return `${this.pagehead(__("Assignments"), sub)}${body}`;
	}

	search_assignments(q) {
		this.asg_search = q;
		frappe
			.call("kaitet_taskwork.kaitet_taskwork.page.task_work_hub.task_work_hub.get_assignment_rows", {
				start: 0,
				limit: 25,
				search: q || null,
			})
			.then((r) => {
				this.data.assignments.items = r.message.items;
				this.data.assignments.total = r.message.total;
				this.render();
				const $inp = this.$main.find('.twh-search input[data-filter="asg"]');
				const v = $inp.val();
				$inp.trigger("focus").val("").val(v); // cursor to end
			});
	}

	// ------------------------------------------------------- actuals editor

	open_actuals(name) {
		frappe
			.call("kaitet_taskwork.kaitet_taskwork.page.task_work_hub.task_work_hub.get_assignment_actuals", {
				assignment_name: name,
			})
			.then((r) => this.show_actuals_dialog(r.message));
	}

	show_actuals_dialog(doc) {
		const me = this;
		// group crew rows by task, using assignment task lines for context
		const task_meta = {};
		(doc.tasks || []).forEach((t) => (task_meta[t.task] = t));
		const groups = {};
		doc.rows.forEach((r) => {
			const key = r.task || "__untasked__";
			(groups[key] = groups[key] || []).push(r);
		});

		const row_html = (r) => `
			<tr data-row="${this.esc(r.name)}" data-rate="${r.rate}" data-assigned="${r.quantity_assigned}" data-task="${this.esc(r.task || "")}">
				<td><div class="who"><i>${this.esc(this.initials(r.worker))}</i>
					<span><b>${this.esc(r.worker || "")}</b><div class="sub">#${this.esc(r.payroll_number || "")}${r.payment_method ? " · " + this.esc(r.payment_method) : ""}${r.phone ? " · " + this.esc(r.phone) : ""}</div></span>
					<button class="twh-repl" data-wid="${this.esc(r.worker_id || "")}" data-wname="${this.esc(r.worker || "")}" title="${__("Request replacement")}">${this.icon("swap")}</button></div></td>
				<td class="num">${r.quantity_assigned}${r.uom ? " " + this.esc(r.uom) : ""}<div class="sub">${r.days ? r.days + " " + __("days") : ""}${r.daily_target ? " · " + r.daily_target + "/" + __("day") : ""}</div></td>
				<td class="num">${this.kes(r.rate)}</td>
				<td class="inp">
					<button class="twh-fill" title="${__("Fill with assigned quantity")}">${this.icon("zap")}</button>
					<input type="number" min="0" step="any" class="twh-actual" value="${r.actual_quantity || ""}" placeholder="0">
				</td>
				<td class="num cost">${this.kes(r.actual_cost)}</td>
				<td class="num achv">${this.achv_chip(r.achievement)}</td>
			</tr>`;

		const sections = Object.keys(groups)
			.map((key) => {
				const t = task_meta[key] || {};
				const rows = groups[key];
				const assigned = rows.reduce((s, r) => s + flt(r.quantity_assigned), 0);
				const actual = rows.reduce((s, r) => s + flt(r.actual_quantity), 0);
				const label = key === "__untasked__" ? __("Unassigned task") : t.task_name || key;
				return `
				<tbody class="twh-taskgroup" data-taskgroup="${this.esc(key)}">
					<tr class="grp">
						<td colspan="3"><div class="gttl">${this.icon("task")}<b>${this.esc(label)}</b>
							<span class="meta">${rows.length} ${__("workers")}${t.total_work ? ` · ${__("total work")} ${t.total_work}${t.uom ? " " + this.esc(t.uom) : ""}` : ""}${t.status ? ` · ${this.esc(t.status.toLowerCase())}` : ""}</span></div></td>
						<td colspan="3" class="num gsum">
							<span class="tassigned">${assigned}</span> ${__("assigned")} ·
							<b class="tactual">${actual}</b> ${__("done")}
							${t.total_work ? ` · <span class="tcap">${__("cap")} ${t.total_work}</span>` : ""}
						</td>
					</tr>
					${rows.map(row_html).join("")}
				</tbody>`;
			})
			.join("");

		const period =
			doc.start_date || doc.expected_end_date
				? `${this.icon("calendar")} ${doc.start_date ? frappe.datetime.str_to_user(doc.start_date) : "…"} → ${doc.expected_end_date ? frappe.datetime.str_to_user(doc.expected_end_date) : "…"}`
				: "";

		const d = new frappe.ui.Dialog({
			title: __("Enter Actuals · {0}", [doc.title]),
			size: "extra-large",
			fields: [{ fieldtype: "HTML", fieldname: "body" }],
			primary_action_label: __("Save Actuals"),
			primary_action: () => {
				const actuals = {};
				d.$wrapper.find("tr[data-row]").each(function () {
					const v = $(this).find("input.twh-actual").val();
					if (v !== "") actuals[$(this).attr("data-row")] = flt(v);
				});
				d.get_primary_btn().prop("disabled", true);
				frappe
					.call("kaitet_taskwork.kaitet_taskwork.page.task_work_hub.task_work_hub.save_actuals", {
						assignment_name: doc.name,
						actuals: actuals,
					})
					.then((r) => {
						frappe.show_alert({
							message: __("Saved actuals for {0} workers", [r.message.saved]),
							indicator: "green",
						});
						d.hide();
						me.load(true);
					})
					.finally(() => d.get_primary_btn().prop("disabled", false));
			},
		});

		d.get_field("body").$wrapper.html(`
			<div class="twhub twhub--dialog">
				<div class="twh-dlghead">
					<span class="twh-sev ${doc.docstatus === 0 ? "ink" : "ok"}">${doc.docstatus === 0 ? __("draft") : this.esc((doc.stage || "").toLowerCase())}</span>
					<span class="meta">${period}</span>
					<span class="meta">${this.icon("workers")} ${doc.rows.length} ${__("crew")}</span>
					<span class="meta">${this.icon("chart")} ${__("est.")} KES ${this.kes(doc.total_estimated_cost)}</span>
					${doc.rows.length > 8 ? `<div class="twh-search"><input type="text" data-filter="actuals" placeholder="${__("Find worker…")}"></div>` : ""}
					<button class="twh-btn ghost small twh-fillall">${this.icon("zap")}${__("Fill all = assigned")}</button>
					<button class="twh-btn ghost small twh-addwk">${this.icon("change")}${__("Add Worker")}</button>
				</div>
				<div class="twh-dlgscroll">
				<table class="twh-table twh-acttable">
					<thead><tr><th>${__("Worker")}</th><th class="num">${__("Assigned")}</th><th class="num">${__("Rate")}</th><th class="num">${__("Actual Qty")}</th><th class="num">${__("Cost")}</th><th class="num">${__("Achieved")}</th></tr></thead>
					${sections}
				</table>
				</div>
				<div class="twh-dlgfoot">
					<span>${this.icon("target")} <b class="ft-actual">${doc.totals.actual}</b> / ${doc.totals.assigned} ${__("done")}</span>
					<span>${this.icon("payment")} ${__("actual cost")} <b class="ft-cost">KES ${this.kes(doc.totals.actual_cost)}</b></span>
					<span>${this.icon("trend")} ${__("overall")} <b class="ft-achv">${doc.totals.assigned ? Math.round((doc.totals.actual / doc.totals.assigned) * 100) : 0}%</b></span>
					<span class="meta">${doc.docstatus === 0 ? __("Draft — stays editable until submitted") : __("Submitted — actuals update directly")}</span>
				</div>
			</div>`);

		const recalc_row = ($tr) => {
			const qty = flt($tr.find("input.twh-actual").val());
			const rate = flt($tr.attr("data-rate"));
			const assigned = flt($tr.attr("data-assigned"));
			$tr.find(".cost").text(me.kes(qty * rate));
			$tr.find(".achv").html(me.achv_chip(assigned ? (qty / assigned) * 100 : 0));
		};
		const recalc_totals = () => {
			let actual = 0, assigned = 0, cost = 0;
			d.$wrapper.find("tr[data-row]").each(function () {
				const qty = flt($(this).find("input.twh-actual").val());
				actual += qty;
				assigned += flt($(this).attr("data-assigned"));
				cost += qty * flt($(this).attr("data-rate"));
			});
			d.$wrapper.find(".ft-actual").text(actual);
			d.$wrapper.find(".ft-cost").text("KES " + me.kes(cost));
			d.$wrapper.find(".ft-achv").text((assigned ? Math.round((actual / assigned) * 100) : 0) + "%");
			d.$wrapper.find(".twh-taskgroup").each(function () {
				let t = 0;
				$(this).find("tr[data-row]").each(function () {
					t += flt($(this).find("input.twh-actual").val());
				});
				$(this).find(".tactual").text(t);
			});
		};

		d.$wrapper.find("input.twh-actual").on("input", function () {
			recalc_row($(this).closest("tr"));
			recalc_totals();
		});
		d.$wrapper.find(".twh-fill").on("click", function () {
			const $tr = $(this).closest("tr");
			$tr.find("input.twh-actual").val(flt($tr.attr("data-assigned")));
			recalc_row($tr);
			recalc_totals();
		});
		d.$wrapper.find(".twh-fillall").on("click", function () {
			d.$wrapper.find("tr[data-row]").each(function () {
				$(this).find("input.twh-actual").val(flt($(this).attr("data-assigned")));
				recalc_row($(this));
			});
			recalc_totals();
		});
		d.$wrapper.find('input[data-filter="actuals"]').on("input", function () {
			const q = $(this).val().toLowerCase();
			d.$wrapper.find("tr[data-row]").each(function () {
				$(this).toggle($(this).text().toLowerCase().includes(q));
			});
		});
		d.$wrapper.find(".twh-addwk").on("click", () => me.change_request_dialog(doc.name, "Add Employee"));
		d.$wrapper.find(".twh-repl").on("click", function (e) {
			e.stopPropagation();
			me.change_request_dialog(doc.name, "Replace Employee", $(this).attr("data-wid"), $(this).attr("data-wname"));
		});

		d.show();
	}

	change_request_dialog(assignment, change_type, old_id, old_name) {
		const me = this;
		const replacing = change_type === "Replace Employee";
		this.transition_dialog({
			title: replacing ? __("Replace Worker · {0}", [assignment]) : __("Add Worker · {0}", [assignment]),
			summary: `${this.icon(replacing ? "swap" : "change")} <b>${this.esc(assignment)}</b>
				${replacing ? `<div class="sub">${__("Replacing")} <b>${this.esc(old_name || old_id)}</b></div>` : ""}
				<div class="hint">${__("Raises an Employee Change Request — HR approves it before the crew changes.")}</div>`,
			fields: [
				{
					fieldtype: "Link",
					fieldname: "new_employee",
					label: replacing ? __("Replacement worker") : __("Worker to add"),
					options: "Task Worker",
					reqd: 1,
					get_query: () => ({ filters: { status: "Active" } }),
				},
				{ fieldtype: "Small Text", fieldname: "reason", label: __("Reason"), reqd: 1 },
			],
			action_label: replacing ? __("Request Replacement") : __("Request Addition"),
			on_submit: (v, d) => {
				frappe
					.call("kaitet_taskwork.kaitet_taskwork.page.task_work_hub.task_work_hub.create_change_request", {
						assignment_name: assignment,
						change_type: change_type,
						new_employee: v.new_employee,
						old_employee: old_id || null,
						reason: v.reason,
					})
					.then((r) => {
						d.hide();
						frappe.show_alert({ message: __("{0} raised — pending HR approval", [r.message.name]), indicator: "green" });
					})
					.finally(() => d.get_primary_btn().prop("disabled", false));
			},
		});
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
				<button class="twh-btn" data-newdoc="Task Worker">${this.icon("change")}${__("Register Worker")}</button>
			</div>
			${w.cards.length ? `<div class="twh-wgrid">${cards}</div>` : `<div class="twh-card"><div class="twh-empty">${__("No task workers registered yet.")}</div></div>`}
			<div class="twh-row2eq" style="margin-top:14px">
				<div class="twh-card">
					<div class="twh-cardhead"><h3>${this.icon("payment")}${__("Payment Mix")}</h3><span class="meta">${__("active workers")}</span></div>
					${this.donut(w.payment_mix, w.active, __("workers"))}
				</div>
				<div class="twh-card">
					<div class="twh-cardhead"><h3>${this.icon("check")}${__("Registry Health")}</h3><span class="meta">${__("data completeness")}</span></div>
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
			let attrs = "";
			if (doc) {
				title += ` · ${doc.status} · KES ${this.kes(doc.total_net)}`;
				cls = doc.status === "Paid" ? "p" : "u";
				attrs = `data-route-dt="TW Weekly Disbursement" data-route-name="${this.esc(doc.name)}"`;
			} else if (w <= d.current_week) {
				cls = w === d.current_week ? "c" : "mk";
				title += ` · ${__("click to draft disbursement")}`;
				attrs = `data-createwk="${w}"`;
			}
			strip += `<span class="${cls}" title="${this.esc(title)}" ${attrs}></span>`;
		}

		// workflow action bar for the loaded disbursement
		const action_icons = { "Submit for Approval": "send", Approve: "check", Reject: "x", "Mark as Paid": "paid" };
		let bar = "";
		if (latest) {
			const btns = [];
			if (latest.docstatus === 0) {
				btns.push(`<button class="twh-btn ghost" data-disb-reload="${this.esc(latest.name)}">${this.icon("refresh")}${__("Reload Payments")}</button>`);
			}
			(d.latest_actions || []).forEach((a) => {
				btns.push(
					`<button class="twh-btn ${a === "Reject" ? "ghost" : ""}" data-disb-action="${this.esc(a)}" data-disb-name="${this.esc(latest.name)}">${this.icon(action_icons[a] || "check")}${__(a)}</button>`
				);
			});
			btns.push(`<button class="twh-btn ghost" data-printreg="${this.esc(latest.name)}">${this.icon("task")}${__("Print Register")}</button>`);
			btns.push(`<button class="twh-btn ghost" data-route-dt="TW Weekly Disbursement" data-route-name="${this.esc(latest.name)}">${__("Open Form")}</button>`);
			const status_tone = latest.status === "Paid" ? "ok" : latest.status === "Draft" ? "ink" : latest.status === "Rejected" ? "hot" : "clay";
			bar = `
			<div class="twh-card twh-actionbar">
				<div class="ttl">${this.icon("payment")}<b>${this.esc(latest.name)}</b><span class="twh-sev ${status_tone}">${this.esc(latest.status.toLowerCase())}</span>
					<span class="meta">${__("week")} ${latest.week_number} · ${cint(latest.total_workers)} ${__("workers")} · ${__("net")} KES ${this.kes(latest.total_net)}</span></div>
				<div class="btns">${btns.join("")}</div>
			</div>`;
		} else if (!by_week[d.current_week]) {
			bar = `
			<div class="twh-card twh-actionbar">
				<div class="ttl">${this.icon("payment")}<b>${__("Week")} ${d.current_week}</b><span class="meta">${__("no disbursement drafted yet")}</span></div>
				<div class="btns"><button class="twh-btn" data-createwk="${d.current_week}">${this.icon("plus")}${__("Draft Week {0} Disbursement", [d.current_week])}</button></div>
			</div>`;
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
				<div class="twh-cardhead"><h3>${this.icon("workers")}${__("Worker Payments")} · ${__("Week")} ${latest.week_number}</h3>
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
			${this.pagehead(__("Weekly Disbursements"), __("one payment per worker per week — draft, approve and pay without leaving the hub"))}
			${bar}
			${totals}
			<div class="twh-card">
				<div class="twh-cardhead"><h3>${this.icon("calendar")}${__("Payment Year")} · ${d.year}</h3><span class="meta">${__("one cell per week")}</span></div>
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

	// ----------------------------------------------------------------- planner

	fetch_planner(week_start) {
		frappe
			.call("kaitet_taskwork.kaitet_taskwork.page.task_work_hub.task_work_hub.get_planner_data", {
				week_start: week_start || null,
			})
			.then((r) => {
				this.planner = r.message;
				this.planner_week = r.message.week_start;
				if (this.view === "planner") this.render();
			});
	}

	render_planner() {
		const p = this.planner;
		if (!p) {
			return `${this.pagehead(__("Week Planner"), __("who is deployed where, day by day"))}
				<div class="twh-card"><div class="twh-empty">${__("Loading the week…")}</div></div>`;
		}
		const peak = Math.max(...p.deployed_by_day, 0);
		const util = p.capacity ? Math.round((peak / p.capacity) * 100) : 0;
		const daynames = p.days.map((dt) => {
			const m = frappe.datetime.str_to_obj(dt);
			return { d: dt, label: m.toLocaleDateString("en-GB", { weekday: "short" }), num: m.getDate(), today: dt === p.today };
		});

		const nav = `
			<div class="pillgroup">
				<button data-plweek="${frappe.datetime.add_days(p.week_start, -7)}">‹ ${__("Prev")}</button>
				<button class="on">${frappe.datetime.str_to_user(p.week_start)} – ${frappe.datetime.str_to_user(p.week_end)}</button>
				<button data-plweek="${frappe.datetime.add_days(p.week_start, 7)}">${__("Next")} ›</button>
				<button data-plweek="">${__("This week")}</button>
			</div>`;

		const grid = p.lanes.length
			? `<table class="twh-table twh-plgrid">
				<thead><tr><th>${__("Assignment")}</th>${daynames.map((x) => `<th class="num ${x.today ? "today" : ""}">${x.label}<div class="sub">${x.num}</div></th>`).join("")}</tr></thead>
				<tbody>${p.lanes
					.map(
						(l) => `
					<tr data-route-dt="Task Work Assignment" data-route-name="${this.esc(l.name)}">
						<td><b>${this.esc(l.title)}</b><div class="sub">${this.esc(l.name)} · ${l.crew} ${__("crew")}${l.bu ? " · " + this.esc(l.bu) : ""}</div></td>
						${l.cells.map((c, i) => `<td class="plc ${c != null ? "on" : ""} ${daynames[i].today ? "today" : ""}">${c != null ? c : ""}</td>`).join("")}
					</tr>`
					)
					.join("")}</tbody>
				<tfoot><tr><td>${__("Workers deployed")}</td>${p.deployed_by_day.map((n, i) => `<td class="plc ${daynames[i].today ? "today" : ""}"><b>${n}</b></td>`).join("")}</tr></tfoot>
			</table>
			${p.lanes_total > p.lanes.length ? `<div class="twh-empty small">${__("Showing {0} of {1} assignments", [p.lanes.length, p.lanes_total])}</div>` : ""}`
			: `<div class="twh-empty">${__("No assignments touch this week.")}</div>`;

		const dbl = p.double_booked.length
			? p.double_booked
					.map(
						(w) => `
				<div class="twh-listrow" data-route-dt="Task Worker" data-route-name="${this.esc(w.worker)}">
					<div class="rank lead">${this.esc(this.initials(w.name))}</div>
					<div><div class="t">${this.esc(w.name)}</div>
						<div class="m">${w.assignments.map((a) => `${this.esc(a.assignment)} (${frappe.datetime.str_to_user(a.start)}–${frappe.datetime.str_to_user(a.end)})`).join(" · ")}</div></div>
					<div class="qty"><span class="twh-sev hot">${w.assignments.length} ${__("jobs")}</span></div>
				</div>`
					)
					.join("")
			: `<div class="twh-empty">${this.icon("check")} ${__("Nobody is double-booked this week.")}</div>`;

		const idle = p.idle.length
			? `<div class="twh-idlechips">${p.idle
					.map((w) => `<button class="twh-chip" data-route-dt="Task Worker" data-route-name="${this.esc(w.name)}">${this.esc(w.full_name || w.name)}</button>`)
					.join("")}</div>${p.idle_total > p.idle.length ? `<div class="twh-empty small">+ ${p.idle_total - p.idle.length} ${__("more")}</div>` : ""}`
			: `<div class="twh-empty">${__("Everyone active is deployed.")}</div>`;

		return `
			<div class="twh-pagehead">
				<div class="eyebrow">${__("Kaitet · Task Work · Capacity")}</div>
				<h1>${__("Week Planner")}</h1>
				<p>${__("who is deployed where, day by day — spot gaps, clashes and idle hands before Monday")}</p>
			</div>
			<div class="twh-buchips" style="justify-content:flex-start">${nav}</div>
			<div class="twh-kpis" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr))">
				<div class="twh-kpi"><div class="l">${__("Capacity")}</div><div class="v">${p.capacity}</div><div class="u">${__("active registered workers")}</div></div>
				<div class="twh-kpi"><div class="l">${__("Peak Deployed")}</div><div class="v">${peak}</div><div class="u">${__("workers on the busiest day")}</div></div>
				<div class="twh-kpi"><div class="l">${__("Utilization")}</div><div class="v">${util}<small>%</small></div><div class="u">${__("peak vs capacity")}</div></div>
				<div class="twh-kpi"><div class="l">${__("Double-booked")}</div><div class="v">${p.double_booked_total}</div><div class="u">${__("workers on clashing jobs")}</div></div>
				<div class="twh-kpi"><div class="l">${__("Idle")}</div><div class="v">${p.idle_total}</div><div class="u">${__("active but not deployed")}</div></div>
			</div>
			<div class="twh-card">
				<div class="twh-cardhead"><h3>${this.icon("planner")}${__("Deployment Grid")}</h3><span class="meta">${__("cell = crew size scheduled that day · click a row to open")}</span></div>
				${grid}
			</div>
			<div class="twh-row2eq">
				<div class="twh-card">
					<div class="twh-cardhead"><h3>${this.icon("x")}${__("Double-booked Workers")}</h3><span class="meta">${__("same worker, overlapping assignments")}</span></div>
					<div class="twh-list">${dbl}</div>
				</div>
				<div class="twh-card">
					<div class="twh-cardhead"><h3>${this.icon("workers")}${__("Idle This Week")}</h3><span class="meta">${__("available to plug gaps — click to open")}</span></div>
					${idle}
				</div>
			</div>`;
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
			refresh: '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
			check: '<polyline points="20 6 9 17 4 12"/>',
			send: '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>',
			x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
			paid: '<rect x="1" y="4" width="22" height="16" rx="2.5"/><line x1="1" y1="10" x2="23" y2="10"/><polyline points="7 15 9 17 13 13"/>',
			task: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
			target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
			chart: '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
			calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
			planner: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><rect x="7" y="14" width="4" height="4" rx="1"/>',
			desk: '<rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>',
			swap: '<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
			search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
			zap: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
			plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
			trend: '<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>',
			phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>',
		};
		return `<svg viewBox="0 0 24 24">${icons[kind] || icons.overview}</svg>`;
	}

	achv_chip(pct) {
		if (!pct) return `<span class="twh-sev ink">—</span>`;
		const cls = pct >= 90 ? "ok" : pct >= 50 ? "warn" : "hot";
		return `<span class="twh-sev ${cls}">${Math.round(pct)}%</span>`;
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
		.twh-collapse{position:absolute;top:14px;right:12px;width:26px;height:26px;border:0;border-radius:50%;background:rgba(10,10,10,0.05);color:var(--twh-ink4);display:grid;place-items:center;cursor:pointer;transition:all .15s;z-index:1}
		.twh-collapse:hover{background:var(--twh-ink);color:#fafaf6}
		.twh-collapse svg{width:13px;height:13px;stroke:currentColor;fill:none;stroke-width:2.4}
		.twhub--rail{grid-template-columns:64px minmax(0,1fr)}
		.twhub--rail .twh-side{padding:44px 10px 14px}
		.twhub--rail .twh-collapse{right:50%;transform:translateX(50%)}
		.twhub--rail .twh-label,.twhub--rail .twh-collapsible,.twhub--rail .twh-navlink .lbl,.twhub--rail .twh-navlink .n{display:none}
		.twhub--rail .twh-navlink{justify-content:center;padding:10px}
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
		.twh-empty svg{width:14px;height:14px;stroke:var(--twh-ok);fill:none;stroke-width:2;vertical-align:-2px;margin-right:6px}
		.twh-empty.small{padding:10px;font-size:11.5px}
		.twh-btn{border:0;background:var(--twh-grad-ink);color:#fafaf6;font-weight:600;font-size:12px;padding:8px 16px;border-radius:999px;cursor:pointer;white-space:nowrap;box-shadow:0 2px 8px rgba(10,10,10,0.16);transition:all .15s}
		.twh-btn:hover{transform:translateY(-1px);color:#fff}
		.twh-btn.ghost{background:rgba(10,10,10,0.05);color:var(--twh-ink3);box-shadow:none}
		.twh-btn.ghost:hover{background:var(--twh-ink);color:#fafaf6}
		.twh-btn:disabled{opacity:.6;cursor:default;transform:none}
		.twh-btn svg{width:13px;height:13px;stroke:currentColor;fill:none;stroke-width:2.2;margin-right:6px;vertical-align:-2px}
		.twh-cardhead h3 svg{width:15px;height:15px;stroke:var(--twh-clay);fill:none;stroke-width:2;margin-right:8px;vertical-align:-2px}
		.twh-actionbar{display:flex;align-items:center;gap:16px;flex-wrap:wrap;padding:16px 22px}
		.twh-actionbar .ttl{display:flex;align-items:center;gap:10px;min-width:0}
		.twh-actionbar .ttl svg{width:17px;height:17px;stroke:var(--twh-clay);fill:none;stroke-width:2;flex-shrink:0}
		.twh-actionbar .ttl b{color:var(--twh-ink);white-space:nowrap}
		.twh-actionbar .ttl .meta{color:var(--twh-mute);font-size:12px}
		.twh-actionbar .btns{margin-left:auto;display:flex;gap:8px;flex-wrap:wrap}
		.twh-wk span.mk:hover{background:rgba(194,90,46,0.35);box-shadow:inset 0 0 0 1.5px var(--twh-clay)}
		.twh-dlghead{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:12px}
		.twh-dlghead .meta{color:var(--twh-mute);font-size:12px;display:inline-flex;align-items:center;gap:6px}
		.twh-dlghead .meta svg,.twh-dlgfoot svg{width:13px;height:13px;stroke:var(--twh-ink4);fill:none;stroke-width:2;vertical-align:-2px}
		.twh-dlghead .twh-search{padding:6px 14px;max-width:220px;margin-left:auto}
		.twh-dlgscroll{max-height:52vh;overflow-y:auto;border:1px solid var(--twh-hair);border-radius:12px;padding:0 12px}
		.twh-dlgfoot{display:flex;align-items:center;gap:22px;flex-wrap:wrap;padding:14px 4px 2px;font-size:12.5px;color:var(--twh-ink4)}
		.twh-dlgfoot b{color:var(--twh-ink);font-variant-numeric:tabular-nums}
		.twh-acttable tr.grp td{background:rgba(10,10,10,0.03);border-bottom:1px solid var(--twh-hair);padding:8px 10px}
		.twh-acttable .gttl{display:flex;align-items:center;gap:8px;font-size:12px}
		.twh-acttable .gttl svg{width:13px;height:13px;stroke:var(--twh-clay);fill:none;stroke-width:2;flex-shrink:0}
		.twh-acttable .gttl b{color:var(--twh-ink)}
		.twh-acttable .gttl .meta{color:var(--twh-mute);font-size:11px}
		.twh-acttable .gsum{font-size:11.5px;color:var(--twh-ink4);font-variant-numeric:tabular-nums}
		.twh-acttable .gsum b{color:var(--twh-ink)}
		.twh-acttable .who span{min-width:0}
		.twh-fill{border:0;background:rgba(194,90,46,0.10);color:var(--twh-clay-deep);width:26px;height:26px;border-radius:8px;cursor:pointer;display:inline-grid;place-items:center;margin-right:6px;vertical-align:middle;transition:all .15s}
		.twh-fill:hover{background:var(--twh-clay);color:#fff}
		.twh-fill svg{width:12px;height:12px;stroke:currentColor;fill:none;stroke-width:2.2;margin:0}
		.twh-inboxgroup{margin-bottom:14px}
		.twh-inboxgroup:last-child{margin-bottom:0}
		.twh-grouphead{display:flex;align-items:center;gap:9px;padding:6px 4px;border-bottom:2px solid rgba(10,10,10,0.08)}
		.twh-grouphead .ic{width:26px;height:26px;border-radius:9px;display:grid;place-items:center;background:rgba(10,10,10,0.04);color:var(--twh-ink3)}
		.twh-grouphead .ic svg{width:13px;height:13px;stroke:currentColor;fill:none;stroke-width:2}
		.twh-grouphead .ic.hot{background:rgba(196,48,43,0.10);color:var(--twh-hot)}
		.twh-grouphead .ic.warn{background:rgba(217,150,46,0.14);color:#96650f}
		.twh-grouphead .ic.clay{background:rgba(194,90,46,0.12);color:var(--twh-clay-deep)}
		.twh-grouphead .ic.ok{background:rgba(63,143,79,0.12);color:#2e6b3a}
		.twh-grouphead b{font-size:12.5px;color:var(--twh-ink)}
		.twh-grouphead .n{font-size:10px;font-weight:600;background:rgba(10,10,10,0.06);border-radius:99px;padding:1px 8px;color:var(--twh-ink4)}
		.twh-grouphead .twh-btn{margin-left:auto}
		.twh-btn.small{padding:5px 12px;font-size:11px}
		.twh-kcard.grab{cursor:grab}
		.twh-kcard.grab:active{cursor:grabbing}
		.twh-kcard.dragging{opacity:.4;transform:rotate(1.5deg) scale(.98)}
		.twh-kcard .grip{float:right;color:var(--twh-mute);letter-spacing:-1px;font-size:10px;cursor:grab}
		.twh-kcol .drophint{display:none;align-items:center;justify-content:center;gap:7px;margin-top:6px;padding:14px;border-radius:12px;border:2px dashed rgba(194,90,46,0.5);color:var(--twh-clay-deep);font-size:12px;font-weight:600}
		.twh-kcol .drophint svg{width:13px;height:13px;stroke:currentColor;fill:none;stroke-width:2.2}
		.twh-kcol.droppable{box-shadow:inset 0 0 0 2px rgba(194,90,46,0.35)}
		.twh-kcol.droppable .drophint{display:flex}
		.twh-kcol.over{background:rgba(194,90,46,0.08)}
		.twh-buchips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:16px}
		.twh-chip{border:0;background:rgba(10,10,10,0.05);font-weight:500;font-size:12px;color:var(--twh-ink4);padding:7px 14px;border-radius:999px;cursor:pointer;transition:all .15s}
		.twh-chip:hover{color:var(--twh-ink)}
		.twh-chip.on{background:var(--twh-ink);color:#fafaf6}
		.twh-movecard{margin-bottom:4px}
		.twh-movecard b{color:var(--twh-ink);font-size:14px}
		.twh-movecard svg{width:15px;height:15px;stroke:var(--twh-clay);fill:none;stroke-width:2;vertical-align:-2px;margin-right:6px}
		.twh-movecard .sub{color:var(--twh-mute);font-size:12px;margin:2px 0 8px}
		.twh-movecard .hint{background:rgba(10,10,10,0.03);border-radius:10px;padding:9px 12px;font-size:12px;color:var(--twh-ink4);margin-bottom:6px}
		.twh-movecard .hint svg{width:12px;height:12px;margin-right:5px}
		.twh-movecard .hint.warn{background:rgba(217,150,46,0.12);color:#96650f}
		.twh-movecard .hint.warn svg{stroke:#96650f}
		.twh-movecard .hint.ok{background:rgba(63,143,79,0.10);color:#2e6b3a}
		.twh-movecard .hint.ok svg{stroke:#2e6b3a}
		.twh-kmore{margin-top:2px;padding:9px;border-radius:12px;border:1.5px dashed rgba(10,10,10,0.15);text-align:center;font-size:11.5px;font-weight:600;color:var(--twh-ink4);cursor:pointer;transition:all .15s}
		.twh-kmore:hover{background:var(--twh-ink);border-color:var(--twh-ink);color:#fafaf6}
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
		.twh-kcard{background:var(--twh-card);border-radius:14px;padding:13px 15px;box-shadow:var(--twh-shadow);margin-bottom:9px;cursor:pointer;transition:all .15s}
		.twh-kcard:hover{transform:translateY(-2px)}
		.twh-kcard .dot{width:7px;height:7px;border-radius:50%;display:inline-block;margin-right:7px;vertical-align:1px;background:var(--twh-mute);box-shadow:0 0 0 3px rgba(10,10,10,0.05)}
		.twh-kcard .dot.hot{background:var(--twh-hot);box-shadow:0 0 0 3px rgba(196,48,43,0.14)}
		.twh-kcard .dot.warn{background:var(--twh-warn);box-shadow:0 0 0 3px rgba(217,150,46,0.16)}
		.twh-kcard .dot.ok{background:var(--twh-ok);box-shadow:0 0 0 3px rgba(63,143,79,0.14)}
		.twh-kcard .dot.clay{background:var(--twh-clay);box-shadow:0 0 0 3px rgba(194,90,46,0.15)}
		.twh-kcard .dot.ink{background:var(--twh-ink3);box-shadow:0 0 0 3px rgba(10,10,10,0.08)}
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
		.twh-table .sub{font-size:10.5px;color:var(--twh-mute);font-weight:400;margin-top:1px}
		.twh-asgtable td.prog{min-width:90px}
		.twh-asgtable .lane{height:6px;border-radius:3px;background:rgba(10,10,10,0.06);overflow:hidden}
		.twh-asgtable .lane i{display:block;height:100%;border-radius:3px;background:var(--twh-grad-clay)}
		.twh-asgtable td.act{text-align:right;white-space:nowrap}
		.twhub--dialog{display:block;padding:0;margin:0;background:transparent}
		.twh-table td.inp{text-align:right}
		.twh-table input.twh-actual{width:96px;border:1px solid rgba(10,10,10,0.15);border-radius:8px;padding:6px 10px;font-size:13px;text-align:right;color:var(--twh-ink);background:var(--twh-card);outline:none;font-variant-numeric:tabular-nums}
		.twh-table input.twh-actual:focus{border-color:var(--twh-clay);box-shadow:0 0 0 2px rgba(194,90,46,0.15)}
		.twh-plgrid th .sub{font-size:10px;color:var(--twh-mute);font-weight:400}
		.twh-plgrid .plc{text-align:center;font-variant-numeric:tabular-nums;min-width:44px}
		.twh-plgrid .plc.on{background:rgba(194,90,46,0.13);font-weight:600;color:var(--twh-clay-deep)}
		.twh-plgrid th.today,.twh-plgrid td.today{box-shadow:inset 0 0 0 1.5px rgba(10,10,10,0.18)}
		.twh-plgrid tfoot td{font-weight:600;color:var(--twh-ink);background:rgba(10,10,10,0.02);border-top:2px solid rgba(10,10,10,0.10)}
		.twh-idlechips{display:flex;flex-wrap:wrap;gap:6px}
		.twh-repl{border:0;background:rgba(10,10,10,0.05);color:var(--twh-ink4);width:24px;height:24px;border-radius:8px;cursor:pointer;display:inline-grid;place-items:center;margin-left:8px;flex-shrink:0;transition:all .15s}
		.twh-repl:hover{background:var(--twh-ink);color:#fff}
		.twh-repl svg{width:11px;height:11px;stroke:currentColor;fill:none;stroke-width:2.2}
		.twh-desklink{margin-top:8px;border-top:1px solid var(--twh-hair);padding-top:10px;border-radius:0 0 10px 10px;color:var(--twh-mute)}
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
