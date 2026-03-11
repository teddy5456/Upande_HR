# Copyright (c) 2025, Upande and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt, today, getdate, add_days, date_diff, now_datetime
import json

class TaskWorkAssignment(Document):
    def validate(self):
        if self.task_work_request:
            self.title = self.task_work_request

        # Inherit business_unit and cost_centre from the linked plan if not set
        if self.task_work_plan and (not self.business_unit or not self.cost_centre):
            plan = frappe.db.get_value(
                "Task Work Plan", self.task_work_plan,
                ["business_unit", "cost_centre"], as_dict=True,
            )
            if plan:
                if not self.business_unit and plan.business_unit:
                    self.business_unit = plan.business_unit
                if not self.cost_centre and plan.cost_centre:
                    self.cost_centre = plan.cost_centre

        self.update_stage()
        self.calculate_worker_achievements()
        self.validate_achievement_totals()
        self.validate_dates()
        self.calculate_totals()

    def on_submit(self):
        if self.task_work_request:
            frappe.db.set_value(
                "Task Work Request", self.task_work_request, "stage", "Assigned"
            )
        if self.task_work_plan:
            frappe.db.set_value(
                "Task Work Plan", self.task_work_plan, "stage", "Assigned"
            )
        self._mark_workers_busy()
        self.create_notification("submitted")

    def on_cancel(self):
        self.db_set("stage", "Cancelled")
        self._free_workers()

    def _mark_workers_busy(self):
        """Set current_assignment on every Task Worker in this assignment."""
        workers = list({row.employee_name for row in self.worker_assignments if row.employee_name})
        for worker in workers:
            frappe.db.set_value("Task Worker", worker, "current_assignment", self.name)

    def _free_workers(self):
        """Clear current_assignment for all Task Workers linked to this assignment."""
        busy = frappe.get_all(
            "Task Worker",
            filters={"current_assignment": self.name},
            pluck="name",
        )
        for worker in busy:
            frappe.db.set_value("Task Worker", worker, "current_assignment", None)
        
    def on_update_after_submit(self):
        self.update_stage()
        
    def update_stage(self):
        """Update stage based on dates and progress"""
        if self.completion_date:
            self.stage = "Completed"
        elif self.start_date and getdate(self.start_date) <= getdate(today()):
            # Check if all tasks are completed
            all_completed = True
            for task in self.get("task_details", []):
                if task.status != "Completed":
                    all_completed = False
                    break
            
            if all_completed:
                self.stage = "Completed"
            else:
                self.stage = "In Progress"
        else:
            self.stage = "Pending"

    def calculate_worker_achievements(self):
        """Auto-calculate achievement % and actual_cost for each worker row."""
        for row in self.get("worker_assignments", []):
            qty_assigned = flt(row.quantity_assigned)
            actual_qty = flt(row.actual_quantity)
            rate = flt(row.rate)

            if qty_assigned > 0:
                row.achievement = round(actual_qty / qty_assigned * 100, 1)

            row.actual_cost = round(actual_qty * rate, 2)
            
            if not row.total_assigned_cost and qty_assigned and rate:
                row.total_assigned_cost = round(qty_assigned * rate, 2)

    def validate_achievement_totals(self):
        """
        Individual workers may exceed their own allocation (>100% achievement is fine).
        However, the SUM of actual_quantity across all workers for a task must not
        exceed that task's total_work — if someone did extra, others must have done less.
        """
        if not self.worker_assignments or not self.task_details:
            return

        total_work_map = {row.task: flt(row.total_work) for row in self.task_details}

        actual_by_task = {}
        for row in self.worker_assignments:
            if row.task and row.actual_quantity:
                actual_by_task[row.task] = (
                    actual_by_task.get(row.task, 0) + flt(row.actual_quantity)
                )

        errors = []
        for task_id, actual in actual_by_task.items():
            total = total_work_map.get(task_id, 0)
            if total > 0 and actual > total:
                task_name = frappe.db.get_value("Task", task_id, "subject") or task_id
                errors.append(
                    f"Task <b>{task_name}</b>: total actual quantity "
                    f"({actual:.2f}) exceeds total work ({total:.2f}). "
                    f"Reduce work from over-performing workers so the sum stays within the allocation."
                )

        if errors:
            frappe.throw("<br><br>".join(errors), title="Total Work Exceeded")
    
    def validate_dates(self):
        """Validate assignment dates"""
        if self.start_date and self.expected_end_date:
            if getdate(self.expected_end_date) < getdate(self.start_date):
                frappe.throw(_("Expected end date cannot be before start date"))
        
        # Validate worker assignment dates
        for row in self.get("worker_assignments", []):
            if row.assignment_date:
                if self.start_date and getdate(row.assignment_date) < getdate(self.start_date):
                    frappe.throw(_("Row #{0}: Assignment date cannot be before start date").format(row.idx))
                if self.expected_end_date and getdate(row.assignment_date) > getdate(self.expected_end_date):
                    frappe.msgprint(_("Row #{0}: Assignment date is after expected end date").format(row.idx))
    
    def calculate_totals(self):
        """Calculate total estimated cost"""
        total = 0
        for row in self.get("worker_assignments", []):
            total += flt(row.total_assigned_cost) or 0
        self.total_estimated_cost = total
    
    def create_notification(self, action):
        """Create notification for assignment action"""
        subject = f"Task Work Assignment {self.name} {action}"
        message = f"""
            <p>Task Work Assignment <strong>{self.name}</strong> has been {action}.</p>
            <p><strong>Title:</strong> {self.title}</p>
            <p><strong>Farm Manager:</strong> {self.farm_manager}</p>
            <p><strong>Start Date:</strong> {self.start_date}</p>
            <p><strong>Total Estimated Cost:</strong> {self.total_estimated_cost}</p>
            <p><strong>Stage:</strong> {self.stage}</p>
        """
        
        # Notify farm manager
        if self.farm_manager:
            user_id = frappe.db.get_value("Employee", self.farm_manager, "user_id")
            if user_id:
                frappe.sendmail(
                    recipients=[user_id],
                    subject=subject,
                    message=message
                )


