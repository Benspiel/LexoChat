package lexichat

import (
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
)

func (s *Server) registerRoutes(se *core.ServeEvent) {
	g := se.Router.Group("/api/lexichat")

	g.GET("/prelogin", s.handlePrelogin)

	me := g.Group("/me")
	me.Bind(apis.RequireAuth(ColUsers))
	me.GET("/keys", s.handleGetMyKeys)
	me.POST("/keys/recovery", s.handleSetRecoveryKeys)
	me.POST("/password", s.handleChangePassword)

	admin := g.Group("/admin")
	admin.Bind(apis.RequireAuth(ColUsers))
	admin.BindFunc(s.requireAdmin)
	admin.POST("/users", s.handleAdminCreateUser)
	admin.POST("/users/{id}/reset-password", s.handleAdminResetPassword)
}
