package lexichat

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base32"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/pocketbase/dbx"
	validation "github.com/pocketbase/ozzo-validation/v4"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"
)

// TOTP according to RFC 6238 (HMAC-SHA1, 6 digits, 30 s steps) - the parameters
// every common authenticator app supports. A code is accepted for the current
// step and +/- one step (clock drift) and never twice (replay protection).

const (
	totpDigits     = 6
	totpPeriod     = 30
	totpSecretSize = 20 // 160 bit, RFC 4226 recommendation
	totpSkew       = 1
	totpIssuer     = "LexiChat"

	msgTotpRequired = "Bitte geben Sie den Code aus Ihrer Authenticator-App ein."
	msgTotpInvalid  = "Der Zwei-Faktor-Code ist ungültig."
	msgTotpSetupReq = "Für Administrator-Konten ist die Zwei-Faktor-Anmeldung Pflicht. Bitte richten Sie sie zuerst ein."
)

var b32 = base32.StdEncoding.WithPadding(base32.NoPadding)

// totpCode computes the code for the given counter (RFC 4226 dynamic truncation).
func totpCode(secret []byte, counter uint64) string {
	var msg [8]byte
	binary.BigEndian.PutUint64(msg[:], counter)
	mac := hmac.New(sha1.New, secret)
	mac.Write(msg[:])
	sum := mac.Sum(nil)
	offset := sum[len(sum)-1] & 0x0f
	bin := binary.BigEndian.Uint32(sum[offset:offset+4]) & 0x7fffffff
	mod := uint32(1)
	for i := 0; i < totpDigits; i++ {
		mod *= 10
	}
	return fmt.Sprintf("%0*d", totpDigits, bin%mod)
}

// totpVerify returns the matching time step (> lastStep) or 0 if the code is invalid.
func totpVerify(secret []byte, code string, at time.Time, lastStep int64) int64 {
	code = strings.ReplaceAll(strings.TrimSpace(code), " ", "")
	if len(code) != totpDigits {
		return 0
	}
	current := at.Unix() / totpPeriod
	for d := -totpSkew; d <= totpSkew; d++ {
		step := current + int64(d)
		if step <= lastStep || step <= 0 {
			continue
		}
		if subtle.ConstantTimeCompare([]byte(totpCode(secret, uint64(step))), []byte(code)) == 1 {
			return step
		}
	}
	return 0
}

func totpURI(secretB32, username string) string {
	label := url.PathEscape(totpIssuer + ":" + username)
	q := url.Values{}
	q.Set("secret", secretB32)
	q.Set("issuer", totpIssuer)
	q.Set("algorithm", "SHA1")
	q.Set("digits", "6")
	q.Set("period", "30")
	return "otpauth://totp/" + label + "?" + q.Encode()
}

// --- secret encryption at rest (AES-256-GCM, key derived from the server secret) ---

func (s *Server) totpKey() []byte {
	sum := sha256.Sum256([]byte("lexichat:totp-at-rest:v1:" + s.cfg.ServerSecret))
	return sum[:]
}

func (s *Server) sealTotpSecret(secret []byte, userId string) (string, error) {
	block, err := aes.NewCipher(s.totpKey())
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	// the user id as associated data binds the secret to its account
	ct := gcm.Seal(nil, nonce, secret, []byte(userId))
	return "v1:" + base64.StdEncoding.EncodeToString(append(nonce, ct...)), nil
}

func (s *Server) openTotpSecret(sealed, userId string) ([]byte, error) {
	raw, ok := strings.CutPrefix(sealed, "v1:")
	if !ok {
		return nil, errors.New("unknown totp secret format")
	}
	data, err := base64.StdEncoding.DecodeString(raw)
	if err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(s.totpKey())
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	if len(data) < gcm.NonceSize() {
		return nil, errors.New("invalid totp secret")
	}
	return gcm.Open(nil, data[:gcm.NonceSize()], data[gcm.NonceSize():], []byte(userId))
}

// checkLoginTotp verifies the second factor during the password login.
// The code is sent as additional "totp" field of the auth-with-password body.
func (s *Server) checkLoginTotp(e *core.RecordAuthRequestEvent) error {
	user := e.Record
	if !user.GetBool("totp_enabled") {
		return nil
	}
	info, err := e.RequestInfo()
	if err != nil {
		return err
	}
	code, _ := info.Body["totp"].(string)
	if code == "" {
		return router.NewApiError(http.StatusUnauthorized, msgTotpRequired, totpErr("totp_required", msgTotpRequired))
	}
	secret, err := s.openTotpSecret(user.GetString("totp_secret"), user.Id)
	if err != nil {
		e.App.Logger().Error("failed to open totp secret", "error", err)
		return e.InternalServerError("", nil)
	}
	step := totpVerify(secret, code, now(), int64(user.GetInt("totp_last_step")))
	if step == 0 {
		s.registerFailedLogin(e.App, user, e.RealIP())
		return e.BadRequestError(msgTotpInvalid, totpErr("totp_invalid", msgTotpInvalid))
	}
	_, err = e.App.DB().Update(ColUsers, dbx.Params{"totp_last_step": step}, dbx.HashExp{"id": user.Id}).Execute()
	return err
}

// totpErr builds the error data the clients use to show the code input:
// {"totp": {"code": "totp_required" | "totp_invalid", "message": "..."}}
func totpErr(code, msg string) map[string]error {
	return map[string]error{"totp": validation.NewError(code, msg)}
}

// requires2FASetup reports whether the account must enrol TOTP before using admin functions.
func requires2FASetup(app core.App, user *core.Record) bool {
	if user == nil || user.Collection().Name != ColUsers || user.GetString("role") != RoleAdmin || user.GetBool("totp_enabled") {
		return false
	}
	return loadGlobalSettings(app).Require2FAAdmins
}

