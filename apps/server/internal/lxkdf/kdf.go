// Package lxkdf implements the LexiChat password key derivation (v1).
//
// The client never sends the raw password to the server. Instead it derives
// a master key with Argon2id and splits it into two independent subkeys:
//
//	master  = Argon2id(password, salt, ops, mem, p=1, 32 bytes)
//	authKey = BLAKE2b-256(key=master, msg="lexichat:auth:v1")  -> sent to the server (hex) as "password"
//	kek     = BLAKE2b-256(key=master, msg="lexichat:kek:v1")   -> wraps the private keys, never leaves the client
//
// The server stores only bcrypt(hex(authKey)). Knowing authKey does not
// reveal kek, so a compromised server cannot unwrap the private keys.
//
// The construction is byte-compatible with libsodium:
// crypto_pwhash(ALG_ARGON2ID13, opslimit=ops, memlimit=mem bytes) and
// crypto_generichash(32, msg, key=master). See packages/crypto for the
// client implementation and the shared test vectors.
package lxkdf

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"errors"

	"golang.org/x/crypto/argon2"
	"golang.org/x/crypto/blake2b"
)

const (
	AlgArgon2id13 = "argon2id13"

	// DefaultOps and DefaultMemBytes are the v1 defaults (t=3, m=64 MiB, p=1).
	DefaultOps      = 3
	DefaultMemBytes = 64 * 1024 * 1024

	SaltBytes = 16

	authContext = "lexichat:auth:v1"
	kekContext  = "lexichat:kek:v1"
)

// Params describes the KDF parameters stored per user.
type Params struct {
	Alg string `json:"alg"`
	Ops uint32 `json:"ops"`
	Mem uint32 `json:"mem"` // bytes
}

func DefaultParams() Params {
	return Params{Alg: AlgArgon2id13, Ops: DefaultOps, Mem: DefaultMemBytes}
}

// Validate rejects parameters that are unknown or too weak (or absurdly expensive).
func (p Params) Validate() error {
	if p.Alg != AlgArgon2id13 {
		return errors.New("unsupported kdf algorithm")
	}
	if p.Ops < 2 || p.Ops > 10 {
		return errors.New("invalid kdf ops")
	}
	if p.Mem < 32*1024*1024 || p.Mem > 1024*1024*1024 || p.Mem%1024 != 0 {
		return errors.New("invalid kdf memory")
	}
	return nil
}

// NewSalt returns a random salt encoded as base64 (std, padded).
func NewSalt() (string, error) {
	b := make([]byte, SaltBytes)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(b), nil
}

// DecodeSalt decodes and length-checks a base64 salt.
func DecodeSalt(s string) ([]byte, error) {
	b, err := base64.StdEncoding.DecodeString(s)
	if err != nil {
		return nil, err
	}
	if len(b) != SaltBytes {
		return nil, errors.New("invalid salt length")
	}
	return b, nil
}

// Master derives the 32-byte master key.
func Master(password string, salt []byte, p Params) ([]byte, error) {
	if err := p.Validate(); err != nil {
		return nil, err
	}
	if len(salt) != SaltBytes {
		return nil, errors.New("invalid salt length")
	}
	return argon2.IDKey([]byte(password), salt, p.Ops, p.Mem/1024, 1, 32), nil
}

func subkey(master []byte, context string) []byte {
	h, err := blake2b.New256(master)
	if err != nil {
		panic(err) // only fails for keys > 64 bytes
	}
	h.Write([]byte(context))
	return h.Sum(nil)
}

// AuthKeyHex returns the hex encoded auth key that is used as PocketBase "password".
func AuthKeyHex(master []byte) string {
	return hex.EncodeToString(subkey(master, authContext))
}

// KEK returns the key encryption key. The server only needs it for tests.
func KEK(master []byte) []byte {
	return subkey(master, kekContext)
}

// DeriveAuthKeyHex is a convenience helper: password -> hex(authKey).
func DeriveAuthKeyHex(password string, saltB64 string, p Params) (string, error) {
	salt, err := DecodeSalt(saltB64)
	if err != nil {
		return "", err
	}
	m, err := Master(password, salt, p)
	if err != nil {
		return "", err
	}
	return AuthKeyHex(m), nil
}
