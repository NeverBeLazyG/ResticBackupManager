package restic

import (
	"bufio"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
)

// Runner manages restic processes
type Runner struct {
	resticPath string
	mu         sync.Mutex
	cancelFunc context.CancelFunc
}

// NewRunner searches for restic.exe in the following order:
//  1. Same directory as this executable
//  2. System PATH
func NewRunner() (*Runner, error) {
	// 1. Check same directory as the running executable
	if exePath, err := os.Executable(); err == nil {
		exeDir := filepath.Dir(exePath)
		candidate := filepath.Join(exeDir, "restic.exe")
		if _, err := os.Stat(candidate); err == nil {
			return &Runner{resticPath: candidate}, nil
		}
	}

	// 2. Check PATH
	if path, err := exec.LookPath("restic"); err == nil {
		return &Runner{resticPath: path}, nil
	}

	return nil, fmt.Errorf(
		"restic.exe not found.\n\n" +
			"Please do one of the following:\n" +
			"  • Place restic.exe in the same folder as ResticBackupManager.exe\n" +
			"  • Or install restic and ensure it is in your system PATH\n\n" +
			"Download restic from: https://restic.net",
	)
}

// ResticPath returns the path to the restic executable being used
func (r *Runner) ResticPath() string {
	return r.resticPath
}

// Run executes a restic command and returns the combined output
func (r *Runner) Run(repoURI, password string, args []string) (string, error) {
	cmd := exec.Command(r.resticPath, args...)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	if repoURI != "" {
		cmd.Env = append(os.Environ(),
			"RESTIC_REPOSITORY="+repoURI,
			"RESTIC_PASSWORD="+password,
		)
	} else {
		cmd.Env = os.Environ()
	}
	out, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("%s", friendlyError(strings.TrimSpace(string(out))))
	}
	return string(out), nil
}

// RunWithProgress executes a restic command and calls onLine for each stdout line
func (r *Runner) RunWithProgress(repoURI, password string, args []string, onLine func(string)) error {
	r.mu.Lock()
	ctx, cancel := context.WithCancel(context.Background())
	r.cancelFunc = cancel
	r.mu.Unlock()

	defer func() {
		r.mu.Lock()
		r.cancelFunc = nil
		r.mu.Unlock()
	}()

	cmd := exec.CommandContext(ctx, r.resticPath, args...)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	cmd.Env = append(os.Environ(),
		"RESTIC_REPOSITORY="+repoURI,
		"RESTIC_PASSWORD="+password,
	)

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return err
	}

	if err := cmd.Start(); err != nil {
		return err
	}

	var stderrBuf strings.Builder
	go func() {
		sc := bufio.NewScanner(stderr)
		for sc.Scan() {
			stderrBuf.WriteString(sc.Text() + "\n")
		}
	}()

	sc := bufio.NewScanner(stdout)
	for sc.Scan() {
		onLine(sc.Text())
	}

	if err := cmd.Wait(); err != nil {
		if ctx.Err() != nil {
			return fmt.Errorf("cancelled")
		}
		return fmt.Errorf("%s", friendlyError(strings.TrimSpace(stderrBuf.String())))
	}
	return nil
}

// Cancel stops the currently running restic process
func (r *Runner) Cancel() {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.cancelFunc != nil {
		r.cancelFunc()
	}
}

// friendlyError translates technical restic errors into user-friendly messages
func friendlyError(raw string) string {
	lower := strings.ToLower(raw)
	switch {
	case strings.Contains(lower, "wrong password"):
		return "Wrong password for this repository."
	case strings.Contains(lower, "no such file") || strings.Contains(lower, "repository does not exist"):
		return "Repository not initialized. Go to Repositories → Edit → click \"Initialize repository\" first."
	case strings.Contains(lower, "connection refused") || strings.Contains(lower, "network") || strings.Contains(lower, "dial"):
		return "Network error. Is the server reachable?"
	case strings.Contains(lower, "permission denied"):
		return "Access denied. Please check permissions."
	case strings.Contains(lower, "already initialized"):
		return "Repository already exists."
	case strings.Contains(lower, "is already locked"):
		return "Repository is locked. Please wait or unlock it manually."
	default:
		if raw == "" {
			return "Unknown error"
		}
		return raw
	}
}
