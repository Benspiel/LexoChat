package lexichat

import (
	"crypto/sha256"
	"time"
)

// now is replaceable in tests.
var now = time.Now

func sha256Sum(b []byte) [32]byte {
	return sha256.Sum256(b)
}
