package lexichat

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"math/big"
	"net/http"
	"regexp"
	"strings"

	"github.com/benspiel/lexochat/apps/server/internal/lxkdf"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"
)

var (
	usernameRegex = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]{2,31}$`)
	authKeyRegex  = regexp.MustCompile(`^[0-9a-f]{64}$`)
)

const tempPasswordAlphabet = "abcdefghjkmnpqrstuvwxyz23456789"

// NewOneTimePassword returns a random, human typeable password (~99 bit), e.g. "k7mfq-2xhtr-9pwab-c3dne".
func NewOneTimePassword() (string, error) {
	var b strings.Builder
	max := big.NewInt(int64(len(tempPasswordAlphabet)))
	for i := 0; i < 20; i++ {
		if i > 0 && i%5 == 0 {
			b.WriteByte('-')
		}
		n, err := rand.Int(rand.Reader, max)
		if err != nil {
			return "", err
		}
		b.WriteByte(tempPasswordAlphabet[n.Int64()])
	}
	return b.String(), nil
}

// setOneTimePassword sets a new one-time password (with fresh salt) on the record.
func setOneTimePassword(user *core.Record) (string, error) {
	otp, err := NewOneTimePassword()
	if err != nil {
		return "", err
	}
	salt, err := lxkdf.NewSalt()
	if err != nil {
		return "", err
	}
	params := lxkdf.DefaultParams()
	authKey, err := lxkdf.DeriveAuthKeyHex(otp, salt, params)
	if err != nil {
		return "", err
	}
	user.SetPassword(authKey)
	user.Set("kdf_salt", salt)
	user.Set("kdf_params", params)
	user.Set("must_change_password", true)
	return otp, nil
}

// CreateAccount creates an active account with a one-time password (must be changed on first login).
func CreateAccount(app core.App, username, name, role string) (*core.Record, string, error) {
	username = strings.ToLower(strings.TrimSpace(username))
	name = strings.TrimSpace(name)
	if !usernameRegex.MatchString(username) {
		return nil, "", errors.New("Ungültiger Benutzername (3–32 Zeichen: a–z, 0–9, Punkt, Bindestrich, Unterstrich).")
	}
	if name == "" || len([]rune(name)) > 80 {
		return nil, "", errors.New("Ungültiger Anzeigename (1–80 Zeichen).")
	}
	if role != RoleAdmin && role != RoleUser {
		return nil, "", errors.New("Ungültige Rolle.")
	}

	col, err := app.FindCachedCollectionByNameOrId(ColUsers)
	if err != nil {
		return nil, "", err
	}

	if _, err := app.FindFirstRecordByData(col, "username", username); err == nil {
		return nil, "", errors.New("Dieser Benutzername ist bereits vergeben.")
	}

	user := core.NewRecord(col)
	user.Set("username", username)
	user.Set("name", name)
	user.Set("role", role)
	user.Set("active", true)
	user.Set("key_version", 0)
	otp, err := setOneTimePassword(user)
	if err != nil {
		return nil, "", err
	}
	if err := app.Save(user); err != nil {
		return nil, "", err
	}
	return user, otp, nil
}

// --- key material validation ---

func validPublicKey(s string) bool {
	b, err := base64.StdEncoding.DecodeString(s)
	return err == nil && len(b) == 32
}

// validWrappedKeys checks the structure of a client side encrypted key blob:
// {"v":1,"alg":"xchacha20poly1305","nonce":"<b64 24 bytes>","ct":"<b64>"}
func validWrappedKeys(raw json.RawMessage) bool {
	if len(raw) == 0 || len(raw) > MaxWrappedKeys {
		return false
	}
	var blob struct {
		V     int    `json:"v"`
		Alg   string `json:"alg"`
		Nonce string `json:"nonce"`
		Ct    string `json:"ct"`
	}
	if err := json.Unmarshal(raw, &blob); err != nil {
		return false
	}
	nonce, err := base64.StdEncoding.DecodeString(blob.Nonce)
	if err != nil || len(nonce) != 24 {
		return false
	}
	ct, err := base64.StdEncoding.DecodeString(blob.Ct)
	if err != nil || len(ct) < 16 {
		return false
	}
	return blob.V == 1 && blob.Alg == "xchacha20poly1305"
}

// --- /api/lexichat/me endpoints ---

func (s *Server) handleGetMyKeys(e *core.RequestEvent) error {
	u := e.Auth
	e.Response.Header().Set("Cache-Control", "no-store")
	return e.JSON(http.StatusOK, map[string]any{
		"publicEncKey":        u.GetString("public_enc_key"),
		"publicSignKey":       u.GetString("public_sign_key"),
		"keyVersion":          u.GetInt("key_version"),
		"wrappedPrivateKeys":  u.Get("wrapped_private_keys"),
		"recoveryWrappedKeys": u.Get("recovery_wrapped_keys"),
	})
}

type recoveryForm struct {
	RecoveryWrappedKeys json.RawMessage `json:"recoveryWrappedKeys"`
}

func (s *Server) handleSetRecoveryKeys(e *core.RequestEvent) error {
	if e.Auth.GetBool("must_change_password") {
		return e.ForbiddenError(msgMustChangePw, nil)
	}
	var form recoveryForm
	if err := e.BindBody(&form); err != nil || !validWrappedKeys(form.RecoveryWrappedKeys) {
		return e.BadRequestError("Ungültige Wiederherstellungsdaten.", nil)
	}
	user, err := e.App.FindRecordById(ColUsers, e.Auth.Id)
	if err != nil {
		return e.NotFoundError("", nil)
	}
	user.Set("recovery_wrapped_keys", form.RecoveryWrappedKeys)
	if err := e.App.Save(user); err != nil {
		return e.BadRequestError("Speichern fehlgeschlagen.", err)
	}
	s.Audit(e.App, AuditEntry{Action: AuditKeysChanged, Actor: e.Auth, TargetType: ColUsers, TargetId: user.Id, Details: map[string]any{"recovery": true}, IP: e.RealIP()})
	return e.NoContent(http.StatusNoContent)
}

type passwordForm struct {
	OldPassword         string          `json:"oldPassword"`
	NewPassword         string          `json:"newPassword"`
	KdfSalt             string          `json:"kdfSalt"`
	KdfParams           lxkdf.Params    `json:"kdfParams"`
	WrappedPrivateKeys  json.RawMessage `json:"wrappedPrivateKeys"`
	PublicEncKey        string          `json:"publicEncKey"`
	PublicSignKey       string          `json:"publicSignKey"`
	RecoveryWrappedKeys json.RawMessage `json:"recoveryWrappedKeys"`
}

// handleChangePassword atomically changes the auth key, the KDF parameters and
// the re-wrapped private keys (and optionally sets new public keys).
func (s *Server) handleChangePassword(e *core.RequestEvent) error {
	var form passwordForm
	if err := e.BindBody(&form); err != nil {
		return e.BadRequestError("Ungültige Anfrage.", nil)
	}

	user, err := e.App.FindRecordById(ColUsers, e.Auth.Id)
	if err != nil {
		return e.NotFoundError("", nil)
	}
	if isLocked(user, now()) {
		return e.BadRequestError(msgLoginFailed, nil)
	}
	if !authKeyRegex.MatchString(form.OldPassword) || !user.ValidatePassword(form.OldPassword) {
		s.registerFailedLogin(e.App, user, e.RealIP())
		return e.BadRequestError("Das aktuelle Passwort ist falsch.", nil)
	}

	if !authKeyRegex.MatchString(form.NewPassword) || form.NewPassword == form.OldPassword {
		return e.BadRequestError("Das neue Passwort ist ungültig oder entspricht dem alten Passwort.", nil)
	}
	if _, err := lxkdf.DecodeSalt(form.KdfSalt); err != nil || form.KdfSalt == user.GetString("kdf_salt") {
		return e.BadRequestError("Ungültiger Salt.", nil)
	}
	if err := form.KdfParams.Validate(); err != nil {
		return e.BadRequestError("Ungültige Schlüsselableitungsparameter.", nil)
	}
	if !validWrappedKeys(form.WrappedPrivateKeys) {
		return e.BadRequestError("Ungültige verschlüsselte Schlüssel.", nil)
	}

	keysProvided := form.PublicEncKey != "" || form.PublicSignKey != ""
	if keysProvided && (!validPublicKey(form.PublicEncKey) || !validPublicKey(form.PublicSignKey)) {
		return e.BadRequestError("Ungültige öffentliche Schlüssel.", nil)
	}
	if !keysProvided && user.GetString("public_enc_key") == "" {
		return e.BadRequestError("Es müssen neue Schlüssel erzeugt werden.", nil)
	}
	if len(form.RecoveryWrappedKeys) > 0 && !validWrappedKeys(form.RecoveryWrappedKeys) {
		return e.BadRequestError("Ungültige Wiederherstellungsdaten.", nil)
	}

	keysChanged := keysProvided &&
		(form.PublicEncKey != user.GetString("public_enc_key") || form.PublicSignKey != user.GetString("public_sign_key"))

	user.SetPassword(form.NewPassword)
	user.Set("kdf_salt", form.KdfSalt)
	user.Set("kdf_params", form.KdfParams)
	user.Set("wrapped_private_keys", form.WrappedPrivateKeys)
	user.Set("must_change_password", false)
	if keysChanged {
		user.Set("public_enc_key", form.PublicEncKey)
		user.Set("public_sign_key", form.PublicSignKey)
		user.Set("key_version", user.GetInt("key_version")+1)
		user.Set("keys_updated", types.NowDateTime())
	}
	if len(form.RecoveryWrappedKeys) > 0 {
		user.Set("recovery_wrapped_keys", form.RecoveryWrappedKeys)
	} else if keysChanged {
		// the old recovery blob belongs to the old key pair
		user.Set("recovery_wrapped_keys", nil)
	}

	err = e.App.RunInTransaction(func(txApp core.App) error {
		if err := txApp.Save(user); err != nil {
			return err
		}
		return deleteUserSessions(txApp, user.Id, "")
	})
	if err != nil {
		return e.BadRequestError("Das Passwort konnte nicht geändert werden.", err)
	}

	s.Audit(e.App, AuditEntry{Action: AuditPasswordChanged, Actor: user, TargetType: ColUsers, TargetId: user.Id, IP: e.RealIP()})
	if keysChanged {
		s.Audit(e.App, AuditEntry{Action: AuditKeysChanged, Actor: user, TargetType: ColUsers, TargetId: user.Id, Details: map[string]any{"keyVersion": user.GetInt("key_version"), "fingerprint": keyFingerprint(form.PublicEncKey, form.PublicSignKey)}, IP: e.RealIP()})
	}

	e.Response.Header().Set("Cache-Control", "no-store")
	return e.JSON(http.StatusOK, map[string]any{"reloginRequired": true})
}

// keyFingerprint is a short identifier of a key pair for the audit log only
// (clients compute and compare the full safety number themselves).
func keyFingerprint(enc, sign string) string {
	sum := sha256Sum([]byte(enc + "|" + sign))
	return hex.EncodeToString(sum[:8])
}

// --- /api/lexichat/admin endpoints ---

type createUserForm struct {
	Username string `json:"username"`
	Name     string `json:"name"`
	Role     string `json:"role"`
}

func (s *Server) requireAdmin(e *core.RequestEvent) error {
	if !isActiveAdmin(e.Auth) {
		return e.ForbiddenError("Nur für Administratorinnen und Administratoren.", nil)
	}
	return e.Next()
}

func (s *Server) handleAdminCreateUser(e *core.RequestEvent) error {
	var form createUserForm
	if err := e.BindBody(&form); err != nil {
		return e.BadRequestError("Ungültige Anfrage.", nil)
	}
	user, otp, err := CreateAccount(e.App, form.Username, form.Name, form.Role)
	if err != nil {
		return e.BadRequestError(err.Error(), nil)
	}
	s.Audit(e.App, AuditEntry{Action: AuditUserCreated, Actor: e.Auth, TargetType: ColUsers, TargetId: user.Id, TargetLabel: user.GetString("username"), Details: map[string]any{"role": form.Role}, IP: e.RealIP()})

	e.Response.Header().Set("Cache-Control", "no-store")
	return e.JSON(http.StatusCreated, map[string]any{
		"id":              user.Id,
		"username":        user.GetString("username"),
		"name":            user.GetString("name"),
		"role":            user.GetString("role"),
		"oneTimePassword": otp,
	})
}

func (s *Server) handleAdminResetPassword(e *core.RequestEvent) error {
	id := e.Request.PathValue("id")
	if id == e.Auth.Id {
		return e.BadRequestError("Ändern Sie Ihr eigenes Passwort bitte über „Passwort ändern“.", nil)
	}
	user, err := e.App.FindRecordById(ColUsers, id)
	if err != nil {
		return e.NotFoundError("Benutzer nicht gefunden.", nil)
	}

	otp, err := setOneTimePassword(user)
	if err != nil {
		return e.InternalServerError("", err)
	}
	// the password wrapped private keys can no longer be opened; the public keys and
	// the recovery blob stay so that the user can restore the keys with the recovery key
	user.Set("wrapped_private_keys", nil)
	user.Set("failed_logins", 0)
	user.Set("locked_until", "")

	err = e.App.RunInTransaction(func(txApp core.App) error {
		if err := txApp.Save(user); err != nil {
			return err
		}
		return deleteUserSessions(txApp, user.Id, "")
	})
	if err != nil {
		return e.BadRequestError("Das Passwort konnte nicht zurückgesetzt werden.", err)
	}

	s.Audit(e.App, AuditEntry{Action: AuditUserPasswordReset, Actor: e.Auth, TargetType: ColUsers, TargetId: user.Id, TargetLabel: user.GetString("username"), IP: e.RealIP()})

	e.Response.Header().Set("Cache-Control", "no-store")
	return e.JSON(http.StatusOK, map[string]any{"oneTimePassword": otp})
}
