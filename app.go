package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"restic-gui/internal/config"
	"restic-gui/internal/restic"

	"github.com/google/uuid"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type App struct {
	ctx    context.Context
	config *config.ConfigManager
	runner *restic.Runner
}

func NewApp() *App {
	return &App{}
}

func (a *App) shutdown(ctx context.Context) {}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx

	cm, err := config.NewConfigManager()
	if err != nil {
		runtime.LogError(ctx, "Config error: "+err.Error())
	}
	a.config = cm

	runner, err := restic.NewRunner()
	if err != nil {
		runtime.LogWarning(ctx, "restic not found: "+err.Error())
	}
	a.runner = runner
}

// ── Repository API ────────────────────────────────────────────────

func (a *App) GetRepositories() []config.Repository {
	return a.config.GetRepositories()
}

func (a *App) AddRepository(repo config.Repository) error {
	repo.ID = uuid.New().String()
	return a.config.AddRepository(repo)
}

func (a *App) UpdateRepository(repo config.Repository) error {
	return a.config.UpdateRepository(repo)
}

func (a *App) DeleteRepository(id string) error {
	return a.config.DeleteRepository(id)
}

func (a *App) SetLastUsedRepo(id string) {
	a.config.SetLastUsedRepo(id)
}

func (a *App) TestRepository(id string) (string, error) {
	if a.runner == nil {
		return "", fmt.Errorf("restic not found")
	}
	repo, ok := a.config.GetRepository(id)
	if !ok {
		return "", fmt.Errorf("repository not found")
	}
	out, err := a.runner.Run(repo.URI, repo.Password, []string{"cat", "config"})
	if err != nil {
		return "", err
	}
	_ = out
	return "Connection successful!", nil
}

func (a *App) InitRepository(repo config.Repository) error {
	if a.runner == nil {
		return fmt.Errorf("restic not found")
	}
	_, err := a.runner.Run(repo.URI, repo.Password, []string{"init"})
	return err
}

// ── Dateiauswahl ─────────────────────────────────────────────────

func (a *App) SelectFolders() ([]string, error) {
	dir, err := runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Select source folder",
	})
	if err != nil || dir == "" {
		return nil, err
	}
	return []string{dir}, nil
}

func (a *App) SelectRestoreFolder() (string, error) {
	dir, err := runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Select restore target folder",
	})
	return dir, err
}

// ── Backup API ────────────────────────────────────────────────────

func (a *App) StartBackup(job restic.BackupJob) error {
	if a.runner == nil {
		return fmt.Errorf("restic not found")
	}
	repo, ok := a.config.GetRepository(job.RepoID)
	if !ok {
		return fmt.Errorf("repository not found")
	}

	args := []string{"backup", "--json"}
	for _, ex := range job.Excludes {
		args = append(args, "--exclude", ex)
	}
	for _, tag := range job.Tags {
		args = append(args, "--tag", tag)
	}
	args = append(args, job.SourcePaths...)

	go func() {
		err := a.runner.RunWithProgress(repo.URI, repo.Password, args, func(line string) {
			var progress restic.BackupProgress
			if jsonErr := json.Unmarshal([]byte(line), &progress); jsonErr == nil {
				runtime.EventsEmit(a.ctx, "backup:progress", progress)
			}
		})
		if err != nil {
			runtime.EventsEmit(a.ctx, "backup:error", err.Error())
		} else {
			runtime.EventsEmit(a.ctx, "backup:complete", nil)
		}
	}()
	return nil
}

func (a *App) CancelBackup() {
	if a.runner != nil {
		a.runner.Cancel()
	}
}

// ── Snapshot API ──────────────────────────────────────────────────

func (a *App) GetSnapshots(repoID string) ([]restic.Snapshot, error) {
	if a.runner == nil {
		return nil, fmt.Errorf("restic not found")
	}
	repo, ok := a.config.GetRepository(repoID)
	if !ok {
		return nil, fmt.Errorf("repository not found")
	}
	out, err := a.runner.Run(repo.URI, repo.Password, []string{"snapshots", "--json"})
	if err != nil {
		return nil, err
	}
	var snapshots []restic.Snapshot
	if err := json.Unmarshal([]byte(out), &snapshots); err != nil {
		return nil, fmt.Errorf("failed to parse snapshot data")
	}
	return snapshots, nil
}

func (a *App) DeleteSnapshot(repoID, snapshotID string) error {
	if a.runner == nil {
		return fmt.Errorf("restic not found")
	}
	repo, ok := a.config.GetRepository(repoID)
	if !ok {
		return fmt.Errorf("repository not found")
	}
	_, err := a.runner.Run(repo.URI, repo.Password, []string{"forget", snapshotID, "--prune"})
	return err
}