@frappe.whitelist()
def get_workers_for_task(task_name, start_date, end_date, unit=None):
    """Get available workers for a specific task"""
    
    filters = {"status": "Active"}
    if unit:
        filters["custom_unit"] = unit
    
    # Get all active workers
    workers = frappe.get_all("Task Worker", 
        filters=filters,
        fields=["name", "employee_name", "custom_daily_rate as daily_rate", "custom_skill_level as skill_level"]
    )
    
    # Check existing assignments during this period
    for worker in workers:
        assignments = frappe.db.sql("""
            SELECT COUNT(*) as count,
                   SUM(quantity_assigned) as total_quantity
            FROM `tabWorker Assignments`
            WHERE employee_name = %s
                AND assignment_date BETWEEN %s AND %s
                AND docstatus = 1
        """, (worker.name, start_date, end_date), as_dict=True)
        
        worker['current_assignments'] = assignments[0].count if assignments else 0
        worker['total_quantity'] = assignments[0].total_quantity if assignments else 0
        worker['available'] = assignments[0].count == 0 if assignments else True
    
    # Sort by availability and skill
    workers.sort(key=lambda x: (not x['available'], -x.get('skill_level', 0)))
    
    return workers


@frappe.whitelist()
def get_worker_availability(worker_name, start_date, end_date):
    """Check if a worker is available during a period"""
    
    assignments = frappe.db.sql("""
        SELECT assignment_date, quantity_assigned, task
        FROM `tabWorker Assignments`
        WHERE employee_name = %s
            AND assignment_date BETWEEN %s AND %s
            AND docstatus = 1
        ORDER BY assignment_date
    """, (worker_name, start_date, end_date), as_dict=True)
    
    # Group by date
    schedule = {}
    total_quantity = 0
    for a in assignments:
        date_str = str(a.assignment_date)
        if date_str not in schedule:
            schedule[date_str] = []
        schedule[date_str].append({
            'task': a.task,
            'quantity': a.quantity_assigned
        })
        total_quantity += a.quantity_assigned
    
    total_days = date_diff(end_date, start_date) + 1
    
    return {
        'worker': worker_name,
        'assignments': len(assignments),
        'schedule': schedule,
        'total_quantity': total_quantity,
        'assigned_days': len(schedule),
        'available_days': total_days - len(schedule),
        'is_available': len(schedule) < total_days
    }


