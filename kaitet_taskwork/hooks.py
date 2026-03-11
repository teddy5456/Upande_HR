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
]
