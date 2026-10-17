package lxkdf

import (
	"encoding/hex"
	"testing"
)

// Vector generated with libsodium-wrappers-sumo (crypto_pwhash ALG_ARGON2ID13 +
// crypto_generichash), see docs/00-architektur.md. It guarantees that the
// server side derivation matches the client implementation byte for byte.
const (
	vecPassword = "correct horse battery staple"
	vecSalt     = "AAECAwQFBgcICQoLDA0ODw=="
	vecMaster   = "0d1a3c6523c8f06e4e0af9c515aa5b5448cfebd6838f2d52c3d8b6ef8ddc3c2e"
	vecAuth     = "e6a1f080e3f8da345a86797bacfe8e091f63bcb89ac755651ebfbcebaa153aef"
	vecKek      = "22c058705e8208a85eb11b94c948ec44ff823c489ba63ca19ec6468ab05edeb4"
)

func TestLibsodiumCompatibility(t *testing.T) {
	salt, err := DecodeSalt(vecSalt)
	if err != nil {
		t.Fatal(err)
	}
	m, err := Master(vecPassword, salt, DefaultParams())
	if err != nil {
		t.Fatal(err)
	}
	if got := hex.EncodeToString(m); got != vecMaster {
		t.Fatalf("master mismatch: %s", got)
	}
	if got := AuthKeyHex(m); got != vecAuth {
		t.Fatalf("auth mismatch: %s", got)
	}
	if got := hex.EncodeToString(KEK(m)); got != vecKek {
		t.Fatalf("kek mismatch: %s", got)
	}
}

func TestAuthKeyAndKekAreIndependent(t *testing.T) {
	if vecAuth == vecKek {
		t.Fatal("subkeys must differ")
	}
}

func TestParamsValidation(t *testing.T) {
	bad := []Params{
		{Alg: "scrypt", Ops: 3, Mem: DefaultMemBytes},
		{Alg: AlgArgon2id13, Ops: 1, Mem: DefaultMemBytes},
		{Alg: AlgArgon2id13, Ops: 3, Mem: 1024 * 1024},
		{Alg: AlgArgon2id13, Ops: 3, Mem: DefaultMemBytes + 1},
	}
	for i, p := range bad {
		if p.Validate() == nil {
			t.Errorf("params %d should be rejected", i)
		}
	}
	if err := DefaultParams().Validate(); err != nil {
		t.Fatal(err)
	}
}

func TestSalt(t *testing.T) {
	s, err := NewSalt()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := DecodeSalt(s); err != nil {
		t.Fatal(err)
	}
	if _, err := DecodeSalt("AAEC"); err == nil {
		t.Fatal("short salt must fail")
	}
}
