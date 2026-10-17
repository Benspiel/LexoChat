package lexichat

import (
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"
)

const retentionBatch = 500

// RetentionResult reports what a cleanup run removed.
type RetentionResult struct {
	Messages   int
	Broadcasts int
	Sessions   int
	AuditLogs  int64
}

func (s *Server) registerJobs(app core.App) {
	app.Cron().MustAdd("lexichatRetention", "*/5 * * * *", func() {
		if _, err := s.RunRetention(app); err != nil {
			app.Logger().Error("retention run failed", "error", err)
		}
	})
}

// RunRetention deletes expired messages, broadcasts, sessions and audit entries.
// Records are deleted through the app (hooks + realtime delete events), audit
// entries with a direct query (they are append-only on the model level).
func (s *Server) RunRetention(app core.App) (RetentionResult, error) {
	var res RetentionResult
	nowStr := types.NowDateTime().String()
	gs := loadGlobalSettings(app)

	n, err := deleteInBatches(app, ColMessages, dbx.And(
		dbx.NewExp("[[expires_at]] != ''"),
		dbx.NewExp("[[expires_at]] < {:now}", dbx.Params{"now": nowStr}),
	))
	res.Messages = n
	if err != nil {
		return res, err
	}

	n, err = deleteInBatches(app, ColBroadcasts, dbx.And(
		dbx.NewExp("[[expires_at]] != ''"),
		dbx.NewExp("[[expires_at]] < {:now}", dbx.Params{"now": nowStr}),
	))
	res.Broadcasts = n
	if err != nil {
		return res, err
	}

	idleCutoff := types.NowDateTime().Add(-time.Duration(gs.SessionIdleMinutes) * time.Minute).String()
	n, err = deleteInBatches(app, ColSessions, dbx.Or(
		dbx.NewExp("[[expires_at]] < {:now}", dbx.Params{"now": nowStr}),
		dbx.NewExp("[[last_seen]] < {:idle}", dbx.Params{"idle": idleCutoff}),
	))
	res.Sessions = n
	if err != nil {
		return res, err
	}

	res.AuditLogs, err = deleteAuditLogsOlderThan(app, time.Now().Add(-time.Duration(gs.AuditRetentionDays)*24*time.Hour))
	if err != nil {
		return res, err
	}

	if res.Messages+res.Broadcasts+res.Sessions > 0 || res.AuditLogs > 0 {
		s.Audit(app, AuditEntry{Action: AuditRetentionCompleted, Details: map[string]any{
			"messages":   res.Messages,
			"broadcasts": res.Broadcasts,
			"sessions":   res.Sessions,
			"auditLogs":  res.AuditLogs,
		}})
	}
	return res, nil
}

func deleteInBatches(app core.App, collection string, where dbx.Expression) (int, error) {
	col, err := app.FindCachedCollectionByNameOrId(collection)
	if err != nil {
		return 0, err
	}
	total := 0
	for {
		batch := []*core.Record{}
		if err := app.RecordQuery(col).AndWhere(where).Limit(retentionBatch).All(&batch); err != nil {
			return total, err
		}
		if len(batch) == 0 {
			return total, nil
		}
		for _, r := range batch {
			if err := app.Delete(r); err != nil {
				return total, err
			}
			total++
		}
	}
}
