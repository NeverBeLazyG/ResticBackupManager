package config

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
)

type Repository struct {
	ID            string   `json:"id"`
	Name          string   `json:"name"`
	URI           string   `json:"uri"`
	Password      string   `json:"password"`
	SourceFolders []string `json:"sourceFolders"`
	Excludes      []string `json:"excludes"`
}

type AppConfig struct {
	Repositories []Repository `json:"repositories"`
	LastUsedRepo string       `json:"lastUsedRepo"`
}

type ConfigManager struct {
	path   string
	Config AppConfig
	mu     sync.RWMutex
}

func NewConfigManager() (*ConfigManager, error) {
	appData, err := os.UserConfigDir()
	if err != nil {
		appData = os.TempDir()
	}
	dir := filepath.Join(appData, "restic-gui")
	os.MkdirAll(dir, 0755)
	path := filepath.Join(dir, "config.json")

	cm := &ConfigManager{path: path}
	if err := cm.Load(); err != nil {
		cm.Config = AppConfig{Repositories: []Repository{}}
		cm.Save()
	}
	return cm, nil
}

func (cm *ConfigManager) Load() error {
	cm.mu.Lock()
	defer cm.mu.Unlock()
	data, err := os.ReadFile(cm.path)
	if err != nil {
		return err
	}
	return json.Unmarshal(data, &cm.Config)
}

func (cm *ConfigManager) Save() error {
	cm.mu.Lock()
	defer cm.mu.Unlock()
	data, err := json.MarshalIndent(cm.Config, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(cm.path, data, 0644)
}

func (cm *ConfigManager) GetRepositories() []Repository {
	cm.mu.RLock()
	defer cm.mu.RUnlock()
	result := make([]Repository, len(cm.Config.Repositories))
	copy(result, cm.Config.Repositories)
	return result
}

func (cm *ConfigManager) GetRepository(id string) (Repository, bool) {
	cm.mu.RLock()
	defer cm.mu.RUnlock()
	for _, r := range cm.Config.Repositories {
		if r.ID == id {
			return r, true
		}
	}
	return Repository{}, false
}

func (cm *ConfigManager) AddRepository(repo Repository) error {
	cm.mu.Lock()
	cm.Config.Repositories = append(cm.Config.Repositories, repo)
	cm.mu.Unlock()
	return cm.Save()
}

func (cm *ConfigManager) UpdateRepository(repo Repository) error {
	cm.mu.Lock()
	for i, r := range cm.Config.Repositories {
		if r.ID == repo.ID {
			cm.Config.Repositories[i] = repo
			break
		}
	}
	cm.mu.Unlock()
	return cm.Save()
}

func (cm *ConfigManager) DeleteRepository(id string) error {
	cm.mu.Lock()
	repos := cm.Config.Repositories[:0]
	for _, r := range cm.Config.Repositories {
		if r.ID != id {
			repos = append(repos, r)
		}
	}
	cm.Config.Repositories = repos
	if cm.Config.LastUsedRepo == id {
		cm.Config.LastUsedRepo = ""
	}
	cm.mu.Unlock()
	return cm.Save()
}

func (cm *ConfigManager) SetLastUsedRepo(id string) {
	cm.mu.Lock()
	cm.Config.LastUsedRepo = id
	cm.mu.Unlock()
	cm.Save()
}