// --- /api/lexichat/me/totp endpoints ---

type totpPasswordForm struct {
	Password string `json:"password"`
	Code     string `json:"code"`
}

// verifyCurrentPassword re-authenticates sensitive actions (failures count towards the lockout).
func (s *Server) verifyCurrentPassword(e *core.RequestEvent, user *core.Record, password string) error {
	if isLocked(user, now()) {
		return e.BadRequestError(msgLoginFailed, nil)
	}
	if !authKeyRegex.MatchString(password) || !user.ValidatePassword(password) {
		s.registerFailedLogin(e.App, user, e.RealIP())
		return e.BadRequestError("Das Passwort ist falsch.", nil)
	}
	return nil
}

func (s *Server) handleTotpSetup(e *core.RequestEvent) error {
	var form totpPasswordForm
	if err := e.BindBody(&form); err != nil {
		return e.BadRequestError("Ungültige Anfrage.", nil)
	}
	user, err := e.App.FindRecordById(ColUsers, e.Auth.Id)
	if err != nil {
		return e.NotFoundError("", nil)
	}
	if user.GetBool("must_change_password") {
		return e.ForbiddenError(msgMustChangePw, nil)
	}
	if user.GetString("role") != RoleAdmin && !loadGlobalSettings(e.App).Allow2FAUsers {
		return e.ForbiddenError("Die Zwei-Faktor-Anmeldung ist für Ihr Konto nicht freigeschaltet.", nil)
	}
	if user.GetBool("totp_enabled") {
		return e.BadRequestError("Die Zwei-Faktor-Anmeldung ist bereits eingerichtet.", nil)
	}
	if err := s.verifyCurrentPassword(e, user, form.Password); err != nil {
		return err
	}

	secret := make([]byte, totpSecretSize)
	if _, err := rand.Read(secret); err != nil {
		return e.InternalServerError("", err)
	}
	sealed, err := s.sealTotpSecret(secret, user.Id)
	if err != nil {
		return e.InternalServerError("", err)
	}
	user.Set("totp_pending", sealed)
	if err := e.App.Save(user); err != nil {
		return e.InternalServerError("", err)
	}

	secretB32 := b32.EncodeToString(secret)
	e.Response.Header().Set("Cache-Control", "no-store")
	return e.JSON(http.StatusOK, map[string]any{
		"secret": secretB32,
		"uri":    totpURI(secretB32, user.GetString("username")),
	})
}

func (s *Server) handleTotpEnable(e *core.RequestEvent) error {
	var form totpPasswordForm
	if err := e.BindBody(&form); err != nil {
		return e.BadRequestError("Ungültige Anfrage.", nil)
	}
	user, err := e.App.FindRecordById(ColUsers, e.Auth.Id)
	if err != nil {
		return e.NotFoundError("", nil)
	}
	pending := user.GetString("totp_pending")
	if pending == "" || user.GetBool("totp_enabled") {
		return e.BadRequestError("Bitte starten Sie die Einrichtung erneut.", nil)
	}
	secret, err := s.openTotpSecret(pending, user.Id)
	if err != nil {
		return e.BadRequestError("Bitte starten Sie die Einrichtung erneut.", nil)
	}
	step := totpVerify(secret, form.Code, now(), 0)
	if step == 0 {
		return e.BadRequestError(msgTotpInvalid, nil)
	}

	user.Set("totp_secret", pending)
	user.Set("totp_pending", "")
	user.Set("totp_enabled", true)
	user.Set("totp_last_step", step)
	if err := e.App.Save(user); err != nil {
		return e.InternalServerError("", err)
	}
	s.Audit(e.App, AuditEntry{Action: AuditTotpEnabled, Actor: user, TargetType: ColUsers, TargetId: user.Id, IP: e.RealIP()})
	return e.NoContent(http.StatusNoContent)
}

func (s *Server) handleTotpDisable(e *core.RequestEvent) error {
	var form totpPasswordForm
	if err := e.BindBody(&form); err != nil {
		return e.BadRequestError("Ungültige Anfrage.", nil)
	}
	user, err := e.App.FindRecordById(ColUsers, e.Auth.Id)
	if err != nil {
		return e.NotFoundError("", nil)
	}
	if !user.GetBool("totp_enabled") {
		return e.BadRequestError("Die Zwei-Faktor-Anmeldung ist nicht eingerichtet.", nil)
	}
	if user.GetString("role") == RoleAdmin && loadGlobalSettings(e.App).Require2FAAdmins {
		return e.ForbiddenError("Für Administrator-Konten ist die Zwei-Faktor-Anmeldung Pflicht.", nil)
	}
	if err := s.verifyCurrentPassword(e, user, form.Password); err != nil {
		return err
	}
	secret, err := s.openTotpSecret(user.GetString("totp_secret"), user.Id)
	if err != nil || totpVerify(secret, form.Code, now(), int64(user.GetInt("totp_last_step"))) == 0 {
		s.registerFailedLogin(e.App, user, e.RealIP())
		return e.BadRequestError(msgTotpInvalid, nil)
	}
	clearTotp(user)
	if err := e.App.Save(user); err != nil {
		return e.InternalServerError("", err)
	}
	s.Audit(e.App, AuditEntry{Action: AuditTotpDisabled, Actor: user, TargetType: ColUsers, TargetId: user.Id, IP: e.RealIP()})
	return e.NoContent(http.StatusNoContent)
}

func clearTotp(user *core.Record) {
	user.Set("totp_enabled", false)
	user.Set("totp_secret", "")
	user.Set("totp_pending", "")
	user.Set("totp_last_step", 0)
}
