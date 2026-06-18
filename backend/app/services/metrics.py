from prometheus_client import Counter

# Authentication outcomes
login_attempts = Counter(
    "glasshouse_login_attempts_total",
    "Login attempts by result",
    ["result"]  # "success" | "failure"
)

registrations = Counter(
    "glasshouse_registrations_total",
    "Completed registrations"
)

# Vault operations
vault_operations = Counter(
    "glasshouse_vault_operations_total",
    "Vault operations by type and result",
    ["operation", "result"]  # operation: read|write|export|delete ; result: success|conflict|not_found
)