@frappe.whitelist()
def calculate_worker_payment(assignment_name):
    """Calculate payments for all workers in an assignment"""
    
    # Get all worker assignments
    workers = frappe.db.sql("""
        SELECT 
            wa.employee_name,
            wa.task,
            wa.quantity_assigned,
            wa.actual_quantity,
            wa.rate,
            wa.uom,
            wa.total_assigned_cost,
            wa.actual_cost,
            wa.achievement
        FROM `tabWorker Assignments` wa
        WHERE wa.parent = %s
    """, assignment_name, as_dict=True)
    
    payment_summary = {}
    total_payment = 0
    total_assigned = 0
    total_actual = 0
    
    for w in workers:
        worker = w.employee_name
        if worker not in payment_summary:
            payment_summary[worker] = {
                'total_assigned': 0,
                'total_actual': 0,
                'payment': 0,
                'tasks': [],
                'avg_achievement': 0
            }
        
        assigned_cost = flt(w.total_assigned_cost)
        actual_cost = flt(w.actual_cost) or assigned_cost
        
        payment_summary[worker]['total_assigned'] += flt(w.quantity_assigned)
        payment_summary[worker]['total_actual'] += flt(w.actual_quantity)
        payment_summary[worker]['payment'] += actual_cost
        payment_summary[worker]['tasks'].append({
            'task': w.task,
            'assigned': w.quantity_assigned,
            'actual': w.actual_quantity,
            'payment': actual_cost,
            'achievement': w.achievement
        })
        
        total_assigned += flt(w.quantity_assigned)
        total_actual += flt(w.actual_quantity)
        total_payment += actual_cost
    
    # Calculate average achievement per worker
    for worker in payment_summary:
        if payment_summary[worker]['tasks']:
            achievements = [t['achievement'] for t in payment_summary[worker]['tasks'] if t['achievement']]
            if achievements:
                payment_summary[worker]['avg_achievement'] = sum(achievements) / len(achievements)
    
    return {
        'workers': payment_summary,
        'total_payment': total_payment,
        'total_assigned': total_assigned,
        'total_actual': total_actual,
        'worker_count': len(payment_summary),
        'overall_achievement': (total_actual / total_assigned * 100) if total_assigned > 0 else 0
    }


@frappe.whitelist()
def validate_worker_schedule(assignment_name):
    """Validate that no worker is double-booked"""
    
    assignments = frappe.db.sql("""
        SELECT 
            wa.employee_name,
            wa.assignment_date,
            COUNT(*) as assignment_count,
            GROUP_CONCAT(wa.task SEPARATOR ', ') as tasks
        FROM `tabWorker Assignments` wa
        WHERE wa.parent = %s
        GROUP BY wa.employee_name, wa.assignment_date
        HAVING COUNT(*) > 1
    """, assignment_name, as_dict=True)
    
    if assignments:
        conflicts = []
        for a in assignments:
            conflicts.append({
                'worker': a.employee_name,
                'date': a.assignment_date,
                'count': a.assignment_count,
                'tasks': a.tasks
            })
        
        return {
            'has_conflict': True,
            'conflicts': conflicts
        }
    
    return {
        'has_conflict': False,
        'message': 'No scheduling conflicts found'
    }


@frappe.whitelist()
def get_task_progress(assignment_name):
    """Get progress for all tasks in an assignment"""
    
    # Get task totals
    tasks = frappe.db.sql("""
        SELECT 
            td.task,
            td.task_name,
            td.total_work,
            td.uom,
            td.daily_target,
            td.rate,
            td.status,
            SUM(wa.actual_quantity) as completed_work,
            SUM(wa.quantity_assigned) as total_assigned,
            COUNT(DISTINCT wa.employee_name) as workers_assigned,
            SUM(wa.actual_cost) as actual_cost,
            SUM(wa.total_assigned_cost) as assigned_cost
        FROM `tabTask Details` td
        LEFT JOIN `tabWorker Assignments` wa ON wa.task = td.task AND wa.parent = td.parent
        WHERE td.parent = %s
        GROUP BY td.task, td.task_name, td.total_work, td.uom, td.daily_target, td.rate, td.status
    """, assignment_name, as_dict=True)
    
    for task in tasks:
        task['progress'] = (flt(task.completed_work) / flt(task.total_work)) * 100 if task.total_work else 0
        task['remaining'] = flt(task.total_work) - flt(task.completed_work)
        task['remaining_days'] = frappe.utils.ceil(task['remaining'] / (task.daily_target or 1)) if task.daily_target else 0
        
        # Update status based on progress
        if task['progress'] >= 100:
            task['status'] = 'Completed'
        elif task['progress'] > 0:
            task['status'] = 'In Progress'
        else:
            task['status'] = 'Pending'
    
    return tasks


