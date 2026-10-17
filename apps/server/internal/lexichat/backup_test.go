package lexichat

import (
	"archive/zip"
	"bytes"
	"context"
	"testing"
)

func TestStreamBackup(t *testing.T) {
	env := newTestEnv(t)
	env.createUser("alice", RoleUser)

	var buf bytes.Buffer
	if err := StreamBackup(context.Background(), env.app, &buf); err != nil {
		t.Fatal(err)
	}
	zr, err := zip.NewReader(bytes.NewReader(buf.Bytes()), int64(buf.Len()))
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, f := range zr.File {
		if f.Name == "data.db" {
			found = true
		}
	}
	if !found {
		t.Fatal("backup must contain data.db")
	}

	fsys, err := env.app.NewBackupsFilesystem()
	if err != nil {
		t.Fatal(err)
	}
	defer fsys.Close()
	files, _ := fsys.List("")
	if len(files) != 0 {
		t.Fatalf("temporary backup must be removed, found %d files", len(files))
	}
}