// ── Restore API ───────────────────────────────────────────────────

func (a *App) StartRestore(repoID, snapshotID, targetPath string) error {
	if a.runner == nil {
		return fmt.Errorf("restic not found")
	}
	repo, ok := a.config.GetRepository(repoID)
	if !ok {
		return fmt.Errorf("repository not found")
	}

	args := []string{"restore", snapshotID, "--target", targetPath, "--json"}

	go func() {
		err := a.runner.RunWithProgress(repo.URI, repo.Password, args, func(line string) {
			var progress restic.RestoreProgress
			if jsonErr := json.Unmarshal([]byte(line), &progress); jsonErr == nil {
				runtime.EventsEmit(a.ctx, "restore:progress", progress)
			}
		})
		if err != nil {
			runtime.EventsEmit(a.ctx, "restore:error", err.Error())
		} else {
			runtime.EventsEmit(a.ctx, "restore:complete", nil)
		}
	}()
	return nil
}

func (a *App) CancelRestore() {
	if a.runner != nil {
		a.runner.Cancel()
	}
}

// ── Restic Info ───────────────────────────────────────────────────

// GetResticStatus returns the restic path if found, or an error message
func (a *App) GetResticStatus() map[string]string {
	if a.runner == nil {
		return map[string]string{
			"found":   "false",
			"message": "restic.exe not found.\n\nPlease do one of the following:\n  • Place restic.exe in the same folder as ResticBackupManager.exe\n  • Or install restic so it is available in your system PATH\n\nDownload: https://restic.net",
		}
	}
	return map[string]string{
		"found": "true",
		"path":  a.runner.ResticPath(),
	}
}

func (a *App) GetResticVersion() string {
	if a.runner == nil {
		return "restic not found"
	}
	out, err := a.runner.Run("", "", []string{"version"})
	if err != nil {
		return "?"
	}
	return out
}

// ── Selective Restore ─────────────────────────────────────────────

// ListSnapshotContents lists all files in a snapshot via restic ls --json
func (a *App) ListSnapshotContents(repoID, snapshotID string) ([]restic.FileNode, error) {
	if a.runner == nil {
		return nil, fmt.Errorf("restic not found")
	}
	repo, ok := a.config.GetRepository(repoID)
	if !ok {
		return nil, fmt.Errorf("repository not found")
	}

	args := []string{"ls", "--json", snapshotID}
	out, err := a.runner.Run(repo.URI, repo.Password, args)
	if err != nil {
		return nil, err
	}

	var nodes []restic.FileNode
	for _, line := range splitLines(out) {
		if line == "" {
			continue
		}
		var node restic.FileNode
		if err := json.Unmarshal([]byte(line), &node); err != nil {
			continue
		}
		// First line is snapshot info; file/dir nodes have struct_type "node"
		if node.StructType == "node" {
			nodes = append(nodes, node)
		}
	}
	return nodes, nil
}