@frappe.whitelist()
def create_payment_entry(assignment_name):
    """Create a payment entry for the assignment"""
    
    assignment = frappe.get_doc("Task Work Assignment", assignment_name)
    
    if not assignment.worker_assignments:
        frappe.throw(_("No worker assignments found"))
    
    # Calculate total payment
    total_payment = sum([flt(w.actual_cost or w.total_assigned_cost) for w in assignment.worker_assignments])
    
    # Create payment entry (adjust based on your payment doctype)
    # This is a template - modify according to your actual Payment Entry doctype
    payment_entry = frappe.new_doc("Payment Entry")
    payment_entry.payment_type = "Pay"
    payment_entry.posting_date = today()
    payment_entry.party_type = "Employee"
    payment_entry.paid_amount = total_payment
    payment_entry.received_amount = total_payment
    payment_entry.reference_no = assignment_name
    payment_entry.reference_date = today()
    
    # Add rows for each worker (if your Payment Entry supports multiple rows)
    for w in assignment.worker_assignments:
        # Get employee link
        employee = frappe.db.get_value("Task Worker", w.employee_name, "employee")
        if employee:
            payment_entry.append("references", {
                "reference_doctype": "Task Work Assignment",
                "reference_name": assignment_name,
                "allocated_amount": flt(w.actual_cost or w.total_assigned_cost)
            })
    
    payment_entry.flags.ignore_permissions = True
    payment_entry.insert()
    
    return payment_entry.name


@frappe.whitelist()
def get_worker_performance(assignment_name):
    """Get performance metrics for workers"""
    
    performance = frappe.db.sql("""
        SELECT 
            wa.employee_name,
            COUNT(DISTINCT wa.task) as tasks_completed,
            SUM(wa.actual_quantity) as total_work_done,
            SUM(wa.actual_cost) as total_earnings,
            AVG(wa.achievement) as avg_achievement,
            MIN(wa.assignment_date) as first_assignment,
            MAX(wa.assignment_date) as last_assignment
        FROM `tabWorker Assignments` wa
        WHERE wa.parent = %s
        GROUP BY wa.employee_name
    """, assignment_name, as_dict=True)
    
    return performance


@frappe.whitelist()
def reassign_worker(assignment_name, old_worker, new_worker, task=None):
    """Reassign work from one worker to another"""
    
    assignment = frappe.get_doc("Task Work Assignment", assignment_name)
    
    filters = {"employee_name": old_worker}
    if task:
        filters["task"] = task
    
    # Find assignments to reassign
    to_reassign = [w for w in assignment.worker_assignments if 
                   w.employee_name == old_worker and (not task or w.task == task)]
    
    if not to_reassign:
        frappe.throw(_("No assignments found for worker {0}".format(old_worker)))
    
    reassigned_count = 0
    for old in to_reassign:
        # Create new assignment
        new_row = assignment.append("worker_assignments", {
            "employee_name": new_worker,
            "task": old.task,
            "uom": old.uom,
            "daily_target": old.daily_target,
            "rate": old.rate,
            "quantity_assigned": old.quantity_assigned,
            "assignment_date": old.assignment_date,
            "total_assigned_cost": old.total_assigned_cost
        })
        
        # Remove old assignment
        assignment.remove(old)
        reassigned_count += 1
    
    assignment.save()
    
    frappe.db.commit()
    
    return {
        'message': _("Successfully reassigned {0} tasks from {1} to {2}".format(
            reassigned_count, old_worker, new_worker)),
        'reassigned_count': reassigned_count
    }


