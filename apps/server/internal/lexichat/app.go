// Package lexichat contains the LexiChat server logic on top of PocketBase:
// security hooks, sessions, audit log, custom endpoints and retention jobs.
package lexichat

import (
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/hook"
)

// Request headers used by the LexiChat clients.
const (
	HeaderSession = "X-LexiChat-Session"
	HeaderDevice  = "X-LexiChat-Device"
)

// Server bundles the LexiChat specific state.
type Server struct {
	cfg   Config
	audit *auditor
}

// Register wires all LexiChat hooks, routes and jobs into the PocketBase app.
func Register(app core.App, cfg Config) (*Server, error) {
	if err := cfg.Validate(); err != nil {
		return nil, err
	}

	s := &Server{
		cfg:   cfg,
		audit: &auditor{secret: []byte(cfg.ServerSecret)},
	}

	protectAuditLogs(app)
	s.registerAuthHooks(app)
	s.registerSessionHooks(app)
	s.registerUserHooks(app)
	s.registerChatHooks(app)
	s.registerMessageHooks(app)
	s.registerReceiptHooks(app)
	s.registerSettingsHooks(app)

	app.OnServe().Bind(&hook.Handler[*core.ServeEvent]{
		Id: "lexichatServe",
		Func: func(e *core.ServeEvent) error {
			if err := s.applyAppSettings(e.App); err != nil {
				return err
			}

			// replace the default (permissive) CORS middleware
			e.Router.Unbind(apis.DefaultCorsMiddlewareId)
			e.Router.Bind(apis.CORS(apis.CORSConfig{
				AllowOrigins: s.corsOrigins(),
				AllowHeaders: []string{"Authorization", "Content-Type", HeaderSession, HeaderDevice},
			}))

			e.Router.Bind(&hook.Handler[*core.RequestEvent]{
				Id:       "lexichatSession",
				Priority: apis.DefaultLoadAuthTokenMiddlewarePriority + 1,
				Func:     s.sessionMiddleware,
			})
			e.Router.Bind(&hook.Handler[*core.RequestEvent]{
				Id:       "lexichatRestrictedAccount",
				Priority: apis.DefaultLoadAuthTokenMiddlewarePriority + 2,
				Func:     s.restrictedAccountMiddleware,
			})

			s.registerRoutes(e)
			return e.Next()
		},
	})

	s.registerJobs(app)

	return s, nil
}

func (s *Server) corsOrigins() []string {
	if len(s.cfg.AllowedOrigins) > 0 {
		return s.cfg.AllowedOrigins
	}
	if s.cfg.AdminOrigin != "" {
		return []string{s.cfg.AdminOrigin}
	}
	// no browser origin configured: deny cross origin browser requests
	// (the desktop client uses the native http stack, see docs)
	return []string{"null-origin-disabled.invalid"}
}

// Audit writes an audit entry and logs (but does not propagate) failures.
func (s *Server) Audit(app core.App, entry AuditEntry) {
	if err := s.audit.Write(app, entry); err != nil {
		app.Logger().Error("audit write failed", "action", entry.Action, "error", err)
	}
}
