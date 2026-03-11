# Copyright (c) 2025, Upande and contributors
# For license information, please see license.txt

import frappe
from frappe.utils import getdate, today
from datetime import date, timedelta

PREFIX = "Kaitet Group"

WEEKDAY_MAP = {
	"Mondays": 0, "Tuesdays": 1, "Wednesdays": 2,
	"Thursdays": 3, "Fridays": 4, "Saturdays": 5, "Sundays": 6,
}

SECURITY_WEEKLY_HOURS_TARGET = 60
SECURITY_LEAVE_TYPE = "Weekly Hours Off"


# ─── Holiday List Rollover ────────────────────────────────────────────────────

def _weekday_num_from_list_name(list_name):
	"""Return weekday int (0=Mon … 6=Sun) or None for Local Holidays only."""
	for plural, num in WEEKDAY_MAP.items():
		if f"w/ {plural}" in list_name:
			return num
	return None


def _all_weekday_dates(year, weekday):
	"""Return every date in *year* that falls on *weekday* (0=Mon … 6=Sun)."""
	dates = []
	d = date(year, 1, 1)
	while d.year == year:
		if d.weekday() == weekday:
			dates.append(d)
		d += timedelta(days=1)
	return dates


def _ensure_weekly_hours_off_leave_type():
	"""Create the 'Weekly Hours Off' leave type if it does not exist."""
	if frappe.db.exists("Leave Type", SECURITY_LEAVE_TYPE):
		return
	lt = frappe.new_doc("Leave Type")
	lt.leave_type_name = SECURITY_LEAVE_TYPE
	lt.is_carry_forward = 0
	lt.is_lwp = 0
	lt.include_holiday = 1
	lt.allow_negative = 0
	lt.insert(ignore_permissions=True)
	frappe.db.commit()


def rollover_holiday_lists():
	"""
	Creates next year's Kaitet Group holiday lists from the current year's lists,
	reassigns all employees whose holiday_list points to an older year,
	and updates Weekly Offs child-table records.

	Runs daily via scheduler:
	  - Nov 1 onwards: creates NEXT year's lists (so they're ready before year-end).
	  - Always: reassigns any employee still on a prior-year list to the current-year equivalent.
	"""
	today_date = getdate(today())
	current_year = today_date.year
	next_year = current_year + 1

	# ── Step 1: Create next-year lists (only Nov–Dec) ──────────────────────────
	if today_date.month >= 11:
		_create_year_lists(next_year, current_year)

	# ── Step 2: Reassign employees from any old-year list to current year ──────
	_reassign_employees_to_current_year(current_year)

	# ── Step 3: Update Weekly Offs child table ─────────────────────────────────
	_update_weekly_offs_to_current_year(current_year)


def _create_year_lists(target_year, source_year):
	"""Create Kaitet Group holiday lists for *target_year* from *source_year*."""
	local_dst = f"{PREFIX} {target_year} (Local Holidays only)"
	if frappe.db.exists("Holiday List", local_dst):
		return  # Already done

	frappe.logger().info(f"[Holiday Rollover] Creating {target_year} holiday lists from {source_year}.")

	source_lists = frappe.get_all(
		"Holiday List",
		filters={"holiday_list_name": ["like", f"{PREFIX} {source_year}%"]},
		fields=["name", "holiday_list_name"],
	)
	if not source_lists:
		frappe.logger().warning(f"[Holiday Rollover] No {source_year} source lists found — skipping.")
		return

	# ── 1a. Create Local Holidays only list first ───────────────────────────────
	local_src = f"{PREFIX} {source_year} (Local Holidays only)"
	if frappe.db.exists("Holiday List", local_src):
		src_holidays = frappe.get_all(
			"Holiday",
			filters={"parent": local_src, "weekly_off": 0},
			fields=["holiday_date", "description"],
			order_by="holiday_date",
		)
		new_local = frappe.new_doc("Holiday List")
		new_local.holiday_list_name = local_dst
		new_local.from_date = date(target_year, 1, 1)
		new_local.to_date = date(target_year, 12, 31)
		for h in src_holidays:
			old_d = getdate(h.holiday_date)
			try:
				new_d = old_d.replace(year=target_year)
			except ValueError:
				new_d = date(target_year, old_d.month, 28)  # Feb 29 edge case
			new_local.append("holidays", {
				"holiday_date": new_d,
				"description": h.description,
				"weekly_off": 0,
			})
		new_local.insert(ignore_permissions=True)
		frappe.db.commit()

	# Fetch the new public holidays to add to weekday lists
	public_holidays = frappe.get_all(
		"Holiday",
		filters={"parent": local_dst, "weekly_off": 0},
		fields=["holiday_date", "description"],
	) if frappe.db.exists("Holiday List", local_dst) else []
	public_holiday_dates = {getdate(h.holiday_date) for h in public_holidays}

	# ── 1b. Create one list per weekday ─────────────────────────────────────────
	for hl in source_lists:
		if "Local Holidays only" in hl.holiday_list_name:
			continue
		new_name = hl.holiday_list_name.replace(str(source_year), str(target_year))
		if frappe.db.exists("Holiday List", new_name):
			continue
		weekday = _weekday_num_from_list_name(hl.holiday_list_name)
		if weekday is None:
			continue

		new_hl = frappe.new_doc("Holiday List")
		new_hl.holiday_list_name = new_name
		new_hl.from_date = date(target_year, 1, 1)
		new_hl.to_date = date(target_year, 12, 31)

		# All occurrences of that weekday
		for d in _all_weekday_dates(target_year, weekday):
			new_hl.append("holidays", {
				"holiday_date": d,
				"description": d.strftime("%A"),
				"weekly_off": 1,
			})

		# Public holidays (skip if they fall on the weekly off day to avoid duplicates)
		for ph in public_holidays:
			ph_date = getdate(ph.holiday_date)
			if ph_date not in {d for d in _all_weekday_dates(target_year, weekday)}:
				new_hl.append("holidays", {
					"holiday_date": ph_date,
					"description": ph.description,
					"weekly_off": 0,
				})

		new_hl.insert(ignore_permissions=True)

	frappe.db.commit()
	frappe.logger().info(f"[Holiday Rollover] {target_year} holiday lists created.")


