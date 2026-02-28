package restic

// BackupProgress ist die JSON-Ausgabe von restic backup --json
type BackupProgress struct {
	MessageType      string   `json:"message_type"`
	SecondsElapsed   float64  `json:"seconds_elapsed"`
	SecondsRemaining float64  `json:"seconds_remaining"`
	PercentDone      float64  `json:"percent_done"`
	TotalFiles       uint64   `json:"total_files"`
	FilesDone        uint64   `json:"files_done"`
	TotalBytes       uint64   `json:"total_bytes"`
	BytesDone        uint64   `json:"bytes_done"`
	ErrorCount       int      `json:"error_count"`
	CurrentFiles     []string `json:"current_files"`
	// Summary fields
	FilesNew        uint64  `json:"files_new"`
	FilesChanged    uint64  `json:"files_changed"`
	FilesUnmodified uint64  `json:"files_unmodified"`
	DirsNew         uint64  `json:"dirs_new"`
	DirsChanged     uint64  `json:"dirs_changed"`
	DirsUnmodified  uint64  `json:"dirs_unmodified"`
	DataBlobs       int     `json:"data_blobs"`
	TreeBlobs       int     `json:"tree_blobs"`
	DataAdded       uint64  `json:"data_added"`
	TotalFilesProc  uint64  `json:"total_files_processed"`
	TotalBytesProc  uint64  `json:"total_bytes_processed"`
	TotalDuration   float64 `json:"total_duration"`
	SnapshotID      string  `json:"snapshot_id"`
}

// Snapshot repräsentiert einen restic Snapshot
type Snapshot struct {
	ID       string   `json:"id"`
	ShortID  string   `json:"short_id"`
	Time     string   `json:"time"`
	Hostname string   `json:"hostname"`
	Username string   `json:"username"`
	Paths    []string `json:"paths"`
	Tags     []string `json:"tags"`
}

// RestoreProgress ist die JSON-Ausgabe von restic restore --json
type RestoreProgress struct {
	MessageType      string  `json:"message_type"`
	SecondsElapsed   float64 `json:"seconds_elapsed"`
	SecondsRemaining float64 `json:"seconds_remaining"`
	PercentDone      float64 `json:"percent_done"`
	TotalFiles       uint64  `json:"total_files"`
	FilesRestored    uint64  `json:"files_restored"`
	FilesSkipped     uint64  `json:"files_skipped"`
	TotalBytes       uint64  `json:"total_bytes"`
	BytesRestored    uint64  `json:"bytes_restored"`
	BytesSkipped     uint64  `json:"bytes_skipped"`
}

// BackupJob definiert einen Backup-Auftrag
type BackupJob struct {
	RepoID      string   `json:"repoId"`
	SourcePaths []string `json:"sourcePaths"`
	Excludes    []string `json:"excludes"`
	Tags        []string `json:"tags"`
}

// FileNode repräsentiert eine Datei oder einen Ordner im Snapshot (restic ls --json)
type FileNode struct {
	StructType string `json:"struct_type"` // "node" oder "snapshot"
	Name       string `json:"name"`
	Type       string `json:"type"` // "file" oder "dir"
	Path       string `json:"path"`
	Size       uint64 `json:"size"`
	MTime      string `json:"mtime"`
}