@frappe.whitelist()
def get_daily_schedule(assignment_name):
    """Get daily schedule of assignments"""
    
    schedule = frappe.db.sql("""
        SELECT 
            wa.assignment_date,
            wa.employee_name,
            wa.task,
            wa.quantity_assigned,
            wa.uom,
            wa.daily_target
        FROM `tabWorker Assignments` wa
        WHERE wa.parent = %s
        ORDER BY wa.assignment_date, wa.employee_name
    """, assignment_name, as_dict=True)
    
    # Group by date
    daily_schedule = {}
    for row in schedule:
        date_str = str(row.assignment_date)
        if date_str not in daily_schedule:
            daily_schedule[date_str] = []
        
        daily_schedule[date_str].append({
            'worker': row.employee_name,
            'task': row.task,
            'quantity': row.quantity_assigned,
            'uom': row.uom,
            'daily_target': row.daily_target
        })
    
    return daily_schedule


@frappe.whitelist()
def get_completion_summary(assignment_name):
    """Get completion summary for the assignment"""
    
    tasks = get_task_progress(assignment_name)
    payments = calculate_worker_payment(assignment_name)
    
    completed_tasks = [t for t in tasks if t['progress'] >= 100]
    in_progress_tasks = [t for t in tasks if 0 < t['progress'] < 100]
    pending_tasks = [t for t in tasks if t['progress'] == 0]
    
    return {
        'total_tasks': len(tasks),
        'completed_tasks': len(completed_tasks),
        'in_progress_tasks': len(in_progress_tasks),
        'pending_tasks': len(pending_tasks),
        'completion_percentage': (len(completed_tasks) / len(tasks)) * 100 if tasks else 0,
        'total_payment': payments['total_payment'],
        'total_workers': payments['worker_count'],
        'total_work_assigned': payments['total_assigned'],
        'total_work_completed': payments['total_actual']
    }


@frappe.whitelist()
def auto_assign_workers(assignment_name):
    """Auto-assign workers to tasks based on availability"""
    
    assignment = frappe.get_doc("Task Work Assignment", assignment_name)
    
    if not assignment.task_details:
        frappe.throw(_("No tasks found in assignment"))
    
    if not assignment.start_date:
        frappe.throw(_("Start date is required for auto-assignment"))
    
    # Get available workers
    unit = assignment.unitdivision
    workers = frappe.get_all("Task Worker", 
        filters={"status": "Active"},
        fields=["name", "employee_name", "custom_daily_rate as daily_rate"]
    )
    
    if not workers:
        frappe.throw(_("No active workers found"))
    
    # Clear existing assignments
    assignment.worker_assignments = []
    
    # Sort tasks by date
    tasks = sorted(assignment.task_details, key=lambda x: (x.start_date or assignment.start_date, -x.total_work))
    
    current_date = getdate(assignment.start_date)
    worker_index = 0
    assignments_created = 0
    
    for task in tasks:
        if not task.total_work:
            continue
            
        total_work = flt(task.total_work)
        daily_target = flt(task.daily_target) or 1
        task_duration = task.days or frappe.utils.ceil(total_work / (len(workers) * daily_target))
        
        work_remaining = total_work
        task_start = getdate(task.start_date) or current_date
        
        for day in range(task_duration):
            if work_remaining <= 0:
                break
                
            day_date = add_days(task_start, day)
            
            # Calculate workers needed for this day
            workers_today = min(len(workers), frappe.utils.ceil(work_remaining / daily_target))
            
            for i in range(workers_today):
                if work_remaining <= 0:
                    break
                    
                worker = workers[worker_index % len(workers)]
                worker_index += 1
                
                worker_qty = min(daily_target, work_remaining)
                
                # Create assignment
                row = assignment.append("worker_assignments", {})
                row.employee_name = worker.name
                row.task = task.task
                row.uom = task.uom
                row.daily_target = daily_target
                row.rate = task.rate
                row.quantity_assigned = worker_qty
                row.total_assigned_cost = flt(task.rate * worker_qty, 2)
                row.assignment_date = str(day_date)
                
                work_remaining -= worker_qty
                assignments_created += 1
        
        # Update current date for next task
        if task_start > current_date:
            current_date = add_days(task_start, task_duration)
        else:
            current_date = add_days(current_date, task_duration)
    
    # Set completion date
    assignment.completion_date = str(current_date)
    
    assignment.save()
    
    return {
        'message': _("Successfully created {0} assignments".format(assignments_created)),
        'assignments_created': assignments_created,
        'workers_used': len(set([w.employee_name for w in assignment.worker_assignments]))
    }