app_name = "kaitet_taskwork"
app_title = "Upande HR"
app_publisher = "Upande"
app_description = "Upande HR Management System"
app_email = "dev@upande.com"
app_license = "mit"

add_to_apps_screen = [
	{
		"name": "Upande HR",
		"logo": "/assets/kaitet_taskwork/images/logo.png",
		"title": "Upande HR",
		"route": "/app/task-worker",
	}
]

doc_events = {}

# Restrict list/search results to the current user's company.
# System Managers bypass these conditions and see everything.
permission_query_conditions = {
	"Task Worker":          "kaitet_taskwork.kaitet_taskwork.permissions.conditions_task_worker",
	"Task Work Request":    "kaitet_taskwork.kaitet_taskwork.permissions.conditions_task_work_request",
	"Task Work Plan":       "kaitet_taskwork.kaitet_taskwork.permissions.conditions_task_work_plan",
	"Task Work Assignment": "kaitet_taskwork.kaitet_taskwork.permissions.conditions_task_work_assignment",
	"TW Weekly Disbursement": "kaitet_taskwork.kaitet_taskwork.permissions.conditions_tw_weekly_disbursement",
}

scheduler_events = {
	"daily": [
		"kaitet_taskwork.kaitet_taskwork.doctype.employee_weekly_off_plan.employee_weekly_off_plan.revert_expired_weekly_off_plans",
		"kaitet_taskwork.kaitet_taskwork.kaitet_taskwork.utils.rollover_holiday_lists",
		"kaitet_taskwork.kaitet_taskwork.kaitet_taskwork.utils.process_security_guard_attendance",
	]
}

fixtures = [
	{
		"dt": "Module Def",
		"filters": [["name", "in", ["Kaitet Taskwork"]]],
	},
	{
		"dt": "Custom Field",
		"filters": [["module", "=", "Kaitet Taskwork"]],
	},
	{
		"dt": "Print Format",
		"filters": [["module", "=", "Kaitet Taskwork"]],
	},
	{
		"dt": "Workflow",
		"filters": [["name", "=", "TW Weekly Disbursement Approval"]],
	},
	{
		"dt": "Workflow State",
		"filters": [["name", "in", ["Pending Approval", "Rejected", "Paid"]]],
	},
	{
		"dt": "Workflow Action Master",
		"filters": [["name", "in", ["Submit for Approval", "Approve", "Reject", "Mark as Paid"]]],
	},
]

after_install = "kaitet_taskwork.kaitet_taskwork.setup.workflow.execute"
after_migrate = ["kaitet_taskwork.kaitet_taskwork.setup.workflow.execute"]