// RestoreSelected restores selected paths from a snapshot.
// toOriginal=true  → temp dir on SAME drive → fast os.Rename to original path
// toOriginal=false → restore directly to targetPath
func (a *App) RestoreSelected(repoID, snapshotID string, includePaths []string, targetPath string, toOriginal bool) error {
	if a.runner == nil {
		return fmt.Errorf("restic not found")
	}
	repo, ok := a.config.GetRepository(repoID)
	if !ok {
		return fmt.Errorf("repository not found")
	}
	if len(includePaths) == 0 {
		return fmt.Errorf("no paths selected")
	}

	if toOriginal {
		// Restic stores Windows paths as /G/folder (drive letter = first dir).
		// Strategy: restore to temp on SAME drive → os.Rename (no copy needed).
		go func() {
			// Extract drive letter from first include path: e.g. "/G/..." → "G"
			driveLetter := extractDriveLetter(includePaths[0])
			if driveLetter == "" {
				runtime.EventsEmit(a.ctx, "restore:error", "Could not determine drive letter from path")
				return
			}

			// Create temp dir on SAME drive: e.g. G:\restic-gui-temp-<uuid>
			tempDir := driveLetter + `:\restic-gui-temp-` + uuid.New().String()[:8]
			if err := os.MkdirAll(tempDir, 0755); err != nil {
				runtime.EventsEmit(a.ctx, "restore:error", "Failed to create temp directory: "+err.Error())
				return
			}
			defer os.RemoveAll(tempDir)

			// Restore in Temp: Ergebnis z.B. tempDir\G\namDHC_v113
			args := []string{"restore", snapshotID, "--target", tempDir, "--json"}
			for _, p := range includePaths {
				args = append(args, "--include", p)
			}
			err := a.runner.RunWithProgress(repo.URI, repo.Password, args, func(line string) {
				var progress restic.RestoreProgress
				if jsonErr := json.Unmarshal([]byte(line), &progress); jsonErr == nil {
					runtime.EventsEmit(a.ctx, "restore:progress", progress)
				}
			})
			if err != nil {
				runtime.EventsEmit(a.ctx, "restore:error", err.Error())
				return
			}

			// tempDir\G\* → G:\*  (fast rename on same drive)
			srcBase := filepath.Join(tempDir, driveLetter)
			dstBase := driveLetter + `:\`
			if err := moveContents(srcBase, dstBase); err != nil {
				runtime.EventsEmit(a.ctx, "restore:error", "Move failed: "+err.Error())
				return
			}
			runtime.EventsEmit(a.ctx, "restore:complete", nil)
		}()
		return nil
	}

	// ── Custom Target Restore ─────────────────────────────────────────────────
	args := []string{"restore", snapshotID, "--target", targetPath, "--json"}
	for _, p := range includePaths {
		args = append(args, "--include", p)
	}
	go func() {
		err := a.runner.RunWithProgress(repo.URI, repo.Password, args, func(line string) {
			var progress restic.RestoreProgress
			if jsonErr := json.Unmarshal([]byte(line), &progress); jsonErr == nil {
				runtime.EventsEmit(a.ctx, "restore:progress", progress)
			}
		})
		if err != nil {
			runtime.EventsEmit(a.ctx, "restore:error", err.Error())
		} else {
			runtime.EventsEmit(a.ctx, "restore:complete", nil)
		}
	}()
	return nil
}

// extractDriveLetter liest den Laufwerksbuchstaben aus einem restic-Pfad.
// Restic speichert Windows-Pfade als "/G/folder" → gibt "G" zurück.
func extractDriveLetter(path string) string {
	// Normalisieren: Backslashes → Forward-Slashes, führenden Slash entfernen
	norm := strings.ReplaceAll(path, `\`, "/")
	norm = strings.TrimPrefix(norm, "/")
	// Erster Pfadteil = Laufwerksbuchstabe (z.B. "G" aus "G/namDHC_v113")
	parts := strings.SplitN(norm, "/", 2)
	if len(parts[0]) == 1 {
		return strings.ToUpper(parts[0])
	}
	return ""
}

// moveContents verschiebt alle Einträge aus src direkt nach dst.
// Da src und dst auf dem gleichen Laufwerk liegen, ist os.Rename instant.
func moveContents(src, dst string) error {
	entries, err := os.ReadDir(src)
	if err != nil {
		if os.IsNotExist(err) {
			return nil // nichts zu verschieben
		}
		return err
	}
	for _, entry := range entries {
		srcPath := filepath.Join(src, entry.Name())
		dstPath := filepath.Join(dst, entry.Name())
		// Ziel-Eltern sicherstellen
		if err := os.MkdirAll(filepath.Dir(dstPath), 0755); err != nil {
			return err
		}
		// Rename: auf gleichem Laufwerk = sofortiger Vorgang
		if err := os.Rename(srcPath, dstPath); err != nil {
			// Fallback: kopieren + löschen (anderes Laufwerk)
			if copyErr := copyPath(srcPath, dstPath); copyErr != nil {
				return copyErr
			}
			os.RemoveAll(srcPath)
		}
	}
	return nil
}

// copyPath kopiert eine Datei oder einen Ordner rekursiv.
func copyPath(src, dst string) error {
	info, err := os.Stat(src)
	if err != nil {
		return err
	}
	if info.IsDir() {
		if err := os.MkdirAll(dst, info.Mode()); err != nil {
			return err
		}
		entries, _ := os.ReadDir(src)
		for _, e := range entries {
			if err := copyPath(filepath.Join(src, e.Name()), filepath.Join(dst, e.Name())); err != nil {
				return err
			}
		}
		return nil
	}
	// Datei kopieren
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()
	_, err = io.Copy(out, in)
	return err
}

func splitLines(s string) []string {
	var lines []string
	start := 0
	for i, c := range s {
		if c == '\n' {
			lines = append(lines, s[start:i])
			start = i + 1
		}
	}
	if start < len(s) {
		lines = append(lines, s[start:])
	}
	return lines
}