def _get_equivalent_list(old_list_name, target_year):
	"""Return the target_year equivalent of an older holiday list name, or None."""
	import re
	new_name = re.sub(r"\d{4}", str(target_year), old_list_name, count=1)
	return new_name if frappe.db.exists("Holiday List", new_name) else None


def _reassign_employees_to_current_year(current_year):
	"""Move employees on any pre-current-year list to the current-year equivalent."""
	old_lists = frappe.get_all(
		"Holiday List",
		filters={"holiday_list_name": ["like", f"{PREFIX} %"], "holiday_list_name": ["not like", f"{PREFIX} {current_year}%"]},
		fields=["name", "holiday_list_name"],
	)
	# Simplify: get all non-current-year lists
	all_lists = frappe.get_all(
		"Holiday List",
		filters={"holiday_list_name": ["like", f"{PREFIX} %"]},
		fields=["name", "holiday_list_name"],
	)
	old_lists = [l for l in all_lists if f"{PREFIX} {current_year}" not in l.holiday_list_name]

	reassigned = 0
	for hl in old_lists:
		equivalent = _get_equivalent_list(hl.holiday_list_name, current_year)
		if not equivalent:
			continue
		count = frappe.db.sql("""
			UPDATE `tabEmployee`
			SET holiday_list = %s
			WHERE holiday_list = %s
		""", (equivalent, hl.name))
		reassigned += frappe.db.sql(
			"SELECT ROW_COUNT()", as_list=True
		)[0][0]

	if reassigned:
		frappe.db.commit()
		frappe.logger().info(f"[Holiday Rollover] Reassigned {reassigned} employee(s) to {current_year} holiday lists.")


def _update_weekly_offs_to_current_year(current_year):
	"""Update holiday_list in Weekly Offs child rows to current-year equivalent."""
	all_lists = frappe.get_all(
		"Holiday List",
		filters={"holiday_list_name": ["like", f"{PREFIX} %"]},
		fields=["name", "holiday_list_name"],
	)
	old_lists = [l for l in all_lists if f"{PREFIX} {current_year}" not in l.holiday_list_name]

	for hl in old_lists:
		equivalent = _get_equivalent_list(hl.holiday_list_name, current_year)
		if not equivalent:
			continue
		frappe.db.sql("""
			UPDATE `tabWeekly Offs`
			SET holiday_list = %s
			WHERE holiday_list = %s
		""", (equivalent, hl.name))

	frappe.db.commit()


# ─── Security Guard 60-hr Weekly Attendance ──────────────────────────────────

def process_security_guard_attendance():
	"""
	Daily job: for each active Security Guard, sum submitted attendance hours
	for the current Mon–Sun week. If total >= 60, auto-create On Leave attendance
	records (leave_type = 'Weekly Hours Off') for each remaining day in the week
	that does not already have an attendance record.
	"""
	_ensure_weekly_hours_off_leave_type()

	today_date = getdate(today())
	week_start = today_date - timedelta(days=today_date.weekday())  # Monday
	week_end = week_start + timedelta(days=6)  # Sunday

	guards = frappe.get_all(
		"Employee",
		filters={"designation": "Security Guard", "status": "Active"},
		fields=["name", "employee_name", "company"],
	)

	processed = 0
	for guard in guards:
		result = frappe.db.sql("""
			SELECT COALESCE(SUM(working_hours), 0) AS total_hours
			FROM `tabAttendance`
			WHERE employee = %s
			  AND attendance_date BETWEEN %s AND %s
			  AND status IN ('Present', 'Work From Home', 'Half Day')
			  AND docstatus = 1
		""", (guard.name, week_start, week_end), as_dict=True)

		total_hours = result[0].total_hours if result else 0
		if total_hours < SECURITY_WEEKLY_HOURS_TARGET:
			continue

		# Mark remaining days this week (tomorrow onwards only — never today,
		# so that a guard who comes in after an absence can still be marked Present).
		# Records are saved as DRAFTS (not submitted) so that if a guard unexpectedly
		# reports to work on a scheduled-off day, the manager can cancel the draft
		# and submit a Present record instead.
		for offset in range(1, (week_end - today_date).days + 1):
			off_date = today_date + timedelta(days=offset)

			if frappe.db.exists("Attendance", {
				"employee": guard.name,
				"attendance_date": off_date,
				"docstatus": ["!=", 2],
			}):
				continue

			att = frappe.new_doc("Attendance")
			att.employee = guard.name
			att.employee_name = guard.employee_name
			att.attendance_date = off_date
			att.status = "On Leave"
			att.leave_type = SECURITY_LEAVE_TYPE
			att.company = guard.company
			att.insert(ignore_permissions=True)
			processed += 1

	if processed:
		frappe.db.commit()
		frappe.logger().info(
			f"[Security Guard Attendance] Created {processed} draft 'On Leave' record(s) for weekly hours target."
		)
