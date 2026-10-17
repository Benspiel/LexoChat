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
	me.POST("/keys", s.handleSetupKeys)
	me.POST("/keys/recovery", s.handleSetRecoveryKeys)
	me.POST("/password", s.handleChangePassword)
	me.POST("/totp/setup", s.handleTotpSetup)
	me.POST("/totp/enable", s.handleTotpEnable)
	me.POST("/totp/disable", s.handleTotpDisable)

	admin := g.Group("/admin")
	admin.Bind(apis.RequireAuth(ColUsers))
	admin.BindFunc(s.requireAdmin)
	admin.POST("/users", s.handleAdminCreateUser)
	admin.POST("/users/{id}/reset-password", s.handleAdminResetPassword)
	admin.POST("/users/{id}/reset-2fa", s.handleAdminResetTotp)
	admin.POST("/users/{id}/unlock", s.handleAdminUnlock)
}
