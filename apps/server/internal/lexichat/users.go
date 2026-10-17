package lexichat

import (
	"errors"
	"slices"
	"strings"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"
)

var (
	errLastAdmin = errors.New("Es muss mindestens eine aktive Administratorin bzw. ein aktiver Administrator verbleiben.")

	// fields a user may change on the own record via the record api
	selfEditableFields = []string{"name", "avatar"}
	// fields an admin may change on any record via the record api
	adminEditableFields = []string{"name", "avatar", "username", "role", "active"}

	// fields that are only shown to the owner, admins and superusers
	privateUserFields = []string{"role", "must_change_password", "email", "emailVisibility", "verified", "created", "updated"}
)

func isActiveAdmin(r *core.Record) bool {
	return r != nil && r.Collection().Name == ColUsers &&
		r.GetString("role") == RoleAdmin && r.GetBool("active") && !r.GetBool("must_change_password")
}

// bodyFieldName strips the PocketBase modifiers (e.g. "avatar+", "+avatar", "avatar-").
func bodyFieldName(key string) string {
	return strings.TrimSuffix(strings.TrimSuffix(strings.TrimPrefix(key, "+"), "+"), "-")
}

// checkBodyFields rejects any submitted key that is not in the allow list.
func checkBodyFields(e *core.RequestEvent, allowed []string) error {
	info, err := e.RequestInfo()
	if err != nil {
		return err
	}
	var denied []string
	for key := range info.Body {
		if !slices.Contains(allowed, bodyFieldName(key)) {
			denied = append(denied, key)
		}
	}
	if len(denied) > 0 {
		slices.Sort(denied)
		return router.NewForbiddenError("Diese Felder dürfen nicht geändert werden: "+strings.Join(denied, ", "), nil)
	}
	return nil
}

// countOtherActiveAdmins counts active admins except the given user id.
func countOtherActiveAdmins(app core.App, exceptId string) (int64, error) {
	return app.CountRecords(ColUsers, dbx.HashExp{"role": RoleAdmin, "active": true}, dbx.Not(dbx.HashExp{"id": exceptId}))
}

func (s *Server) registerUserHooks(app core.App) {
	// --- model level invariants (apply to every write path incl. superusers and the cli) ---

	app.OnRecordUpdate(ColUsers).BindFunc(func(e *core.RecordEvent) error {
		// compare against the persisted state (Record.Original() depends on how the record was loaded)
		orig, err := e.App.FindRecordById(ColUsers, e.Record.Id)
		if err != nil {
			return err
		}
		wasAdmin := orig.GetString("role") == RoleAdmin && orig.GetBool("active")
		isAdmin := e.Record.GetString("role") == RoleAdmin && e.Record.GetBool("active")
		if wasAdmin && !isAdmin {
			n, err := countOtherActiveAdmins(e.App, e.Record.Id)
			if err != nil {
				return err
			}
			if n == 0 {
				return errLastAdmin
			}
		}

		deactivated := orig.GetBool("active") && !e.Record.GetBool("active")
		if deactivated {
			// invalidates all issued tokens (and the realtime auth state)
			e.Record.RefreshTokenKey()
		}

		if err := e.Next(); err != nil {
			return err
		}

		if deactivated {
			return deleteUserSessions(e.App, e.Record.Id, "")
		}
		return nil
	})

	app.OnRecordDelete(ColUsers).BindFunc(func(e *core.RecordEvent) error {
		if e.Record.GetString("role") == RoleAdmin && e.Record.GetBool("active") {
			n, err := countOtherActiveAdmins(e.App, e.Record.Id)
			if err != nil {
				return err
			}
			if n == 0 {
				return errLastAdmin
			}
		}

		// 1:1 chats (and via cascade their messages) are removed with the account,
		// see docs/datenschutz/05-loeschkonzept.md
		chats, err := e.App.FindRecordsByFilter(ColChats, "members.id ?= {:id}", "", 0, 0, dbx.Params{"id": e.Record.Id})
		if err != nil {
			return err
		}
		for _, chat := range chats {
			if err := e.App.Delete(chat); err != nil {
				return err
			}
		}
		return e.Next()
	})

	// --- api level checks ---

	app.OnRecordUpdateRequest(ColUsers).BindFunc(func(e *core.RecordRequestEvent) error {
		if e.HasSuperuserAuth() {
			return e.Next()
		}

		isSelf := e.Auth != nil && e.Auth.Id == e.Record.Id
		allowed := selfEditableFields
		if isActiveAdmin(e.Auth) {
			allowed = adminEditableFields
		}
		if err := checkBodyFields(e.RequestEvent, allowed); err != nil {
			return err
		}

		orig := e.Record.Original()
		if isSelf && (e.Record.GetString("role") != orig.GetString("role") || e.Record.GetBool("active") != orig.GetBool("active")) {
			return e.ForbiddenError("Sie können Ihre eigene Rolle und Ihren eigenen Status nicht ändern.", nil)
		}

		if err := e.Next(); err != nil {
			return err
		}

		s.auditUserChange(e, orig)
		return nil
	})

	app.OnRecordDeleteRequest(ColUsers).BindFunc(func(e *core.RecordRequestEvent) error {
		if !e.HasSuperuserAuth() && e.Auth != nil && e.Auth.Id == e.Record.Id {
			return e.ForbiddenError("Sie können Ihr eigenes Konto nicht löschen.", nil)
		}
		if err := e.Next(); err != nil {
			return err
		}
		s.Audit(e.App, AuditEntry{
			Action:      AuditUserDeleted,
			Actor:       e.Auth,
			TargetType:  ColUsers,
			TargetId:    e.Record.Id,
			TargetLabel: e.Record.GetString("username"),
			IP:          e.RealIP(),
		})
		return nil
	})

	// field level visibility
	app.OnRecordEnrich(ColUsers).BindFunc(func(e *core.RecordEnrichEvent) error {
		info := e.RequestInfo
		if info == nil || info.Auth == nil {
			e.Record.Hide(privateUserFields...)
			return e.Next()
		}
		if info.Auth.IsSuperuser() || info.Auth.Id == e.Record.Id || isActiveAdmin(info.Auth) {
			return e.Next()
		}
		e.Record.Hide(privateUserFields...)
		return e.Next()
	})
}

func (s *Server) auditUserChange(e *core.RecordRequestEvent, orig *core.Record) {
	base := AuditEntry{
		Actor:       e.Auth,
		TargetType:  ColUsers,
		TargetId:    e.Record.Id,
		TargetLabel: e.Record.GetString("username"),
		IP:          e.RealIP(),
	}

	if orig.GetBool("active") != e.Record.GetBool("active") {
		entry := base
		entry.Action = AuditUserReactivated
		if !e.Record.GetBool("active") {
			entry.Action = AuditUserDeactivated
		}
		s.Audit(e.App, entry)
	}

	if orig.GetString("role") != e.Record.GetString("role") {
		entry := base
		entry.Action = AuditUserRoleChanged
		entry.Details = map[string]any{"from": orig.GetString("role"), "to": e.Record.GetString("role")}
		s.Audit(e.App, entry)
	}

	var changed []string
	for _, f := range []string{"name", "username", "avatar"} {
		if orig.GetString(f) != e.Record.GetString(f) {
			changed = append(changed, f)
		}
	}
	if len(changed) > 0 {
		entry := base
		entry.Action = AuditUserUpdated
		entry.Details = map[string]any{"fields": changed}
		s.Audit(e.App, entry)
	}
}
