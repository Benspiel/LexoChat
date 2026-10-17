package lexichat

// Collection names.
const (
	ColUsers      = "users"
	ColSettings   = "lx_settings"
	ColSessions   = "sessions"
	ColChats      = "chats"
	ColMessages   = "messages"
	ColBroadcasts = "broadcasts"
	ColReceipts   = "receipts"
	ColAuditLogs  = "audit_logs"
)

// SettingsRecordId is the id of the single global settings record.
const SettingsRecordId = "globalsettings1"

// Roles.
const (
	RoleAdmin = "admin"
	RoleUser  = "user"
)

// Chat types. Only "direct" exists in the MVP; "group" is reserved for later.
const ChatTypeDirect = "direct"

// Session client types.
const (
	ClientDesktop  = "desktop"
	ClientAdminWeb = "admin_web"
)

// API rule building blocks. They are shared by the migration and the docs
// (docs/02-rechtekonzept.md) and must stay in sync with them.
const (
	// RuleActive matches an authenticated, active user that is not forced to change the password.
	RuleActive = `@request.auth.collectionName = "users" && @request.auth.active = true && @request.auth.must_change_password = false`

	// RuleAdmin matches an active admin.
	RuleAdmin = RuleActive + ` && @request.auth.role = "admin"`
)

// Field limits.
const (
	MaxCiphertextLen = 100_000
	MaxEnvelopesSize = 16 * 1024
	MaxWrappedKeys   = 4 * 1024
	MaxPublicKeyLen  = 64
)
